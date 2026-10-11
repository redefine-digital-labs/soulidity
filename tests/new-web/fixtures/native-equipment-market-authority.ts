import { nativeEquipmentSourceFixture } from './native-equipment-source'
import { EquipmentReadSet } from '../../../web/lib/animacraft/native-equipment'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'
import { equipmentProtocolCommitment, equipmentEconomicsCommitment } from '../../../web/lib/animacraft/native-equipment-source'
import { CompleteReadCatalogBcs, completeReadCatalogHashes, completeReadRoleHash } from '../../../web/lib/animacraft/native-complete-read-bcs'
import { EquipmentMarketConfigBcs, EquipmentMarketRegistryBcs, EquipmentMarketTreasuryBcs,
  EquipmentMarketProtocolTreasuryBcs, EquipmentMarketReplacementBcs } from '../../../web/lib/animacraft/native-equipment-market-bcs'
import { readNativeEquipmentMarketAuthority, equipmentMarketRightsCommitment, equipmentMarketReplacementCommitment,
  equipmentMarketCallerCapCommitment, equipmentMarketZeroStateCommitment } from '../../../web/lib/animacraft/native-equipment-market-authority'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const h = (n: number) => Array(32).fill(n)

/** Raw package/object fixtures, including an actually serialized installed
 * caller cap. Reader tests may extend the original Base84/External102 rows. */
