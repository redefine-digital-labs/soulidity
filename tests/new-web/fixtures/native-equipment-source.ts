import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { nativeEquipmentFixture } from './native-equipment'
import { NativeSoulBindingBcs } from '../../../web/lib/animacraft/native-receive'
import { readNativeEquipment, EquipmentExternalItemBcs } from '../../../web/lib/animacraft/native-equipment'
import { equipmentAccessCommitment, equipmentProtocolCommitment, equipmentEconomicsCommitment } from '../../../web/lib/animacraft/native-equipment-source'
import { EquipmentMakerBcs, EquipmentDefinitionsBcs, EquipmentPackRegistryBcs, EquipmentBaseRegistryBcs,
  EquipmentProfileBcs, EquipmentAccessPassBcs, EquipmentStyleRowBcs, EquipmentItemRowBcs, EquipmentColorRowBcs,
  EquipmentExternalProductBcs, EquipmentExternalAdmissionBcs, EquipmentTrackRowBcs, EquipmentBaseHolderKeyBcs,
  EquipmentBaseOwnershipBcs, EquipmentProtocolBcs } from '../../../web/lib/animacraft/native-equipment-source-bcs'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const h = (n: number) => Array(32).fill(n)
export function nativeEquipmentSourceFixture() {
  const f = nativeEquipmentFixture(); const A = bcs.Address; const U = bcs.u64(); const S = bcs.string(); const V = bcs.vector(bcs.u8())
  const ct = (module: string, name: string) => `${id(2)}::${module}::${name}`
  const rt = (name: string) => f.runtimeType(name)
  const origins = [
    ['protocol_config_v8','CorePackageMarkerV8'], ['protocol_config_v8','ProtocolConfigV8'],
    ['maker_v8','MakerRootV8'], ['base_registry_v8','BaseDefinitionRegistryV8'], ['base_registry_v8','StyleIndexKeyV8'],
    ['base_registry_v8','StyleKeyV8'], ['base_registry_v8','StyleRowV2'], ['base_registry_v8','ItemKeyV8'],
    ['base_registry_v8','ItemRowV2'], ['base_registry_v8','ColorKeyV8'], ['base_registry_v8','ColorChannelRowV2'],
    ['base_registry_v8','TrackKeyV8'], ['base_registry_v8','TrackRowV2'],
    ['treasury_v8','MakerTreasuryV8'], ['treasury_v8','MakerAccessKeyV8'], ['treasury_v8','MakerAccessRecordV8'], ['treasury_v8','MakerAccessPassV8'],
  ]
  f.objects.set(id(72), { objectId: id(72), version: 1n, digest: f.target.outputCallableDigest, owner: { kind: 4 },
    package: { storageId: id(72), originalId: id(2), version: 1n, linkage: [],
      modules: [...new Set(origins.map(row => row[0]))].map(name => ({ name, contents: new Uint8Array([1,2,3,4,5]) })),
      typeOrigins: origins.map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, packageId: id(2) })) } })
  for (const p of [id(5),id(71)]) f.objects.get(p).package.linkage.push({ originalId: id(2), upgradedId: id(72), upgradedVersion: 1n })
  for (const datatypeName of ['RuntimeDefinitionRegistryV8','PackRegistryV8','PartProfileKeyV8','PartProfileV8',
    'ExternalItemProductV8','ExternalAdmissionRecordV8','BaseItemHolderKeyV8','BaseItemOwnershipRecordV8']) {
    f.objects.get(id(71)).package.typeOrigins.push({ moduleName: 'runtime_v8', datatypeName, packageId: id(70) })
  }
  const rights = NativeSoulBindingBcs.parse(f.objects.get(id(13)).contents.value).rights
  const coin = `0x${'2'.padStart(64,'0')}::sui::SUI`
  const registryIds = { runtime_definition_registry_id: id(81), pack_registry_id: id(82), admission_authority_id: id(86),
    seal_registry_id: id(87), output_registry_id: id(88), soul_registry_id: id(19), physical_registry_id: id(89), market_registry_id: id(90) }
  f.put(id(10), `${ct('maker_v8','MakerRootV8')}<${coin}>`, EquipmentMakerBcs, {
    id: id(10), version: '8', core_original_package_id: id(2), core_callable_package_id: id(2), creator: id(11), owner: id(11),
    admin_cap_id: id(30), control_epoch: '0', lifecycle: 1, maker_key: 'fixture', maker_version: '1', version_commitment: h(6),
    previous_root_id: null, previous_version_commitment: null, successor_authority_id: null, successor_root_id: null,
    maker_document_commitment: h(1), creator_defaults_commitment: h(2), living_content_binding_commitment: h(3),
    content: { renderer_commitment: h(4), manifest_blob_id: 'fixture', manifest_sha256: h(5), content_commitment: h(1) },
    base_registry_id: id(85), maker_treasury_id: id(20), expected_base_definition_count: '1', expected_base_registry_commitment: h(9),
    expected_pack_admission_policy_commitment: h(8), economics: { protocol_config_id: id(1), protocol_config_revision: '1',
      protocol_config_commitment: h(1), protocol_treasury_id: id(31), payment_coin_type: coin, maker_access: 0, maker_price_atomic: '0',
      complete_mode: 0, complete_price_atomic: '0', complete_per_wallet_quota: '0', complete_total_cap: '0', primary_content_fee_bps: 0,
      fixed_complete_fee_atomic: '0', maker_market_fee_bps: 0, soul_market_fee_bps: 0, commitment: h(1) }, rights,
    publication: { catalog_id: id(32), release_commitments: { product_binding_commitment: h(1), call_cap_set_commitment: h(2) },
      registry_ids: registryIds, sealed_base_registry_commitment: h(7) }, created_at_ms: '0',
  })
  const protocol = { id: id(1), version: '8', core_original_package_id: id(2), core_callable_package_id: id(2),
    revision: '1', treasury_id: id(31), payment_coin_type: coin, primary_content_fee_bps: 0,
    fixed_complete_fee_atomic: '0', maker_market_fee_bps: 0, soul_market_fee_bps: 0, enabled: true, commitment: h(0) }
  protocol.commitment = equipmentProtocolCommitment(protocol)
  f.put(id(1), ct('protocol_config_v8','ProtocolConfigV8'), EquipmentProtocolBcs, protocol)
  f.set(id(10), EquipmentMakerBcs, root => {
    root.economics.protocol_config_commitment = protocol.commitment
    root.economics.commitment = equipmentEconomicsCommitment(root.economics)
  })
  const t = (n: number, size = '0') => ({ id: id(n), size })
  f.put(id(81), rt('RuntimeDefinitionRegistryV8'), EquipmentDefinitionsBcs, { id: id(81), version: '8', root_id: id(10), root_version: '1',
    root_content_commitment: h(1), base_registry_id: id(85), expected_profile_count: '1', observed_profile_count: '1', expected_profile_commitment: h(1),
    rolling_profile_commitment: h(1), admission_ceiling: 2, item_assetization: true, sealed: true, profile_keys: ['body'], profiles: t(91,'1') })
  f.put(id(82), rt('PackRegistryV8'), EquipmentPackRegistryBcs, { id: id(82), version: '8', root_id: id(10), root_version: '1', root_content_commitment: h(1),
    definition_registry_id: id(81), admission_authority_id: id(86), admission_policy_commitment: h(8), revision: '0', release_count: '0',
    external_admission_count: '0', wardrobe_revision: '0', base_item_count: '1', releases: t(92), semantic_releases: t(93), external_admissions: t(94), base_item_owners: t(95,'1') })
  const counts = { tracks: '1', colors: '1', parts: '1', items: '1', styles: '1', rules: '0', assets: '1' }
  const commitments = { tracks: h(1), colors: h(1), parts: h(1), items: h(1), styles: h(1), rules: h(1), assets: h(1), aggregate: h(7) }
  f.put(id(85), ct('base_registry_v8','BaseDefinitionRegistryV8'), EquipmentBaseRegistryBcs, { id: id(85), version: '8', root_id: id(10), maker_version: '1',
    root_content_commitment: h(1), expected_counts: counts, observed_counts: counts, initial_commitments: commitments, rolling_commitments: commitments,
    sealed_commitments: commitments, next_sequence: '1', expected_sequence_count: '1', protected_style_count: '0', color_swatch_count: '1',
    total_capacity: '1', rule_selector_count: '0', visibility_leaf_count: '0', author_rows_rolling_commitment: h(9), sealed: true })
  function field(parent: string, keyType: string, keySchema: any, key: any, valueType: string, schema: any, value: any) {
    const objectId = deriveDynamicFieldID(parent, keyType, keySchema.serialize(key).toBytes())
    f.put(objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, bcs.struct('Field', { id: A, name: keySchema, value: schema }),
      { id: objectId, name: key, value }, 2, parent)
    return objectId
  }
  const profileId = field(id(91), rt('PartProfileKeyV8'), bcs.struct('PartProfileKeyV8', { part_key: S }), { part_key: 'body' }, rt('PartProfileV8'), EquipmentProfileBcs,
    { index: '0', part_key: 'body', core_part_payload_commitment: h(1), required: false, wardrobe_mode: 1, behavior: 3, capacity: '1', admission_ceiling: 2, profile_commitment: h(1) })
  f.put(id(20), `${ct('treasury_v8','MakerTreasuryV8')}<${coin}>`, bcs.struct('MakerTreasuryV8', { id: A, version: U, root_id: A, maker_version: U,
    root_content_commitment: V, revenue: bcs.struct('Balance', { value: U }), total_collected: bcs.u128(), total_withdrawn: bcs.u128() }),
    { id: id(20), version: '8', root_id: id(10), maker_version: '1', root_content_commitment: h(1), revenue: { value: '0' }, total_collected: '0', total_withdrawn: '0' })
  const accessId = field(id(20), ct('treasury_v8','MakerAccessKeyV8'), bcs.struct('Key', { holder: A }), { holder: id(11) }, ct('treasury_v8','MakerAccessRecordV8'),
    bcs.struct('Record', { pass_id: A, holder: A, paid_atomic: U, issued_at_ms: U }), { pass_id: id(83), holder: id(11), paid_atomic: '0', issued_at_ms: '0' })
  f.put(id(83), ct('treasury_v8','MakerAccessPassV8'), EquipmentAccessPassBcs, { id: id(83), version: '8', root_id: id(10), maker_version: '1',
    root_content_commitment: h(1), holder: id(11), paid_atomic: '0', issued_at_ms: '0' }, 1, id(11))
  f.editLoadout(v => { v.maker_access_commitment = equipmentAccessCommitment(EquipmentAccessPassBcs.parse(f.objects.get(id(83)).contents.value)) })
  const ownershipId = field(id(95), rt('BaseItemHolderKeyV8'), EquipmentBaseHolderKeyBcs,
    { part_key: 'body', item_key: 'hat', holder: id(11) }, rt('BaseItemOwnershipRecordV8'), EquipmentBaseOwnershipBcs,
    { item_id: id(84), ownership_epoch: '0' })
  const trackId = field(id(85), ct('base_registry_v8','TrackKeyV8'), bcs.struct('TrackKeyV8', { key: S }),
    { key: 'front' }, ct('base_registry_v8','TrackRowV2'), EquipmentTrackRowBcs,
    { sequence: '0', key: 'front', label: 'Front', render_order: '0', locked: true })
  const key = { part_key: 'body', item_key: 'hat', style_key: 'red' }; const Key = bcs.struct('StyleKeyV8', { part_key: S, item_key: S, style_key: S })
  const indexId = field(id(85), ct('base_registry_v8','StyleIndexKeyV8'), bcs.struct('IndexKey', { index: U }), { index: '0' }, ct('base_registry_v8','StyleKeyV8'), Key, key)
  const zero = { negative: false, magnitude: '0' }
  const style = { sequence: '1', ...key, label: 'Red hat', display_order: '0', track_key: 'front', color_channel_key: 'tint', default_swatch_key: 'red',
    asset_id: 'hat', asset_blob_id: 'blob', asset_sha256: h(3), protected: false, transform: { x_milli: zero, y_milli: zero, scale_ppm: '1000000', rotation_millidegrees: zero },
    opacity_ppm: '1000000', blend_mode: 0, physical: null, visibility_tokens: [], visibility_commitment: h(1), payload_commitment: h(4) }
  const styleId = field(id(85), ct('base_registry_v8','StyleKeyV8'), Key, key, ct('base_registry_v8','StyleRowV2'), EquipmentStyleRowBcs, style)
  field(id(85), ct('base_registry_v8','ItemKeyV8'), bcs.struct('ItemKey', { part_key: S, item_key: S }), { part_key: 'body', item_key: 'hat' }, ct('base_registry_v8','ItemRowV2'),
    EquipmentItemRowBcs, { sequence: '0', part_key: 'body', item_key: 'hat', label: 'Hat', status: 0, display_order: '0', default_style_key: 'red',
      visibility_tokens: [], visibility_commitment: h(1), payload_commitment: h(4) })
  field(id(85), ct('base_registry_v8','ColorKeyV8'), bcs.struct('ColorKey', { channel_key: S }), { channel_key: 'tint' }, ct('base_registry_v8','ColorChannelRowV2'),
    EquipmentColorRowBcs, { sequence: '0', key: 'tint', label: 'Tint', default_swatch_key: 'red', swatches: [{ key: 'red', label: 'Red', rgba: 4278190335, stops: [] }] })
  function addExternal() {
    const productId = id(101); const itemId = id(102)
    f.put(productId, rt('ExternalItemProductV8'), EquipmentExternalProductBcs, {
      id: productId, version: '8', root_id: id(10), root_version: '1', root_content_commitment: h(1),
      creator: id(11), owner: id(11), control_epoch: '0', admin_cap_id: id(103), lifecycle: 0,
      part_key: 'body', item_key: 'external-hat', style_key: 'blue', layer_track_key: 'front',
      color_channel_key: null, default_swatch_key: null, asset_blob_id: 'external-blob', asset_sha256: h(4),
      asset_media_type: 'image/png', asset_byte_length: '100', asset_content_commitment: h(5),
      compatibility_commitment: h(6), content_commitment: h(7), transferable: true, supply: '1',
    })
    const admissionId = field(id(94), '0x2::object::ID', A, productId,
      rt('ExternalAdmissionRecordV8'), EquipmentExternalAdmissionBcs, {
        product_id: productId, compatibility_commitment: h(6), product_content_commitment: h(7),
        attestation_commitment: null, admitted_revision: '1', admission_state: 0,
      })
    f.set(id(82), EquipmentPackRegistryBcs, v => {
      v.external_admission_count = '1'; v.external_admissions.size = '1'; v.revision = '1'
    })
    f.put(itemId, rt('OwnedExternalItemV8'), EquipmentExternalItemBcs, {
      id: itemId, version: '8', product_id: productId, product_content_commitment: h(7), asset_content_commitment: h(5),
      holder: id(11), ownership_epoch: '0', transferable: true, equip_lock: null,
    }, 1, id(11))
    ;(f.client.core as any).listOwnedObjects = async () => ({ objects: [{ objectId: itemId,
      type: rt('OwnedExternalItemV8'), owner: { $kind: 'AddressOwner', AddressOwner: id(11) } }], hasNextPage: false, cursor: null })
    return { productId, itemId, admissionId,
      read: () => readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14),
        source: {}, inventory: { kind: 'external' } }) }
  }
  return { ...f, field, ct, profileId, accessId, styleId, indexId, style, addExternal, ownershipId, trackId,
    readBase: (styleStart = 0) => readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14),
      source: { styleStart }, inventory: { kind: 'base', itemId: id(84) } }),
    readSource: (styleStart = 0) => readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14), source: { styleStart } }) }
}
