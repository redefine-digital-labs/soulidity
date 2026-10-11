import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, parseStructTag, toBase58 } from '@mysten/sui/utils'
import { profileReadStep, deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE,
  type SoulPublicListingDeployment, type SoulPublicSnapshot } from '@soulidity/sdk'
import { EquipmentPointerBcs, EquipmentReadSet } from '../animacraft/native-equipment'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from '../animacraft/native-equipment-source-bcs'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, NativeSoulBcs,
  NativeSoulBindingBcs, NativeSoulStateBcs, receiveId, type NativeReceiveTarget } from '../animacraft/native-receive'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_LISTING_AUTHORITY_INVALID', message)
}
const sameHash = (a: number[], b: number[]) => a.length === 32 && b.length === 32
  && a.some(value => value !== 0) && a.every((value, index) => value === b[index])
const MAX_U64 = 18446744073709551615n

/** Per-Maker public provenance only, never purchase permission. A paused or
 * archived Maker retains its immutable registry identity. No Seal/Runtime key
 * services, inferred global SoulRegistry, or owner mutation are involved. */
export async function resolveBrowserNativeListingDeployment(params: {
  client: SuiGrpcClient; target: NativeReceiveTarget; snapshot: SoulPublicSnapshot; signal?: AbortSignal
}): Promise<SoulPublicListingDeployment['native']> {
  const { target, snapshot } = structuredClone({ target: params.target, snapshot: params.snapshot })
  params.signal?.throwIfAborted()
  check([0, 1, 2, 3].includes(snapshot.provenanceKind), 'Unknown Soul provenance')
  if (snapshot.provenanceKind !== 3) return undefined
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
  const original = params.client
  let calls = 0
  // Bound even SDK transports that ignore abort; snapshots cannot leak through
  // a late response. The wrapped client preserves the actual attester/readset.
  const getObject: SuiGrpcClient['ledgerService']['getObject'] = (request, options) => {
    signal.throwIfAborted()
    check(++calls <= 32, 'Listing authority read budget exceeded')
    const call = original.ledgerService.getObject(request, { ...options, abort: signal })
    const finished = profileReadStep(signal, async () => {
      const wire = await call
      // FinishedUnaryCall.method contains reflection functions, not cloneable
      // data. Only the actual response is a mutable protobuf snapshot.
      const result = { ...wire, response: structuredClone(wire.response) }
      const row = result.response.object
      check(row && typeof row.version === 'bigint' && row.version > 0n && row.version <= MAX_U64,
        'Invalid authority object version')
      check(typeof row.digest === 'string' && fromBase58(row.digest).length === 32
        && toBase58(fromBase58(row.digest)) === row.digest, 'Invalid authority object digest')
      if (row.contents?.value) check(row.contents.value.length <= 256 * 1024, 'Authority BCS read budget exceeded')
      if (row.owner?.kind === 3) check(typeof row.owner.version === 'bigint'
        && row.owner.version > 0n && row.owner.version <= row.version, 'Invalid shared authority birth version')
      return result
    })
    // Preserve the real UnaryCall metadata and method contract. Its awaited
    // result/response are bounded; this is not a Promise cast to a gRPC call.
    return new Proxy(call, { get(value, key) {
      if (key === 'then') return finished.then.bind(finished)
      if (key === 'response') return finished.then(result => result.response)
      return Reflect.get(value, key, value)
    } })
  }
  const ledger = new Proxy(original.ledgerService, { get(value, key) {
    return key === 'getObject' ? getObject : Reflect.get(value, key, value)
  } })
  const core = new Proxy(original.core, { get(value, key) {
    if (key === 'getChainIdentifier') return () => profileReadStep(signal, () => original.core.getChainIdentifier())
    if (key === 'getDynamicField') return (request: Parameters<SuiGrpcClient['core']['getDynamicField']>[0]) =>
      profileReadStep(signal, () => original.core.getDynamicField(request))
    return Reflect.get(value, key, value)
  } })
  const client = new Proxy(original, { get(value, key) {
    return key === 'ledgerService' ? ledger : key === 'core' ? core : Reflect.get(value, key, value)
  } })
  const types = await attestNativeReceiveTarget(client, target)
  const reads = new EquipmentReadSet(client)
  const soulId = receiveId(snapshot.soulId), stateId = receiveId(snapshot.stateId)
  const get = async (objectId: string, packages = false) => (await getObject({ objectId,
    readMask: { paths: packages ? ['object_id', 'version', 'digest', 'owner', 'package']
      : ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })).response.object!
  const stateRaw = await get(stateId)
  check(String(stateRaw.version) === snapshot.stateVersion && stateRaw.digest === snapshot.stateDigest,
    'Metadata State reference changed; refresh the entire Soul detail')
  const state = decodeNativeBcs(NativeSoulStateBcs, reads.accept(stateRaw, stateId, types.stateType, 3))
  check(state.id === stateId && state.version === '1' && state.soul_id === soulId && state.creator === snapshot.creator
    && state.current_owner === snapshot.currentOwner && state.current_kiosk_id === snapshot.kioskId
    && state.ownership_epoch === snapshot.ownershipEpoch && state.collection_id === snapshot.collectionId
    && state.content_id === snapshot.contentId && state.is_listed === snapshot.listedIndividually
    && state.creator_royalty_bps === snapshot.creatorRoyaltyBps, 'Metadata State identity mismatch')
  const itemFieldId = deriveKioskItemFieldId(state.current_kiosk_id, soulId)
  assertKioskItemField((await reads.read(itemFieldId, KIOSK_ITEM_FIELD_TYPE, 2, state.current_kiosk_id))!, state.current_kiosk_id, soulId)
  const soul = decodeNativeBcs(NativeSoulBcs, await reads.read(soulId, types.soulType, 2, itemFieldId))
  check(soul.id === soulId && soul.version === '1' && soul.provenance_kind === 3 && soul.creator === state.creator
    && soul.name === snapshot.name && soul.description === snapshot.description && soul.image_url === snapshot.imageUrl
    && soul.origin_ref === snapshot.originRef, 'Metadata Soul/custody mismatch')
  const pointerId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const pointer = decodeNativeBcs(EquipmentPointerBcs, await reads.read(pointerId,
    '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
  check(pointer.id === pointerId && pointer.name === 9, 'Native DF9 identity mismatch')
  check(types.bindingType === normalizeStructTag(`${target.outputOriginalPackageId}::output_v8::NativeSoulBindingV8`),
    'Unsupported native Binding type origin')
  const binding = decodeNativeBcs(NativeSoulBindingBcs, await reads.read(receiveId(pointer.value), types.bindingType, 4))
  check(binding.id === pointer.value && binding.version === '8' && binding.soul_id === soulId
    && binding.soul_state_id === stateId && binding.protocol_config_id === target.protocolConfigId
    && binding.original_holder === state.creator && BigInt(binding.maker_version) > 0n, 'Native binding identity mismatch')

  // The exact Core dependency is selected by both immutable pinned packages,
  // never by a Root's self-reported callable package or a "latest" lookup.
  const native = await get(target.soulidityCallablePackageId, true), output = await get(target.outputCallablePackageId, true)
  for (const [row, objectId, originalId, digest] of [
    [native, target.soulidityCallablePackageId, target.soulidityOriginalPackageId, target.soulidityCallableDigest],
    [output, target.outputCallablePackageId, target.outputOriginalPackageId, target.outputCallableDigest],
  ] as const) check(row.objectId === objectId && row.digest === digest && row.owner?.kind === 4
    && row.package?.storageId === objectId && row.package.originalId === originalId && row.package.version === row.version,
  'Pinned package changed during authority lookup')
  const links = [native, output].map(row => row.package?.linkage.filter(link => link.originalId === target.coreOriginalPackageId))
  check(links[0]?.length === 1 && links[1]?.length === 1 && links[0][0].upgradedId === links[1][0].upgradedId
    && links[0][0].upgradedVersion === links[1][0].upgradedVersion, 'Native/Output Core linkage mismatch')
  const coreId = receiveId(links[0][0].upgradedId), coreObject = await get(coreId, true), pkg = coreObject.package
  check(coreObject.objectId === coreId && coreObject.owner?.kind === 4 && coreObject.version === links[0][0].upgradedVersion
    && pkg?.storageId === coreId && pkg.originalId === target.coreOriginalPackageId && pkg.version === coreObject.version,
    'Core dependency identity mismatch')
  const origin = (module: string, name: string) => {
    const rows = pkg.typeOrigins.filter(row => row.moduleName === module && row.datatypeName === name)
    check(rows.length === 1 && pkg.modules.some(row => row.name === module && row.contents && row.contents.length > 4),
      'Core authority type origin missing')
    return `${receiveId(rows[0].packageId)}::${module}::${name}`
  }
  const rootType = origin('maker_v8', 'MakerRootV8')
  const marker = parseStructTag(origin('protocol_config_v8', 'CorePackageMarkerV8')).address
  const protocol = decodeNativeBcs(EquipmentProtocolBcs, await reads.read(target.protocolConfigId,
    origin('protocol_config_v8', 'ProtocolConfigV8'), 3))
  check(protocol.id === target.protocolConfigId && protocol.version === '8'
    && protocol.core_original_package_id === target.coreOriginalPackageId && protocol.core_callable_package_id === marker,
    'Protocol authority identity mismatch')
  const rootId = receiveId(binding.root_id), rootRaw = await get(rootId)
  check(rootRaw.objectType, 'Missing Maker type')
  const tag = parseStructTag(rootRaw.objectType)
  check(tag.typeParams.length === 1 && typeof tag.typeParams[0] !== 'string', 'Invalid Maker payment type')
  const coin = normalizeStructTag(tag.typeParams[0])
  const root = decodeNativeBcs(EquipmentMakerBcs, reads.accept(rootRaw, rootId, `${rootType}<${coin}>`, 3))
  check(root.id === rootId && root.version === '8' && root.maker_version === binding.maker_version
    && root.core_original_package_id === target.coreOriginalPackageId && root.core_callable_package_id === marker
    && root.creator === binding.maker_creator && root.maker_treasury_id === binding.maker_treasury_id
    && root.economics.protocol_config_id === target.protocolConfigId
    && root.economics.payment_coin_type === coin && protocol.payment_coin_type === coin
    && sameHash(root.content.content_commitment, binding.root_content_commitment), 'Maker provenance identity mismatch')
  check([1, 2, 3].includes(root.lifecycle) && root.publication.registry_ids && root.publication.catalog_id
    && root.publication.release_commitments && root.publication.sealed_base_registry_commitment,
    'Maker publication is incomplete')
  const soulRegistryId = receiveId(root.publication.registry_ids.soul_registry_id)
  check(soulRegistryId === binding.soul_registry_id, 'Maker published SoulRegistry mismatch')
  await reads.verify()
  signal.throwIfAborted()
  return Object.freeze({ outputOriginalPackageId: target.outputOriginalPackageId,
    protocolConfigId: target.protocolConfigId, soulRegistryId })
}
