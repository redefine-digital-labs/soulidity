import { bcs, type BcsType } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { ApplicationFormReferenceBcs, readApplicationFormsHistory } from './application-forms'
import { readApplicationManagementState } from './application-state'
import { ApplicationFormSnapshotBcs, verifyApplicationFormSnapshot } from './application-form-snapshot'
import { ManagementDesiredSlotBcs, ManagementPagedSourcesBcs, ManagementScopeBcs, ManagementVariantBcs } from './application-bcs'
import { ManagementSlotSnapshotBcs } from './application-recipe'

const A = bcs.Address, U = bcs.u64()
export const ApplicationFormSelectionsCarrierBcs = bcs.struct('Selections', { id: A, values: ManagementPagedSourcesBcs })
export const ApplicationFormSourcesCarrierBcs = bcs.struct('Sources', { id: A, values: ManagementPagedSourcesBcs })
const Variants = bcs.struct('VisualVariants', { id: A, scopes: bcs.vector(ManagementScopeBcs),
  values: bcs.struct('Table', { id: A, size: U }) })
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`APPLICATION_FORM_READ_${code}`) }
function decode<T>(codec: BcsType<T, any>, bytes: Uint8Array): T {
  const value = codec.parse(bytes); check(codec.serialize(value).toBase64() === toBase64(bytes), 'NONCANONICAL'); return value
}

/** Full actual immutable Forms snapshot read, bound to a verified historical
 * save. The installed root, journal, every carrier/page/table and current source
 * are rechecked. Metadata does not provide missing Items or an apply capability. */
