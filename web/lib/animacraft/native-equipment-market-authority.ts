import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, parseStructTag, toBase58 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import type { AnimacraftEquipmentMarketV8Target } from '@soulidity/sdk'
import { EquipmentReadSet } from './native-equipment'
import { equipmentBytesEqual, equipmentUtf8 } from './native-equipment-bytes'
import { attestNativeReceiveTarget, decodeNativeBcs, NativeReceiveError, receiveId,
  NativeRightsBcs, type NativeReceiveTarget } from './native-receive'
import { readNativeSourceAuthority } from './native-source-authority'
import { EquipmentMakerBcs, EquipmentProtocolBcs, EquipmentEconomicsBcs } from './native-equipment-source-bcs'
import { equipmentEconomicsCommitment, equipmentProtocolCommitment } from './native-equipment-source'
import { CompleteReadCatalogBcs, CompleteReadEmptyKeyBcs, completeReadCatalogHashes, completeReadRoleHash } from './native-complete-read-bcs'
import { EquipmentMarketConfigBcs, EquipmentMarketRegistryBcs, EquipmentMarketTreasuryBcs,
  EquipmentMarketProtocolTreasuryBcs, EquipmentMarketReplacementBcs,
  EquipmentMarketReplacementCommitmentBcs, EquipmentMarketCallerCapCommitmentBcs,
  EquipmentMarketZeroStateCommitmentBcs, EquipmentMarketRuntimeCallerCapBcs } from './native-equipment-market-bcs'

export interface NativeEquipmentMarketPin {
  originalPackageId: string
  callablePackageId: string
  callableDigest: string
  replacementId: string
}
const A = bcs.Address, U = bcs.u64(), V = bcs.vector(bcs.u8()), S = bcs.string(), B = bcs.bool()
const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'] as const
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
const hash = (bytes: Uint8Array) => [...sha256(bytes)]
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_MARKET_AUTHORITY_INVALID', message)
}
const RightsCommitment = bcs.struct('RightsCommitmentInputV8', {
  domain: V, version: U, origin: bcs.u8(), creator: A, creator_confirmed: B, evidence_certified: B,
  certification_catalog_id: bcs.option(A), certification_binding_commitment: bcs.option(V),
  evidence_locator: S, evidence_blob_id: S, evidence_sha256: V, terms_commitment: V,
  soul_creator_royalty_bps: bcs.u16(), maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16(),
})
export function equipmentMarketRightsCommitment(rights: ReturnType<typeof NativeRightsBcs.parse>) {
  return hash(RightsCommitment.serialize({ ...rights, domain: [...equipmentUtf8('animacraft-v8/rights-snapshot')], version: '8' }).toBytes())
}
export function equipmentMarketReplacementCommitment(replacement: ReturnType<typeof EquipmentMarketReplacementBcs.parse>) {
  return hash(EquipmentMarketReplacementCommitmentBcs.serialize({ ...replacement, binding_id: replacement.id,
    domain: 'animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2', schema_revision: '2' }).toBytes())
}
export function equipmentMarketCallerCapCommitment(cap: ReturnType<typeof EquipmentMarketRuntimeCallerCapBcs.parse>) {
  return hash(EquipmentMarketCallerCapCommitmentBcs.serialize({ ...cap,
    domain: 'animacraft-fresh-v8/core/runtime-caller-cap/v1', schema_revision: '2' }).toBytes())
}
export function equipmentMarketZeroStateCommitment(registry: ReturnType<typeof EquipmentMarketRegistryBcs.parse>) {
  return hash(EquipmentMarketZeroStateCommitmentBcs.serialize({ ...registry,
    domain: [...equipmentUtf8('animacraft-v8/market/zero-state')], version: '8' }).toBytes())
}

/** Structural authority survives protocol pause/revision drift. `current` is
 * the separate list/reprice/purchase gate; callers verify their shared readset
 * after also reading the listing and exact owned instance. No access pass,
 * admission, Seal service, or Soul is required to own/trade an issued item. */