export function nativeEquipmentMarketAuthorityFixture() {
  const f = nativeEquipmentSourceFixture(), rootId = id(10)
  const coin = `${id(2)}::sui::SUI`
  const ids = { catalog: id(32), replacement: id(162), config: id(160), registry: id(90),
    treasury: id(161), protocolTreasury: id(31) }
  const marketPin = { originalPackageId: id(163), callablePackageId: id(164),
    callableDigest: f.target.outputCallableDigest, replacementId: ids.replacement }
  const mt = (name: string) => `${id(163)}::market_v8::${name}`
  const coreOrigins = [
    ['package_binding_v8', 'ProductReleaseCatalogV8'], ['package_binding_v8', 'FreshTupleReplacementBindingV2'],
    ['protocol_config_v8', 'ProtocolTreasuryV8'], ['protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2'],
    ['protocol_config_v8', 'ProductReleaseCatalogSlotV2'],
  ]
  const core = f.objects.get(id(72)).package
  core.typeOrigins.push(...coreOrigins.map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, packageId: id(2) })))
  core.modules.push({ name: 'package_binding_v8', contents: new Uint8Array([1, 2, 3, 4, 5]) })
  f.objects.get(id(71)).package.typeOrigins.push({ moduleName: 'runtime_v8', datatypeName: 'RuntimeCallableMarkerV8', packageId: id(70) })
  f.objects.set(marketPin.callablePackageId, { objectId: marketPin.callablePackageId, version: 1n,
    digest: marketPin.callableDigest, owner: { kind: 4 }, package: { storageId: marketPin.callablePackageId,
      originalId: marketPin.originalPackageId, version: 1n,
      modules: [{ name: 'market_v8', contents: new Uint8Array([1, 2, 3, 4, 5]) }],
      typeOrigins: ['MarketCallableMarkerV8', 'MarketSetupInstallWitnessV2', 'MarketRuntimeCallerCapInstallWitnessV2',
        'MarketPackageConfigV8', 'MarketRegistryV8', 'MarketTreasuryV8', 'EquipmentListingV8'].map(datatypeName => ({
        moduleName: 'market_v8', datatypeName, packageId: marketPin.originalPackageId })),
      linkage: [{ originalId: id(2), upgradedId: id(72), upgradedVersion: 1n },
        { originalId: id(70), upgradedId: id(71), upgradedVersion: 1n }],
    } })
  f.set(id(1), EquipmentProtocolBcs, protocol => {
    protocol.soul_market_fee_bps = 250
    protocol.commitment = equipmentProtocolCommitment(protocol)
  })
  const protocol = EquipmentProtocolBcs.parse(f.objects.get(id(1)).contents.value)
  const catalog = {
    id: ids.catalog, schema_revision: '2', protocol_config_id: protocol.id,
    protocol_config_revision: protocol.revision, protocol_config_commitment: protocol.commitment,
    binding: { bindings: [2, 165, 70, 3, 166, 163, 167].map((value, i) => ({ original_package_id: id(value),
      callable_package_id: id(value), source_commitment: h(i + 1), package_commitment: h(i + 8), abi_commitment: h(i + 15), commitment: h(0) })), commitment: h(0) },
    authority_ids: [170, 171, 172, 173, 174, 175].map(id), call_cap_set_commitment: h(0), catalog_commitment: h(0),
    next_setup_role: 6, role_config_ids: [176, 177, 178, 179, 160, 180].map(id), role_config_commitments: Array.from({ length: 6 }, () => h(0)),
  }
  const hashes = completeReadCatalogHashes(catalog)
  catalog.binding.bindings.forEach((row, i) => { row.commitment = hashes.bindings[i] })
  catalog.binding.commitment = hashes.tuple
  catalog.call_cap_set_commitment = hashes.caps
  catalog.catalog_commitment = hashes.commitment
  catalog.role_config_commitments[4] = completeReadRoleHash(catalog, 5, ids.config)
  f.put(catalog.id, f.ct('package_binding_v8', 'ProductReleaseCatalogV8'), CompleteReadCatalogBcs, catalog)
  f.set(rootId, EquipmentMakerBcs, root => {
    root.economics.soul_market_fee_bps = 250
    root.economics.protocol_config_commitment = protocol.commitment
    root.economics.commitment = equipmentEconomicsCommitment(root.economics)
    root.rights.commitment = equipmentMarketRightsCommitment(root.rights)
    root.publication.release_commitments = { product_binding_commitment: hashes.tuple, call_cap_set_commitment: hashes.caps }
  })
  const root = EquipmentMakerBcs.parse(f.objects.get(rootId).contents.value)
  const replacement = { id: ids.replacement, version: '2', catalog_id: catalog.id,
    core_binding_commitment: hashes.bindings[0], seal_binding_commitment: hashes.bindings[1], runtime_binding_commitment: hashes.bindings[2],
    output_binding_commitment: hashes.bindings[3], physical_binding_commitment: hashes.bindings[4], market_binding_commitment: hashes.bindings[5],
    release_binding_commitment: hashes.bindings[6], package_tuple_commitment: hashes.tuple, call_cap_set_commitment: hashes.caps,
    runtime_config_id: catalog.role_config_ids[1], output_config_id: catalog.role_config_ids[2],
    market_config_id: ids.config, release_config_id: catalog.role_config_ids[5], binding_commitment: h(0) }
  replacement.binding_commitment = equipmentMarketReplacementCommitment(replacement)
  f.put(ids.replacement, f.ct('package_binding_v8', 'FreshTupleReplacementBindingV2'), EquipmentMarketReplacementBcs, replacement, 4)
  const cap = { schema_revision: '2', role: 1, catalog_id: catalog.id, replacement_binding_id: ids.replacement,
    package_tuple_commitment: hashes.tuple, caller_original_package_id: marketPin.originalPackageId,
    caller_callable_package_id: marketPin.originalPackageId, call_cap_set_commitment: hashes.caps, cap_commitment: h(0) }
  cap.cap_commitment = equipmentMarketCallerCapCommitment(cap)
  f.put(ids.config, mt('MarketPackageConfigV8'), EquipmentMarketConfigBcs, { id: ids.config, version: '8', catalog_id: catalog.id,
    product_binding_commitment: hashes.tuple, call_cap_set_commitment: hashes.caps,
    installation_commitment: catalog.role_config_commitments[4], runtime_caller_cap: cap })
  const registry = { id: ids.registry, catalog_id: catalog.id, package_config_id: ids.config,
    product_binding_commitment: hashes.tuple, call_cap_set_commitment: hashes.caps,
    root_id: rootId, maker_version: root.maker_version, root_content_commitment: root.content.content_commitment,
    protocol_config_id: protocol.id, protocol_config_revision: protocol.revision, protocol_config_commitment: protocol.commitment,
    economics_commitment: root.economics.commitment, rights_commitment: root.rights.commitment,
    maker_market_fee_bps: root.economics.maker_market_fee_bps, soul_market_fee_bps: root.economics.soul_market_fee_bps,
    soul_creator_royalty_bps: root.rights.soul_creator_royalty_bps, maker_source_royalty_bps: root.rights.maker_source_royalty_bps,
    maker_resale_royalty_bps: root.rights.maker_resale_royalty_bps, treasury_id: ids.treasury, sealed: true,
    revision: '0', listing_count: '0', escrow_count: '0', completed_sale_count: '0', canceled_sale_count: '0', recovered_sale_count: '0',
    gross_volume_atomic: '0', protocol_paid_atomic: '0', creator_paid_atomic: '0', source_paid_atomic: '0', seller_paid_atomic: '0',
    zero_state_commitment: h(0) }
  registry.zero_state_commitment = equipmentMarketZeroStateCommitment(registry)
  f.put(ids.registry, `${mt('MarketRegistryV8')}<${coin}>`, EquipmentMarketRegistryBcs, registry)
  f.put(ids.treasury, `${mt('MarketTreasuryV8')}<${coin}>`, EquipmentMarketTreasuryBcs, {
    id: ids.treasury, version: '8', catalog_id: catalog.id, package_config_id: ids.config, root_id: rootId,
    maker_version: root.maker_version, root_content_commitment: root.content.content_commitment,
    escrow: { value: '0' }, gross_escrowed_atomic: '0', gross_released_atomic: '0',
  })
  f.put(ids.protocolTreasury, `${f.ct('protocol_config_v8', 'ProtocolTreasuryV8')}<${coin}>`, EquipmentMarketProtocolTreasuryBcs, {
    id: ids.protocolTreasury, version: '8', config_id: protocol.id,
    revenue: { value: '0' }, total_collected: '0', total_withdrawn: '0',
  })
  async function readAuthority() {
    const reads = new EquipmentReadSet(f.client)
    const authority = await readNativeEquipmentMarketAuthority(f.client, f.target, marketPin, reads, rootId)
    await reads.verify()
    return authority
  }
  return { ...f, rootId, coin, ids, marketPin, mt, readAuthority }
}