export async function readApplicationFormSnapshot(input: Parameters<typeof readApplicationFormsHistory>[0] & {
  reference: ReturnType<typeof ApplicationFormReferenceBcs.parse>
}) {
  const target = structuredClone(input.target), reference = structuredClone(input.reference)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const guard = () => { signal.throwIfAborted(); check(input.getViewerAddress() === input.viewerAddress, 'WALLET_CHANGED') }
  guard(); const before = await readApplicationFormsHistory({ ...input, target, signal })
  check(before.installed, 'NOT_INSTALLED')
  const referenceBytes = ApplicationFormReferenceBcs.serialize(reference).toBase64()
  const saved = before.history.find(row => row.operation === 0 && ApplicationFormReferenceBcs.serialize(row.reference).toBase64() === referenceBytes)
  check(saved, 'UNKNOWN_REFERENCE')
  const state = await readApplicationManagementState({ ...input, target, signal })
  const [application, model] = await Promise.all([target.application, target.model].map(pin => readPinnedMovePackageOrigins(input.client, pin, signal)))
  const type = (origins: Map<string, string>, module: string, name: string) => {
    const origin = origins.get(`${module}::${name}`); check(origin, 'TYPE_ORIGIN'); return `${origin}::${module}::${name}`
  }
  const formType = (name: string) => type(application, 'forms', name)
  const seen = new Map<string, { type: string; owner: string; version: string; digest: string }>()
  async function read(objectId: string, expectedType: string, owner: string) {
    guard(); const { response } = await profileReadStep(signal, () => input.client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    guard(); const row = response.object
    check(row?.objectId === objectId && typeof row.version === 'bigint' && row.version > 0n && row.digest
      && row.bcs?.value instanceof Uint8Array && row.bcs.value.length <= 256 * 1024, 'OBJECT')
    const raw = collectionCommandRaw({ objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(expectedType) && raw.owner.ObjectOwner === owner, 'TYPE_OWNER')
    const old = seen.get(objectId); check(!old || old.version === String(row.version) && old.digest === row.digest, 'CHANGED_RETRY')
    seen.set(objectId, { type: expectedType, owner, version: String(row.version), digest: row.digest }); return move.contents
  }
  const Key = bcs.struct('SnapshotKey', { reference: ApplicationFormReferenceBcs }), key = { reference }
  const wrapper = `0x2::dynamic_object_field::Wrapper<${formType('SnapshotKey')}>`
  const fieldId = deriveDynamicFieldID(before.journal.id, wrapper, Key.serialize(key).toBytes())
  const field = decode(bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: Key }), value: A }),
    await read(fieldId, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, before.journal.id))
  check(field.id === fieldId && Key.serialize(field.name.name).toBase64() === Key.serialize(key).toBase64() && field.value === saved.snapshot, 'SNAPSHOT_FIELD')
  const snapshot = decode(ApplicationFormSnapshotBcs, await read(field.value, formType('Snapshot'), fieldId))
  check(snapshot.id === field.value && snapshot.root === state.soulId && snapshot.application === state.applicationId
    && ApplicationFormReferenceBcs.serialize(snapshot.reference).toBase64() === referenceBytes
    && toHex(snapshot.commitment) === toHex(saved.snapshot_commitment) && (snapshot.schema === 1 || snapshot.schema === 2), 'SNAPSHOT_BINDING')
  check(BigInt(snapshot.application_revision) <= BigInt(state.applicationRevision), 'FUTURE_CAPTURE')
  if (snapshot.parent) check(before.history.some(row => row.operation === 0 && BigInt(row.sequence) < BigInt(saved.sequence)
    && ApplicationFormReferenceBcs.serialize(row.reference).toBase64() === ApplicationFormReferenceBcs.serialize(snapshot.parent!).toBase64()), 'PARENT')
  async function carrier<T extends { id: string }>(keyName: string, valueName: string, codec: BcsType<T, any>) {
    const wrapper = `0x2::dynamic_object_field::Wrapper<${formType(keyName)}>`
    const id = deriveDynamicFieldID(snapshot.id, wrapper, moveEmptyStructBytes())
    const field = decode(bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: A }),
      await read(id, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, snapshot.id))
    check(field.id === id && field.name.name.dummy_field === false, 'CARRIER_FIELD')
    const value = decode(codec, await read(field.value, formType(valueName), id)); check(value.id === field.value, 'CARRIER_ID'); return value
  }
  const selectionsCarrier = await carrier('SelectionsKey', 'Selections', ApplicationFormSelectionsCarrierBcs)
  const sourcesCarrier = await carrier('SourcesKey', 'Sources', ApplicationFormSourcesCarrierBcs)
  check(new Set([snapshot.id, selectionsCarrier.id, sourcesCarrier.id, selectionsCarrier.values.pages.id, sourcesCarrier.values.pages.id]).size === 5, 'CARRIER_ALIAS')
  async function pages<T>(store: ReturnType<typeof ManagementPagedSourcesBcs.parse>, value: BcsType<T, any>, valueType: string) {
    check(store.locations.length <= 512 && BigInt(store.page_count) <= 512n && store.pages.size === store.page_count, 'PAGE_COUNT')
    const values: T[] = []; let lastBytes = 0
    for (let page = 0n; page < BigInt(store.page_count); page++) {
      const id = deriveDynamicFieldID(store.pages.id, 'u64', U.serialize(page).toBytes()), codec = bcs.struct('Page', { id: A, name: U, value: bcs.vector(value) })
      const row = decode(codec, await read(id, `0x2::dynamic_field::Field<u64,vector<${valueType}>>`, store.pages.id))
      check(row.id === id && row.name === String(page) && row.value.length > 0 && row.value.length <= 32, 'PAGE_BINDING')
      lastBytes = 0
      for (let i = 0; i < row.value.length; i++) {
        const location = store.locations[values.length]
        check(location && location.page === String(page) && location.index === String(i), 'LOCATION')
        lastBytes += value.serialize(row.value[i]).toBytes().length; values.push(row.value[i])
      }
      check(lastBytes <= 196608, 'PAGE_BYTES')
    }
    check(values.length === store.locations.length && BigInt(lastBytes) === BigInt(store.last_bytes), 'PAGES_INCOMPLETE'); return values
  }
  const selections = await pages(selectionsCarrier.values, ManagementDesiredSlotBcs, type(application, 'character', 'DesiredSlot'))
  const sources = await pages(sourcesCarrier.values, ManagementSlotSnapshotBcs, type(application, 'character', 'SlotSnapshot'))
  const variants: ReturnType<typeof ManagementVariantBcs.parse>[] = []
  if (snapshot.schema === 2) {
    const v = await carrier('VisualVariantsKey', 'VisualVariants', Variants), keys = new Set<string>()
    check(v.scopes.length <= 65 && BigInt(v.values.size) === BigInt(v.scopes.length), 'VARIANT_COUNT')
    for (const scope of v.scopes) {
      const key = ManagementScopeBcs.serialize(scope).toBase64(); check(!keys.has(key), 'VARIANT_ALIAS'); keys.add(key)
      const scopeType = type(model, 'assembly', 'Scope'), id = deriveDynamicFieldID(v.values.id, scopeType, ManagementScopeBcs.serialize(scope).toBytes())
      const row = decode(bcs.struct('VariantField', { id: A, name: ManagementScopeBcs, value: ManagementVariantBcs }),
        await read(id, `0x2::dynamic_field::Field<${scopeType},${type(model, 'assembly', 'Variant')}>`, v.values.id))
      check(row.id === id && ManagementScopeBcs.serialize(row.name).toBase64() === key
        && ManagementScopeBcs.serialize(row.value.original.scope).toBase64() === key, 'VARIANT_SCOPE'); variants.push(row.value)
    }
  }
  const result = verifyApplicationFormSnapshot({ snapshot, selections, sources, variants, expected: { root: state.soulId,
    application: state.applicationId, snapshot: saved.snapshot, reference, commitment: toHex(saved.snapshot_commitment) } })
  for (const [id, row] of seen) await read(id, row.type, row.owner)
  const after = await readApplicationFormsHistory({ ...input, target, signal }), finalState = await readApplicationManagementState({ ...input, target, signal })
  check(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(state) === JSON.stringify(finalState), 'SOURCE_CHANGED_RETRY'); guard()
  return { ...result, journalId: before.journal.id, journalRevision: before.journal.revision, notAuthorization: true as const }
}