export async function readNativeEquipmentMarketAuthority(client: SuiGrpcClient, target: NativeReceiveTarget,
  marketPin: NativeEquipmentMarketPin, reads: EquipmentReadSet, rootId: string) {
  const pin = structuredClone(marketPin), nativeTarget = structuredClone(target)
  receiveId(rootId); receiveId(pin.originalPackageId); receiveId(pin.callablePackageId); receiveId(pin.replacementId)
  check(typeof pin.callableDigest === 'string' && fromBase58(pin.callableDigest).length === 32
    && toBase58(fromBase58(pin.callableDigest)) === pin.callableDigest, 'Market package digest invalid')
  await attestNativeReceiveTarget(client, nativeTarget)
  const authority = await readNativeSourceAuthority(client, nativeTarget)
  const ct = (module: string, name: string) => authority.origin('core', module, name)
  const rt = authority.rt
  const { response } = await client.ledgerService.getObject({ objectId: pin.callablePackageId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'package'] } })
  const marketObject = response.object, pkg = marketObject?.package
  check(marketObject?.objectId === pin.callablePackageId && marketObject.digest === pin.callableDigest
    && marketObject.owner?.kind === 4 && marketObject.version && marketObject.version > 0n
    && pkg?.storageId === pin.callablePackageId && pkg.originalId === pin.originalPackageId
    && pkg.version === marketObject.version, 'Market package release mismatch')
  const names = pkg.typeOrigins.map(row => `${row.moduleName}::${row.datatypeName}`)
  check(new Set(names).size === names.length, 'Duplicate Market type origins')
  const mt = (name: string) => {
    const rows = pkg.typeOrigins.filter(row => row.moduleName === 'market_v8' && row.datatypeName === name)
    check(rows.length === 1 && pkg.modules.some(m => m.name === 'market_v8' && m.contents && m.contents.length > 4), 'Market type origin missing')
    return `${receiveId(rows[0].packageId)}::market_v8::${name}`
  }
  for (const child of [authority.core, authority.runtime]) {
    const links = pkg.linkage.filter(row => row.originalId === child.package!.originalId)
    check(links.length === 1 && links[0].upgradedId === child.objectId && links[0].upgradedVersion === child.version,
      'Market Core/Runtime linkage mismatch')
  }
  const { response: rootResponse } = await client.ledgerService.getObject({ objectId: rootId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
  check(rootResponse.object?.objectType, 'Market Maker type missing')
  const tag = parseStructTag(rootResponse.object.objectType)
  check(tag.typeParams.length === 1 && typeof tag.typeParams[0] !== 'string', 'Market payment type invalid')
  const coin = normalizeStructTag(tag.typeParams[0])
  const root = decodeNativeBcs(EquipmentMakerBcs, reads.accept(rootResponse.object, rootId, `${authority.rootType}<${coin}>`, 3))
  const terms = root.publication.release_commitments, ids = root.publication.registry_ids
  check(root.id === rootId && root.version === '8' && [1, 2, 3].includes(root.lifecycle)
    && root.core_original_package_id === nativeTarget.coreOriginalPackageId && root.core_callable_package_id === authority.coreMarkerId
    && root.economics.protocol_config_id === nativeTarget.protocolConfigId
    && normalizeStructTag(root.economics.payment_coin_type) === coin
    && eq(root.economics.commitment, equipmentEconomicsCommitment(root.economics))
    && root.rights.creator === root.creator && eq(root.rights.commitment, equipmentMarketRightsCommitment(root.rights))
    && root.publication.catalog_id && terms && ids, 'Market Maker immutable authority mismatch')
  const protocol = decodeNativeBcs(EquipmentProtocolBcs, await reads.read(nativeTarget.protocolConfigId, ct('protocol_config_v8', 'ProtocolConfigV8'), 3))
  check(protocol.id === nativeTarget.protocolConfigId && protocol.version === '8'
    && eq(protocol.commitment, equipmentProtocolCommitment(protocol)), 'Market protocol commitment mismatch')
  const catalog = decodeNativeBcs(CompleteReadCatalogBcs, await reads.read(root.publication.catalog_id,
    ct('package_binding_v8', 'ProductReleaseCatalogV8'), 3))
  check(catalog.id === root.publication.catalog_id && catalog.schema_revision === '2'
    && catalog.protocol_config_id === protocol.id && catalog.binding.bindings.length === 7
    && catalog.authority_ids.length === 6 && catalog.role_config_ids.length === 6
    && catalog.role_config_commitments.length === 6 && catalog.next_setup_role === 6, 'Market catalog setup mismatch')
  for (const values of [catalog.authority_ids, catalog.role_config_ids,
    catalog.binding.bindings.map(row => row.original_package_id), catalog.binding.bindings.map(row => row.callable_package_id)]) {
    values.forEach(receiveId); check(new Set(values).size === values.length, 'Market catalog identity collision')
  }
  const hashes = completeReadCatalogHashes(catalog)
  check(eq(catalog.catalog_commitment, hashes.commitment) && eq(catalog.call_cap_set_commitment, hashes.caps)
    && eq(catalog.binding.commitment, hashes.tuple) && eq(terms.product_binding_commitment, hashes.tuple)
    && eq(terms.call_cap_set_commitment, hashes.caps)
    && catalog.binding.bindings.every((row, i) => eq(row.commitment, hashes.bindings[i])), 'Market catalog commitment mismatch')
  const binding = catalog.binding.bindings[5]
  check(binding.original_package_id === pin.originalPackageId
    && binding.callable_package_id === parseStructTag(mt('MarketCallableMarkerV8')).address
    && parseStructTag(mt('MarketSetupInstallWitnessV2')).address === binding.callable_package_id
    && parseStructTag(mt('MarketRuntimeCallerCapInstallWitnessV2')).address === binding.callable_package_id
    && catalog.binding.bindings[0].original_package_id === nativeTarget.coreOriginalPackageId
    && catalog.binding.bindings[0].callable_package_id === authority.coreMarkerId
    && catalog.binding.bindings[2].original_package_id === nativeTarget.runtime!.originalPackageId
    && catalog.binding.bindings[2].callable_package_id === parseStructTag(rt('RuntimeCallableMarkerV8')).address,
  'Market catalog package binding mismatch')
  const replacement = decodeNativeBcs(EquipmentMarketReplacementBcs, await reads.read(pin.replacementId,
    ct('package_binding_v8', 'FreshTupleReplacementBindingV2'), 4))
  check(replacement.id === pin.replacementId && replacement.version === '2' && replacement.catalog_id === catalog.id
    && eq(replacement.package_tuple_commitment, hashes.tuple) && eq(replacement.call_cap_set_commitment, hashes.caps)
    && roles.every((role, i) => eq(replacement[`${role}_binding_commitment`], hashes.bindings[i]))
    && replacement.runtime_config_id === catalog.role_config_ids[1] && replacement.output_config_id === catalog.role_config_ids[2]
    && replacement.market_config_id === catalog.role_config_ids[4] && replacement.release_config_id === catalog.role_config_ids[5]
    && eq(replacement.binding_commitment, equipmentMarketReplacementCommitment(replacement)), 'Market replacement mismatch')
  const [configBytes, registryBytes] = await Promise.all([
    reads.read(replacement.market_config_id, mt('MarketPackageConfigV8'), 3),
    reads.read(ids.market_registry_id, `${mt('MarketRegistryV8')}<${coin}>`, 3),
  ])
  const config = decodeNativeBcs(EquipmentMarketConfigBcs, configBytes)
  const installation = completeReadRoleHash(catalog, 5, replacement.market_config_id)
  check(config.id === replacement.market_config_id && config.version === '8' && config.catalog_id === catalog.id
    && eq(config.product_binding_commitment, hashes.tuple) && eq(config.call_cap_set_commitment, hashes.caps)
    && eq(config.installation_commitment, installation) && eq(catalog.role_config_commitments[4], installation), 'Market installed role mismatch')
  const cap = config.runtime_caller_cap
  check(cap && cap.schema_revision === '2' && cap.role === 1 && cap.catalog_id === catalog.id
    && cap.replacement_binding_id === replacement.id && eq(cap.package_tuple_commitment, hashes.tuple)
    && cap.caller_original_package_id === binding.original_package_id && cap.caller_callable_package_id === binding.callable_package_id
    && eq(cap.call_cap_set_commitment, hashes.caps) && eq(cap.cap_commitment, equipmentMarketCallerCapCommitment(cap)), 'Market installed caller capability mismatch')
  const registry = decodeNativeBcs(EquipmentMarketRegistryBcs, registryBytes)
  const treasury = decodeNativeBcs(EquipmentMarketTreasuryBcs, await reads.read(registry.treasury_id, `${mt('MarketTreasuryV8')}<${coin}>`, 3))
  check(registry.id === ids.market_registry_id && registry.sealed && treasury.id === registry.treasury_id && treasury.version === '8', 'Market live registry/treasury mismatch')
  for (const row of [registry, treasury]) check(row.catalog_id === catalog.id && row.package_config_id === config.id
    && row.root_id === root.id && row.maker_version === root.maker_version && eq(row.root_content_commitment, root.content.content_commitment),
  'Market companion identity mismatch')
  const economics = root.economics, rights = root.rights
  check(eq(registry.product_binding_commitment, hashes.tuple) && eq(registry.call_cap_set_commitment, hashes.caps)
    && registry.protocol_config_id === economics.protocol_config_id && registry.protocol_config_revision === economics.protocol_config_revision
    && eq(registry.protocol_config_commitment, economics.protocol_config_commitment)
    && eq(registry.economics_commitment, economics.commitment) && eq(registry.rights_commitment, rights.commitment)
    && registry.maker_market_fee_bps === economics.maker_market_fee_bps && registry.soul_market_fee_bps === economics.soul_market_fee_bps
    && registry.soul_creator_royalty_bps === rights.soul_creator_royalty_bps && registry.maker_source_royalty_bps === rights.maker_source_royalty_bps
    && registry.maker_resale_royalty_bps === rights.maker_resale_royalty_bps
    && eq(registry.zero_state_commitment, equipmentMarketZeroStateCommitment(registry)), 'Market economics/rights binding mismatch')

  // The protocol catalog claim and current treasury are purchase gates, not
  // prerequisites for the seller-only structural cancellation path.
  const keyType = ct('protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2')
  const key = { dummy_field: false }, keyBytes = CompleteReadEmptyKeyBcs.serialize(key).toBytes()
  const fieldId = deriveDynamicFieldID(protocol.id, keyType, keyBytes)
  const valueType = ct('protocol_config_v8', 'ProductReleaseCatalogSlotV2')
  const claimBytes = await reads.optional(fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, 2, protocol.id)
  let catalogClaimMatches = true
  if (claimBytes !== null) {
    const field = decodeNativeBcs(bcs.struct('Field', { id: A, name: CompleteReadEmptyKeyBcs,
      value: bcs.struct('ProductReleaseCatalogSlotV2', { catalog_id: A }) }), claimBytes)
    check(field.id === fieldId && field.name.dummy_field === false, 'Market protocol catalog field mismatch')
    catalogClaimMatches = field.value.catalog_id === catalog.id
  }
  const expectedEconomics = { ...economics, protocol_config_id: protocol.id, protocol_config_revision: protocol.revision,
    protocol_config_commitment: protocol.commitment, protocol_treasury_id: protocol.treasury_id ?? economics.protocol_treasury_id,
    payment_coin_type: coin, primary_content_fee_bps: protocol.primary_content_fee_bps, fixed_complete_fee_atomic: protocol.fixed_complete_fee_atomic,
    maker_market_fee_bps: protocol.maker_market_fee_bps, soul_market_fee_bps: protocol.soul_market_fee_bps }
  expectedEconomics.commitment = equipmentEconomicsCommitment(expectedEconomics)
  const validPolicy = [0, 1].includes(economics.maker_access) && BigInt(economics.maker_price_atomic) <= 1_000_000_000_000n
    && (BigInt(economics.maker_price_atomic) > 0n) === (economics.maker_access === 1)
    && [0, 1, 2, 3].includes(economics.complete_mode) && BigInt(economics.complete_price_atomic) <= 1_000_000_000_000n
    && BigInt(economics.complete_per_wallet_quota) <= 1_000_000_000n && BigInt(economics.complete_total_cap) <= 1_000_000_000n
    && (economics.complete_total_cap === '0' || BigInt(economics.complete_per_wallet_quota) <= BigInt(economics.complete_total_cap))
    && (BigInt(economics.complete_price_atomic) > 0n) === [1, 2].includes(economics.complete_mode)
    && (BigInt(economics.complete_per_wallet_quota) > 0n) === [1, 3].includes(economics.complete_mode)
  const current = root.lifecycle === 1 && protocol.enabled && protocol.treasury_id !== null && validPolicy
    && protocol.core_original_package_id === nativeTarget.coreOriginalPackageId && protocol.core_callable_package_id === authority.coreMarkerId
    && protocol.payment_coin_type === coin && catalog.protocol_config_revision === protocol.revision
    && eq(catalog.protocol_config_commitment, protocol.commitment) && catalogClaimMatches && economics.soul_market_fee_bps === 250
    && equipmentBytesEqual(EquipmentEconomicsBcs.serialize(expectedEconomics).toBytes(), EquipmentEconomicsBcs.serialize(economics).toBytes())
  let protocolTreasury: ReturnType<typeof EquipmentMarketProtocolTreasuryBcs.parse> | null = null
  if (current) {
    protocolTreasury = decodeNativeBcs(EquipmentMarketProtocolTreasuryBcs, await reads.read(protocol.treasury_id!,
      `${ct('protocol_config_v8', 'ProtocolTreasuryV8')}<${coin}>`, 3))
    check(protocolTreasury.id === protocol.treasury_id && protocolTreasury.version === '8' && protocolTreasury.config_id === protocol.id,
      'Market protocol treasury mismatch')
  }
  const recoverable = root.lifecycle === 2 || root.lifecycle === 3 || !protocol.enabled
    || protocol.revision !== registry.protocol_config_revision || !eq(protocol.commitment, registry.protocol_config_commitment)
  const sdkTarget: AnimacraftEquipmentMarketV8Target = { marketCallablePackageId: pin.callablePackageId, paymentCoinType: coin,
    registryId: registry.id, treasuryId: treasury.id, rootId: root.id, protocolConfigId: protocol.id,
    catalogId: catalog.id, replacementId: replacement.id, packageConfigId: config.id }
  return { root, protocol, catalog, replacement, config, registry, treasury, protocolTreasury,
    coin, rt, ct, mt, sdkTarget, current, recoverable }
}
