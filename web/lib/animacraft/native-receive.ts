import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE, getSuiGrpcFullnodeUrl } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { assertExactContentSidecarSlots, parseContentSidecars } from '@/lib/soulidity/mirror/parse-content-sidecars'
import { withPackageObjectIdentity } from '../sui/package-object-client'

export class NativeReceiveError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message) }
}
function check(value: unknown, label: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_RECEIVE_EVIDENCE_INVALID', label)
}
const ids = ['protocolConfigId', 'coreOriginalPackageId', 'outputOriginalPackageId', 'outputCallablePackageId', 'soulidityCallablePackageId', 'soulidityOriginalPackageId'] as const
const typeKeys = ['soulOriginalType', 'soulDefiningType', 'mintWitnessOriginalType', 'mintWitnessDefiningType', 'ownerWitnessOriginalType', 'ownerWitnessDefiningType'] as const
export type NativeReceiveTarget = Record<typeof ids[number], string> & {
  outputCallableDigest: string; soulidityCallableDigest: string
  expectedNativeBinding: Record<typeof typeKeys[number], string>
  runtime?: { originalPackageId: string; callablePackageId: string; callableDigest: string }
  release?: { originalPackageId: string; callablePackageId: string; callableDigest: string }
  equipmentMarket?: { originalPackageId: string; callablePackageId: string; callableDigest: string; replacementId: string }
  equipmentWritesEnabled?: boolean
  marketWritesEnabled?: boolean
}
export function receiveId(value: unknown): string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'Expected canonical nonzero ID')
  return value
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join(), 'Unexpected request/config fields')
}
export function readNativeReceiveTarget(env: Record<string, string | undefined> = process.env): NativeReceiveTarget {
  try {
    check(env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet', 'Mainnet target required')
    const target = JSON.parse(env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON ?? '')
    exact(target, [...ids, 'outputCallableDigest', 'soulidityCallableDigest', 'expectedNativeBinding',
      ...(Object.hasOwn(target, 'runtime') ? ['runtime'] : []),
      ...(Object.hasOwn(target, 'release') ? ['release'] : []),
      ...(Object.hasOwn(target, 'equipmentMarket') ? ['equipmentMarket'] : []),
      ...(Object.hasOwn(target, 'equipmentWritesEnabled') ? ['equipmentWritesEnabled'] : []),
      ...(Object.hasOwn(target, 'marketWritesEnabled') ? ['marketWritesEnabled'] : [])])
    if (Object.hasOwn(target, 'marketWritesEnabled')) {
      check(typeof target.marketWritesEnabled === 'boolean', 'Market release switch invalid')
    }
    if (Object.hasOwn(target, 'equipmentWritesEnabled')) {
      check(typeof target.equipmentWritesEnabled === 'boolean'
        && (!target.equipmentWritesEnabled || Object.hasOwn(target, 'runtime')), 'Equipment release switch invalid')
    }
    for (const key of ['runtime', 'release', 'equipmentMarket']) if (Object.hasOwn(target, key)) {
      exact(target[key], ['originalPackageId', 'callablePackageId', 'callableDigest', ...(key === 'equipmentMarket' ? ['replacementId'] : [])])
      receiveId(target[key].originalPackageId); receiveId(target[key].callablePackageId)
      const digest = target[key].callableDigest
      check(typeof digest === 'string' && fromBase58(digest).length === 32
        && toBase58(fromBase58(digest)) === digest, 'Invalid exact package digest')
    }
    if (Object.hasOwn(target, 'equipmentMarket')) {
      // The exact nested shapes and values were checked above; retain those
      // types across the generic-key loop for cross-role identity validation.
      const parsed = target as unknown as NativeReceiveTarget
      check(parsed.runtime, 'Equipment Market requires the Runtime pin')
      const pin = parsed.equipmentMarket!
      receiveId(pin.replacementId)
      const otherIds = [...ids.map(key => parsed[key]), parsed.runtime.originalPackageId, parsed.runtime.callablePackageId,
        ...(parsed.release ? [parsed.release.originalPackageId, parsed.release.callablePackageId] : [])]
      check(!otherIds.includes(pin.originalPackageId) && !otherIds.includes(pin.callablePackageId)
        && ![...otherIds, pin.originalPackageId, pin.callablePackageId].includes(pin.replacementId), 'Equipment Market role alias')
    }
    ids.forEach(key => receiveId(target[key]))
    for (const key of ['outputCallableDigest', 'soulidityCallableDigest']) {
      check(typeof target[key] === 'string' && fromBase58(target[key]).length === 32 && toBase58(fromBase58(target[key])) === target[key], 'Invalid package digest')
    }
    exact(target.expectedNativeBinding, typeKeys)
    const names = target.expectedNativeBinding
    typeKeys.forEach(key => check(typeof names[key] === 'string' && normalizeStructTag(names[key]) === names[key] && !names[key].includes('<'), 'Invalid native type pin'))
    check(names.soulOriginalType === `${target.soulidityOriginalPackageId}::soul::Soul`
      && names.mintWitnessOriginalType === `${target.soulidityOriginalPackageId}::animacraft_v8_binding::MintBindingWitnessV8`
      && names.ownerWitnessOriginalType === `${target.soulidityOriginalPackageId}::animacraft_v8_binding::SoulOwnerWitnessV8`, 'Native lineage mismatch')
    const proof = String(names.mintWitnessDefiningType).split('::')[0]
    check(names.mintWitnessDefiningType === `${proof}::animacraft_v8_binding::MintBindingWitnessV8`
      && names.ownerWitnessDefiningType === `${proof}::animacraft_v8_binding::SoulOwnerWitnessV8`
      && String(names.soulDefiningType).endsWith('::soul::Soul'), 'Native defining type mismatch')
    // Same release artifact as the existing native SDK, never an independent issuer.
    check(target.soulidityCallablePackageId === env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID?.trim()
      && target.soulidityOriginalPackageId === env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID?.trim(), 'SDK release target mismatch')
    return target as NativeReceiveTarget
  } catch {
    throw new NativeReceiveError('NATIVE_RECEIVE_TARGET_UNAVAILABLE', 'Exact native receive release configuration is unavailable', 503)
  }
}
export function createNativeReceiveClient(signal?: AbortSignal) {
  // The SDK's baseUrl constructor forwards only baseUrl/fetchInit; RpcOptions
  // such as abort must be installed on the transport itself.
  return withPackageObjectIdentity(new SuiGrpcClient({ network: 'mainnet', transport: new GrpcWebFetchTransport({
    baseUrl: getSuiGrpcFullnodeUrl('mainnet'), ...(signal ? { abort: signal } : {}),
  }) }), signal)
}
const V = bcs.vector(bcs.u8())
const T = bcs.struct('TypeName', { name: bcs.string() })
const BindingSlot = bcs.struct('SoulidityBindingV8', { config_id: bcs.Address, soul_original: T, soul_defining: T, mint_original: T, mint_defining: T, owner_original: T, owner_defining: T })
const Bound = bcs.struct('NativeSoulBoundV8', { binding_id: bcs.Address, soul_id: bcs.Address, soul_state_id: bcs.Address, root_id: bcs.Address, output_id: bcs.Address, receipt_id: bcs.Address, original_holder: bcs.Address, authorization_commitment: V })
const Rights = bcs.struct('RightsSnapshotV8', { origin: bcs.u8(), creator: bcs.Address, creator_confirmed: bcs.bool(), evidence_certified: bcs.bool(), certification_catalog_id: bcs.option(bcs.Address), certification_binding_commitment: bcs.option(V), evidence_locator: bcs.string(), evidence_blob_id: bcs.string(), evidence_sha256: V, terms_commitment: V, soul_creator_royalty_bps: bcs.u16(), maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16(), commitment: V })
const Binding = bcs.struct('NativeSoulBindingV8', { id: bcs.Address, version: bcs.u64(), protocol_config_id: bcs.Address, soul_registry_id: bcs.Address, soul_id: bcs.Address, soul_state_id: bcs.Address, root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: V, maker_creator: bcs.Address, maker_treasury_id: bcs.Address, original_holder: bcs.Address, output_id: bcs.Address, receipt_id: bcs.Address, output_key: bcs.string(), output_policy_commitment: V, recipe_commitment: V, render_commitment: V, output_commitment: V, receipt_commitment: V, rights: Rights, authorization_commitment: V })
const Minted = bcs.struct('SoulMintedToKiosk', { soul_id: bcs.Address, state_id: bcs.Address, content_id: bcs.Address, kiosk_id: bcs.Address, owner: bcs.Address, provenance_kind: bcs.u8() })
const Content = bcs.struct('ContentVersionAppended', { content_id: bcs.Address, soul_id: bcs.Address, kind: bcs.u32(), kind_name: bcs.string(), name: bcs.string(), version_index: bcs.u64(), is_public: bcs.bool(), download_policy: bcs.u8(), grant_scope_mask: bcs.u64(), read_mode_mask: bcs.u64(), op_mask: bcs.u64(), seal_encrypted: bcs.bool(), blob_object_id: bcs.Address, created_at_ms: bcs.u64() })
const Table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() })
const State = bcs.struct('SoulState', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address, creator: bcs.Address, creator_royalty_bps: bcs.u16(), current_owner: bcs.Address, current_kiosk_id: bcs.Address, ownership_epoch: bcs.u64(), grant_capacity: bcs.u64(), active_grants: Table, active_grant_ids: Table, active_grant_count: bcs.u64(), content_id: bcs.option(bcs.Address), config_ext: Table, collection_id: bcs.option(bcs.Address), access_list_id: bcs.option(bcs.Address), is_listed: bcs.bool() })
function decode<S extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(schema: S, bytes: Uint8Array | undefined): ReturnType<S['parse']> {
  check(bytes instanceof Uint8Array && bytes.length > 0, 'Missing BCS evidence')
  const value = schema.parse(bytes)
  check(toBase64(schema.serialize(value).toBytes()) === toBase64(bytes), 'Noncanonical BCS')
  return value
}
export async function attestNativeReceiveTarget(client: SuiGrpcClient, target: NativeReceiveTarget,
  options: { completedRecipe?: boolean; market?: boolean } = {}) {
  check((await client.core.getChainIdentifier()).chainIdentifier === MAINNET_GENESIS_DIGEST, 'Mainnet RPC identity mismatch')
  const readPackage = async (objectId: string, originalId: string, digest: string) => {
    const { response } = await client.ledgerService.getObject({ objectId, readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'package'] } })
    const obj = response.object; const pkg = obj?.package
    check(obj?.objectId === objectId && obj.digest === digest && obj.owner?.kind === 4 && pkg?.storageId === objectId && pkg.originalId === originalId && pkg.version === obj.version, 'Package release evidence mismatch')
    const seen = new Set<string>()
    for (const row of pkg.typeOrigins) {
      const key = `${row.moduleName}::${row.datatypeName}`
      check(!seen.has(key), 'Duplicate package type origin'); seen.add(key)
      check(pkg.modules.some(module => module.name === row.moduleName && module.contents && module.contents.length > 4), 'Missing package module bytes')
    }
    return pkg
  }
  const [native, output] = await Promise.all([
    readPackage(target.soulidityCallablePackageId, target.soulidityOriginalPackageId, target.soulidityCallableDigest),
    readPackage(target.outputCallablePackageId, target.outputOriginalPackageId, target.outputCallableDigest),
  ])
  check(native.linkage.filter(link => link.originalId === target.outputOriginalPackageId && link.upgradedId === target.outputCallablePackageId && link.upgradedVersion === output.version).length === 1, 'Native Output linkage mismatch')
  const origin = (pkg: typeof native, module: string, name: string) => {
    const rows = pkg.typeOrigins.filter(row => row.moduleName === module && row.datatypeName === name)
    check(rows.length === 1 && rows[0].packageId, 'Missing exact type origin')
    return `${rows[0].packageId}::${module}::${name}`
  }
  for (const [module, name, key] of [['soul', 'Soul', 'soulDefiningType'], ['animacraft_v8_binding', 'MintBindingWitnessV8', 'mintWitnessDefiningType'], ['animacraft_v8_binding', 'SoulOwnerWitnessV8', 'ownerWitnessDefiningType']] as const) check(origin(native, module, name) === target.expectedNativeBinding[key], 'Native binding type origin mismatch')
  const keyType = `${target.coreOriginalPackageId}::protocol_config_v8::SoulidityBindingSlotKeyV8`
  // Empty Move struct constructors encode the compiler's dummy_field=false.
  const keyBytes = new Uint8Array([0])
  const { dynamicField } = await client.core.getDynamicField({ parentId: target.protocolConfigId, name: { type: keyType, bcs: keyBytes } })
  check(dynamicField.$kind === 'DynamicField' && dynamicField.fieldId === deriveDynamicFieldID(target.protocolConfigId, keyType, keyBytes)
    && normalizeStructTag(dynamicField.value.type) === `${target.coreOriginalPackageId}::protocol_config_v8::SoulidityBindingV8`, 'Protocol native slot mismatch')
  const slot = decode(BindingSlot, dynamicField.value.bcs)
  check(slot.config_id === target.protocolConfigId, 'Protocol binding parent mismatch')
  const stored = ['soul_original', 'soul_defining', 'mint_original', 'mint_defining', 'owner_original', 'owner_defining'] as const
  typeKeys.forEach((key, index) => check(`0x${slot[stored[index]].name}` === target.expectedNativeBinding[key], 'Protocol type pin mismatch'))
  return { marketTypes: options.market ? {
    config: origin(native, 'market', 'MarketConfigV2'),
    listing: origin(native, 'market', 'SoulListing'),
  } : null, recipeTypes: options.completedRecipe ? {
    key: origin(output, 'output_v8', 'CompleteRecipeKeyV8'),
    snapshot: origin(output, 'output_v8', 'CompleteRecipeSnapshotV8'),
  } : null, outputType: origin(output, 'output_v8', 'CompleteOutputV8'), contentObjectType: origin(native, 'content', 'SoulContent'), soulType: origin(native, 'soul', 'Soul'), boundType: origin(output, 'output_v8', 'NativeSoulBoundV8'), bindingType: origin(output, 'output_v8', 'NativeSoulBindingV8'), stateType: origin(native, 'soul', 'SoulState'), mintType: origin(native, 'market', 'SoulMintedToKiosk'), contentType: origin(native, 'content', 'ContentVersionAppended') }
}

