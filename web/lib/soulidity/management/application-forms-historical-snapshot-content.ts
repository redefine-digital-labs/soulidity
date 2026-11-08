import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs, type BcsType } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { ApplicationFormSelectionsCarrierBcs, ApplicationFormSourcesCarrierBcs } from './application-form-reader'
import { ManagementDesiredSlotBcs, ManagementPagedSourcesBcs, ManagementScopeBcs, ManagementVariantBcs } from './application-bcs'
import { ManagementSlotSnapshotBcs } from './application-recipe'
import { ApplicationFormSnapshotBcs, verifyApplicationFormSnapshot } from './application-form-snapshot'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalSavedSnapshot } from './application-forms-historical-snapshot'
const A = bcs.Address, U = bcs.u64()
const type = (origin: string, module: string, name: string) => `${origin}::${module}::${name}`
const Variants = bcs.struct('VisualVariants', { id: A, scopes: bcs.vector(ManagementScopeBcs), values: bcs.struct('Table', { id: A, size: U }) })
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_HISTORICAL_CONTENT_${code}`) }
function decode<T>(codec: BcsType<T, any>, bytes: Uint8Array): T {
  const value = codec.parse(bytes); check(codec.serialize(value).toBase64() === toBase64(bytes), 'NONCANONICAL'); return value
}
/** Every SAVE carrier/page/table field must be created in the original effects.
 * No latest-state lookup or unmodified owned-child readonly approximation.
 * Full captured commitment is still distinct from semantic recipe/render and
 * current or historical Item conservation/authority. */
export async function readFormsHistoricalSavedSnapshotContent(input: Parameters<typeof readFormsHistoricalSavedSnapshot>[0]) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalSavedSnapshot({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_SAVED_SNAPSHOT_HEADER_EVIDENCE') return evidence
  const captured = await readHistoricalSnapshotCreatedContent({ client: input.client, effects: evidence.effects,
    transactionDigest: evidence.transactionDigest, snapshot: evidence.snapshot, applicationOrigin: p.target.application.originalPackageId,
    modelOrigin: p.target.model.originalPackageId, signal })
  return { ...evidence, status: 'HISTORICAL_SAVED_SNAPSHOT_CONTENT_EVIDENCE' as const, captured,
    snapshotCommitmentVerified: true as const, semanticRecipeQualified: false as const, completeBusinessOutputVerified: false as const }
}

/** Contents integrity at supplied effects only. Caller must authenticate the
 * Snapshot header and creation transaction; this helper is not provenance. */
export async function readHistoricalSnapshotCreatedContent(input: {
  client: SuiGrpcClient; effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string
  snapshot: ReturnType<typeof ApplicationFormSnapshotBcs.parse>; applicationOrigin: string; modelOrigin: string; signal: AbortSignal
}) {
  const { snapshot, effects, transactionDigest, signal } = input
  const app = input.applicationOrigin, model = input.modelOrigin
  const formType = (name: string) => type(app, 'forms', name)
  const seen = new Set<string>(); let bytesRead = 0
  async function read(objectId: string, expectedType: string, owner: string) {
    check(!seen.has(objectId), 'OBJECT_ALIAS'); seen.add(objectId)
    const row = await readHistoricalMoveObject({ client: input.client, effects, transactionDigest,
      objectId, type: expectedType, mode: 'created', signal, maxBytes: 256 * 1024 })
    bytesRead += row.bytes.length; check(bytesRead <= 16 * 1024 * 1024, 'BYTE_BOUND')
    check(row.object.owner.ObjectOwner === owner, 'OWNER'); return row.bytes
  }
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
  const selections = await pages(selectionsCarrier.values, ManagementDesiredSlotBcs, type(app, 'character', 'DesiredSlot'))
  const sources = await pages(sourcesCarrier.values, ManagementSlotSnapshotBcs, type(app, 'character', 'SlotSnapshot'))
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
  const result = verifyApplicationFormSnapshot({ snapshot, selections, sources, variants, expected: { root: snapshot.root,
    application: snapshot.application, snapshot: snapshot.id, reference: snapshot.reference, commitment: toHex(snapshot.commitment) } })
  signal.throwIfAborted()
  return result
}
