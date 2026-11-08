import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { receiveManagementSoul, type ManagementStandardTarget } from './receive'
import { NativeInitialAuthorizationBcs } from '../native-initial-children'
import { ManagementApplicationBcs, ManagementBoundPartsBcs, ManagementCompositionBcs, ManagementDefinitionBcs, ManagementItemBcs,
  ManagementLoadoutLibraryBcs, ManagementPartBcs, ManagementSourceBcs, ManagementStoredBindingBcs } from './application-bcs'

export interface ApplicationManagementTarget extends ManagementStandardTarget {
  application: PinnedMovePackage; model: PinnedMovePackage; content: PinnedMovePackage
}
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
const A = bcs.Address, U = bcs.u64()
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_APPLICATION_${code}`) }
function decode<C extends Codec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes); check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL'); return value
}

/** Actual current Application composition and Item/Ref/Bound custody. No local
 * equipment cache and no NativeStateV8 fallback. Source metadata and current
 * stored bindings are observable; complete visual compatibility, live licences,
 * owner operations and rendering still require their own qualified adapters. */
export async function readApplicationManagementState(input: {
  client: SuiGrpcClient; target: ApplicationManagementTarget; soulId: string
  viewerAddress: string | null; getViewerAddress: () => string | null; signal: AbortSignal
}) {
  const { client, soulId, viewerAddress } = input, target = structuredClone(input.target)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const guard = () => { signal.throwIfAborted(); check(input.getViewerAddress() === viewerAddress, 'WALLET_CHANGED') }
  guard()
  const reception = await receiveManagementSoul({ client, target, soulId, signal })
  const [application, model, content, standard] = await Promise.all([target.application, target.model, target.content, target.standard]
    .map(pin => readPinnedMovePackage(client, pin, signal)))
  for (const dependency of [model, content, standard]) {
    const link = application.linkage.get(dependency.pin.originalPackageId)
    check(link?.upgradedId === dependency.pin.callablePackageId && BigInt(link.upgradedVersion) === dependency.version, 'DEPENDENCY_LINK')
  }
  const type = (pkg: typeof application, module: string, name: string) => {
    const origin = pkg.origins.get(`${module}::${name}`); check(origin, 'TYPE_ORIGIN'); return normalizeStructTag(`${origin}::${module}::${name}`)
  }
  const witness = type(application, 'character', 'ApplicationWitness'), appType = type(application, 'character', 'ApplicationState')
  const descriptors = reception.modules.filter(m => m.namespace === witness && m.nameHex === '616e696d616372616674')
  check(descriptors.length === 1 && descriptors[0].schema === 3 && !descriptors[0].removable && descriptors[0].valueType === appType, 'APPLICATION_MODULE')
  const descriptor = descriptors[0], seen = new Map<string, { type: string; version: string; digest: string }>()
  async function read(objectId: string, expectedType: string) {
    guard()
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    guard(); const row = response.object
    check(row?.objectId === objectId && typeof row.version === 'bigint' && row.version > 0n && row.digest
      && row.bcs?.value instanceof Uint8Array && row.bcs.value.length <= 256 * 1024, 'OBJECT')
    const raw = collectionCommandRaw({ objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(expectedType), 'TYPE')
    const old = seen.get(objectId)
    check(!old || old.type === expectedType && old.version === String(row.version) && old.digest === row.digest, 'CHANGED_RETRY')
    seen.set(objectId, { type: expectedType, version: String(row.version), digest: row.digest })
    return { raw, bytes: move.contents }
  }
  const stateRow = await read(descriptor.objectId, appType), state = decode(ManagementApplicationBcs, stateRow.bytes)
  check(state.id === descriptor.objectId && state.root === soulId && state.recipe_hash.length === 32
    && toHex(sha3_256(stateRow.bytes)) === descriptor.bodyHash, 'APPLICATION_BINDING')
  // The actual current Move compiler serializes an empty struct as one false
  // dummy_field byte. Confirmed by the local CompositionKey VM probe, not a
  // zero-byte synthetic DOF fixture. ItemKey carries its ID normally.
  async function child(parent: string, key: string, expectedType: string, keyBytes = moveEmptyStructBytes(), itemId?: string) {
    const wrapper = `0x2::dynamic_object_field::Wrapper<${type(application, 'character', key)}>`
    const fieldId = deriveDynamicFieldID(parent, wrapper, keyBytes)
    const fieldRow = await read(fieldId, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`)
    const Key = itemId ? bcs.struct('ItemKey', { id: A }) : MoveEmptyStructBcs
    const field = decode(bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: Key }), value: A }), fieldRow.bytes)
    check(field.id === fieldId && fieldRow.raw.owner.ObjectOwner === parent
      && (itemId ? (field.name.name as { id: string }).id === itemId && field.value === itemId
        : (field.name.name as { dummy_field: boolean }).dummy_field === false), 'CHILD_FIELD')
    const row = await read(field.value, expectedType)
    check(row.raw.owner.ObjectOwner === fieldId, 'CHILD_OWNER'); return row.bytes
  }
  const composition = decode(ManagementCompositionBcs, await child(state.id, 'CompositionKey', type(application, 'character', 'Composition')))
  const bound = decode(ManagementBoundPartsBcs, await child(state.id, 'BoundPartsKey', type(application, 'character', 'BoundParts')))
  const library = decode(ManagementLoadoutLibraryBcs, await child(state.id, 'LoadoutKey', type(content, 'loadout', 'Library')))
  // The reusable Content Authorization layout is shared; custody/controller
  // binding below is the actual Application, never a Native producer fallback.
  const authorization = decode(NativeInitialAuthorizationBcs, await child(state.id, 'AuthorizationKey', type(content, 'authorization', 'Authorization')))
  check(library.root === soulId && library.controller.parent === state.id && library.controller.root === soulId && library.version === 1
    && normalizeStructTag(library.controller.operator.name) === type(application, 'character', 'ContentOperator'), 'LIBRARY_BINDING')
  check(authorization.root === soulId && authorization.controller.parent === state.id && authorization.controller.root === soulId
    && normalizeStructTag(authorization.controller.operator.name) === type(application, 'character', 'ContentOperator')
    && BigInt(authorization.count) <= BigInt(authorization.capacity) && BigInt(authorization.count) <= BigInt(authorization.grants.size), 'AUTHORIZATION_BINDING')
  const parts = composition.assembly.parts, partKeys = new Set(parts.map(p => ManagementPartBcs.serialize(p).toBase64()))
  check(parts.length <= 512 && partKeys.size === parts.length && BigInt(composition.slots.size) <= BigInt(parts.length)
    && composition.assembly.scopes.length <= 64 && composition.assembly.root.policy.length === 32, 'COMPOSITION_BOUNDS')
  const sourceType = type(model, 'policy', 'Source'), bindingType = type(application, 'character', 'StoredBinding'), partType = type(model, 'assembly', 'PartKey')
  const locations = new Set<string>()
  async function sourceAt(store: typeof composition.references, index: string) {
    check(store.locations.length <= 512 && BigInt(store.page_count) === BigInt(store.pages.size)
      && BigInt(store.page_count) <= 512n && BigInt(index) < BigInt(store.locations.length), 'SOURCE_INDEX')
    const location = store.locations[Number(index)]
    check(BigInt(location.page) < BigInt(store.page_count) && BigInt(location.index) < 32n, 'SOURCE_LOCATION')
    const pageId = deriveDynamicFieldID(store.pages.id, 'u64', U.serialize(location.page).toBytes())
    const row = await read(pageId, `0x2::dynamic_field::Field<u64,vector<${sourceType}>>`)
    const page = decode(bcs.struct('Page', { id: A, name: U, value: bcs.vector(ManagementSourceBcs) }), row.bytes)
    check(page.id === pageId && page.name === location.page && row.raw.owner.ObjectOwner === store.pages.id
      && page.value.length <= 32 && BigInt(location.index) < BigInt(page.value.length), 'SOURCE_PAGE')
    return page.value[Number(location.index)]
  }
  const slots = [], fields = new Set<string>(), cursors = new Set<string>()
  let cursor: string | null = null, done = false
  for (let page = 0; page < 32; page++) {
    if (composition.slots.size === '0') { done = true; break }
    const result = await profileReadStep(signal, () => client.core.listDynamicFields({ parentId: composition.slots.id, limit: 25, cursor, signal }))
    guard(); check(result.dynamicFields.length <= 25 && typeof result.hasNextPage === 'boolean', 'SLOT_PAGE')
    for (const hint of result.dynamicFields) {
      check(hint.$kind === 'DynamicField' && normalizeStructTag(hint.name.type) === partType && normalizeStructTag(hint.valueType) === bindingType, 'SLOT_TYPE')
      const part = decode(ManagementPartBcs, hint.name.bcs), encodedPart = ManagementPartBcs.serialize(part).toBase64()
      check(partKeys.has(encodedPart), 'UNKNOWN_PART')
      const id = deriveDynamicFieldID(composition.slots.id, partType, hint.name.bcs)
      check(id === hint.fieldId && !fields.has(id) && fields.size < 512, 'SLOT_ALIAS'); fields.add(id)
      const row = await read(id, `0x2::dynamic_field::Field<${partType},${bindingType}>`)
      const field = decode(bcs.struct('Slot', { id: A, name: ManagementPartBcs, value: ManagementStoredBindingBcs }), row.bytes), binding = field.value
      check(field.id === id && ManagementPartBcs.serialize(field.name).toBase64() === encodedPart && row.raw.owner.ObjectOwner === composition.slots.id, 'SLOT_BINDING')
      check([binding.reference, binding.bound, binding.item].filter(v => v !== null).length === 1, 'RIGHTS_POINTER')
      const mode = binding.item !== null ? 2 : binding.bound !== null ? 1 : 0
      const location = `${mode}:${binding.item ?? binding.bound ?? binding.reference}`
      check(!locations.has(location), 'SOURCE_ALIAS'); locations.add(location)
      let source: ReturnType<typeof ManagementSourceBcs.parse>
      if (binding.item !== null) {
        const item = decode(ManagementItemBcs, await child(state.id, 'ItemKey', type(model, 'components', 'Item'), A.serialize(binding.item).toBytes(), binding.item))
        check(item.id === binding.item, 'ITEM_ID'); source = item.source
      } else source = await sourceAt(binding.bound !== null ? bound.records : composition.references, (binding.bound ?? binding.reference)!)
      check(source.definition.rights === mode && source.definition_hash.length === 32
        && source.definition.content_hash.length === 32 && source.definition.license_hash.length === 32
        && source.royalty_bps <= 10000
        && toHex(sha256(ManagementDefinitionBcs.serialize(source.definition).toBytes())) === toHex(source.definition_hash), 'SOURCE_RIGHTS')
      slots.push({ partBcs: encodedPart, partKeyHex: toHex(part.key), sourceHash: toHex(sha256(ManagementSourceBcs.serialize(source).toBytes())),
        source, binding, rights: mode === 2 ? 'TRANSFERABLE_ITEM' as const : mode === 1 ? 'SOUL_BOUND' as const : 'REFERENCE' as const })
    }
    if (!result.hasNextPage) { done = true; break }
    check(typeof result.cursor === 'string' && result.cursor.length > 0 && result.cursor.length <= 16384 && !cursors.has(result.cursor), 'SLOT_CURSOR')
    cursors.add(result.cursor); cursor = result.cursor
  }
  check(done && BigInt(slots.length) === BigInt(composition.slots.size), 'SLOTS_INCOMPLETE')
  for (const [id, row] of seen) await read(id, row.type)
  const final = await receiveManagementSoul({ client, target, soulId, signal })
  check(JSON.stringify(final) === JSON.stringify(reception), 'SOURCE_CHANGED_RETRY'); guard()
  return { soulId, applicationId: state.id, applicationRevision: state.revision, standardRevision: reception.revision,
    compositionId: composition.id, compositionRevision: composition.revision, recipeHash: toHex(state.recipe_hash),
    compositionBcs: ManagementCompositionBcs.serialize(composition).toBase64(),
    parts: parts.map(part => ({ partBcs: ManagementPartBcs.serialize(part).toBase64(), keyHex: toHex(part.key) })),
    slots, colors: composition.colors, libraryId: library.id, libraryCount: library.count,
    privateLibrary: { id: library.id, version: library.version, count: library.count, heads: library.heads, receipts: library.receipts,
      generation: authorization.generation },
    capture: { compositionId: composition.id, revision: composition.revision, commitment: toHex(state.recipe_hash) },
    renderQualified: false as const, notAuthorization: true as const }
}