// Shared exact Move layouts for native provenance consumers, not JSON decoders.
export { Binding as NativeSoulBindingBcs, State as NativeSoulStateBcs, Rights as NativeRightsBcs, decode as decodeNativeBcs }
export const NativeSoulBcs = bcs.struct('Soul', { id: bcs.Address, version: bcs.u64(), name: bcs.string(), description: bcs.string(), image_url: bcs.string(), provenance_kind: bcs.u8(), origin_ref: bcs.option(bcs.string()), creator: bcs.Address })

export interface NativeReceiveRequest { rootId: string; signer: string; txDigest: string; soulOnChainId: string; contentSidecars: unknown }
export function parseNativeReceiveRequest(value: unknown): NativeReceiveRequest {
  exact(value, ['rootId', 'signer', 'txDigest', 'soulOnChainId', 'contentSidecars'])
  receiveId(value.rootId); receiveId(value.signer); receiveId(value.soulOnChainId)
  check(typeof value.txDigest === 'string' && fromBase58(value.txDigest).length === 32 && toBase58(fromBase58(value.txDigest)) === value.txDigest, 'Invalid transaction digest')
  parseContentSidecars(value.contentSidecars, 'contentSidecars')
  return value as unknown as NativeReceiveRequest
}

export async function verifyNativeReceive(client: SuiGrpcClient, target: NativeReceiveTarget, input: NativeReceiveRequest) {
  const types = await attestNativeReceiveTarget(client, target)
  const result = await client.core.getTransaction({ digest: input.txDigest, include: { transaction: true, effects: true, events: true } })
  const tx = result.Transaction
  check(tx?.status.success && tx.digest === input.txDigest && tx.effects?.transactionDigest === input.txDigest && tx.transaction?.sender === input.signer, 'Successful sender-bound transaction required')
  const calls = tx.transaction.commands.flatMap(command => 'MoveCall' in command && command.MoveCall.package === target.soulidityCallablePackageId && command.MoveCall.module === 'market' && command.MoveCall.function === 'mint_animacraft_v8_in_personal_kiosk' ? [command.MoveCall] : [])
  check(calls.length === 1, 'Exactly one target native mint call required')
  const call = calls[0]
  const objectArg = (index: number) => {
    const arg = call.arguments[index]
    check(arg && 'Input' in arg, 'Native object argument is not an input')
    const input = tx.transaction!.inputs[arg.Input]
    check(input && 'Object' in input, 'Expected native object input')
    const object = input.Object
    return 'SharedObject' in object ? object.SharedObject.objectId : 'ImmOrOwnedObject' in object ? object.ImmOrOwnedObject.objectId : undefined
  }
  check(objectArg(6) === input.rootId && objectArg(7) === target.protocolConfigId, 'Native Root/protocol call mismatch')
  const matching = (type: string) => tx.events.filter(event => normalizeStructTag(event.eventType) === type)
  const boundEvents = matching(types.boundType).map(event => decode(Bound, event.bcs)).filter(row => row.soul_id === input.soulOnChainId)
  const mintEvents = matching(types.mintType).map(event => decode(Minted, event.bcs)).filter(row => row.soul_id === input.soulOnChainId)
  check(boundEvents.length === 1 && mintEvents.length === 1, 'Unique native binding and mint events required')
  const bound = boundEvents[0]; const minted = mintEvents[0]
  check(bound.root_id === input.rootId && bound.original_holder === input.signer && minted.owner === input.signer && minted.state_id === bound.soul_state_id, 'Native event identity mismatch')
  const historical = async (id: string, type: string, ownerKind: number, ownerAddress?: string) => {
    const changes = tx.effects.changedObjects.filter(change => change.objectId === id)
    check(changes.length === 1 && changes[0].idOperation === 'Created' && changes[0].inputState === 'DoesNotExist'
      && changes[0].inputVersion === null && changes[0].inputDigest === null && changes[0].inputOwner === null
      && changes[0].outputState === 'ObjectWrite' && changes[0].outputVersion && changes[0].outputDigest,
    'Created historical object required')
    const outputOwner = changes[0].outputOwner
    check(ownerKind === 2 ? outputOwner?.$kind === 'ObjectOwner' && outputOwner.ObjectOwner === ownerAddress
      : ownerKind === 3 ? outputOwner?.$kind === 'Shared' && outputOwner.Shared.initialSharedVersion === changes[0].outputVersion
        : ownerKind === 4 && outputOwner?.$kind === 'Immutable' && outputOwner.Immutable === true,
    'Historical effects ownership mismatch')
    const { response } = await client.ledgerService.getObject({ objectId: id, version: BigInt(changes[0].outputVersion), readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction'] } })
    const object = response.object
    check(object?.objectId === id && String(object.version) === changes[0].outputVersion && object.digest === changes[0].outputDigest && object.previousTransaction === input.txDigest && normalizeStructTag(object.objectType!) === type && object.owner?.kind === ownerKind && (!ownerAddress || object.owner.address === ownerAddress), 'Historical object proof mismatch')
    if (ownerKind === 3) check(String(object.owner.version) === changes[0].outputVersion, 'Historical shared birth mismatch')
    return object.contents?.value
  }
  const binding = decode(Binding, await historical(bound.binding_id, types.bindingType, 4))
  check(binding.version === '8' && binding.authorization_commitment.length === 32 && binding.id === bound.binding_id && binding.protocol_config_id === target.protocolConfigId && binding.root_id === input.rootId
    && binding.soul_id === input.soulOnChainId && binding.soul_state_id === minted.state_id && binding.original_holder === input.signer
    && binding.output_id === bound.output_id && binding.receipt_id === bound.receipt_id && binding.soul_registry_id === objectArg(9)
    && toBase64(new Uint8Array(binding.authorization_commitment)) === toBase64(new Uint8Array(bound.authorization_commitment)), 'Immutable native binding mismatch')
  const state = decode(State, await historical(minted.state_id, types.stateType, 3))
  check(state.id === minted.state_id && state.soul_id === input.soulOnChainId && state.content_id === minted.content_id && state.current_owner === input.signer && state.current_kiosk_id === minted.kiosk_id, 'Native state/content mismatch')
  const ContentRoot = bcs.struct('SoulContent', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address, items: Table, count_by_kind: Table, active: Table })
  const contentRoot = decode(ContentRoot, await historical(minted.content_id, types.contentObjectType, 3))
  check(contentRoot.id === minted.content_id && contentRoot.soul_id === input.soulOnChainId, 'Historical Soul content identity mismatch')
  const fieldId = deriveDynamicFieldID(minted.state_id, 'u8', new Uint8Array([9]))
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.u8(), value: bcs.Address })
  const field = decode(Field, await historical(fieldId, normalizeStructTag('0x2::dynamic_field::Field<u8,0x2::object::ID>'), 2, minted.state_id))
  check(field.id === fieldId && field.name === 9 && field.value === binding.id, 'Native State DF9 mismatch')
  const itemFieldId = deriveKioskItemFieldId(minted.kiosk_id, input.soulOnChainId)
  const itemBytes = await historical(itemFieldId, KIOSK_ITEM_FIELD_TYPE, 2, minted.kiosk_id)
  check(itemBytes instanceof Uint8Array, 'Historical Kiosk Item field BCS missing')
  assertKioskItemField(itemBytes, minted.kiosk_id, input.soulOnChainId)
  const soul = decode(NativeSoulBcs, await historical(input.soulOnChainId, types.soulType, 2, itemFieldId))
  check(soul.id === input.soulOnChainId && soul.provenance_kind === 3 && minted.provenance_kind === 3, 'Native Soul custody mismatch')
  const contents = matching(types.contentType).map(event => decode(Content, event.bcs)).filter(row => row.soul_id === input.soulOnChainId)
  check(contents.length > 0 && contents.every(row => row.content_id === minted.content_id), 'Content event root mismatch')
  assertExactContentSidecarSlots(parseContentSidecars(input.contentSidecars, 'contentSidecars'), contents.map(row => ({ kind: row.kind, name: row.name, versionIndex: Number(row.version_index), sealEncrypted: row.seal_encrypted })))
  return { soulId: input.soulOnChainId, stateId: minted.state_id, stateType: types.stateType,
    contentId: minted.content_id, versions: contents.map(row => ({ kind: row.kind, name: row.name,
      versionIndex: row.version_index, blobObjectId: row.blob_object_id, sealEncrypted: row.seal_encrypted })) }
}
