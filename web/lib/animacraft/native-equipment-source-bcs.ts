import { bcs } from '@mysten/sui/bcs'
import { NativeRightsBcs } from './native-receive'
const A = bcs.Address; const U = bcs.u64(); const V = bcs.vector(bcs.u8()); const S = bcs.string(); const B = bcs.bool()
const Table = bcs.struct('Table', { id: A, size: U })
const RegistryIds = bcs.struct('MakerRuntimeCompanionRegistryIdsV2', {
  runtime_definition_registry_id: A, pack_registry_id: A, admission_authority_id: A,
  seal_registry_id: A, output_registry_id: A, soul_registry_id: A, physical_registry_id: A, market_registry_id: A,
})
const economicsFields = {
  protocol_config_id: A, protocol_config_revision: U, protocol_config_commitment: V, protocol_treasury_id: A,
  payment_coin_type: S, maker_access: bcs.u8(), maker_price_atomic: U, complete_mode: bcs.u8(),
  complete_price_atomic: U, complete_per_wallet_quota: U, complete_total_cap: U,
  primary_content_fee_bps: bcs.u16(), fixed_complete_fee_atomic: U,
  maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(),
}
export const EquipmentEconomicsBcs = bcs.struct('EconomicsSnapshotV8', { ...economicsFields, commitment: V })
export const EquipmentEconomicsCommitmentBcs = bcs.struct('EconomicsCommitmentInputV8', { domain: V, version: U, ...economicsFields })
export const EquipmentProtocolBcs = bcs.struct('ProtocolConfigV8', {
  id: A, version: U, core_original_package_id: A, core_callable_package_id: A, revision: U,
  treasury_id: bcs.option(A), payment_coin_type: S, primary_content_fee_bps: bcs.u16(), fixed_complete_fee_atomic: U,
  maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(), enabled: B, commitment: V,
})
export const EquipmentProtocolCommitmentBcs = bcs.struct('ProtocolConfigCommitmentInputV2', {
  domain: S, schema_revision: U, config_id: A, config_revision: U, enabled: B,
  core_original_package_id: A, core_callable_package_id: A, treasury_id: bcs.option(A), payment_coin_type: S,
  primary_content_fee_bps: bcs.u16(), fixed_complete_fee_atomic: U, maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(),
})
export const EquipmentMakerBcs = bcs.struct('MakerRootV8', {
  id: A, version: U, core_original_package_id: A, core_callable_package_id: A, creator: A, owner: A,
  admin_cap_id: A, control_epoch: U, lifecycle: bcs.u8(), maker_key: S, maker_version: U, version_commitment: V,
  previous_root_id: bcs.option(A), previous_version_commitment: bcs.option(V), successor_authority_id: bcs.option(A),
  successor_root_id: bcs.option(A), maker_document_commitment: V, creator_defaults_commitment: V, living_content_binding_commitment: V,
  content: bcs.struct('MakerContentSnapshotV2', { renderer_commitment: V, manifest_blob_id: S, manifest_sha256: V, content_commitment: V }),
  base_registry_id: bcs.option(A), maker_treasury_id: bcs.option(A), expected_base_definition_count: U,
  expected_base_registry_commitment: V, expected_pack_admission_policy_commitment: V, economics: EquipmentEconomicsBcs, rights: NativeRightsBcs,
  publication: bcs.struct('MakerPublicationStateV2', { catalog_id: bcs.option(A),
    release_commitments: bcs.option(bcs.struct('ProductReleaseCommitmentsV2', { product_binding_commitment: V, call_cap_set_commitment: V })),
    registry_ids: bcs.option(RegistryIds), sealed_base_registry_commitment: bcs.option(V) }), created_at_ms: U,
})
export const EquipmentDefinitionsBcs = bcs.struct('RuntimeDefinitionRegistryV8', {
  id: A, version: U, root_id: A, root_version: U, root_content_commitment: V, base_registry_id: A,
  expected_profile_count: U, observed_profile_count: U, expected_profile_commitment: V, rolling_profile_commitment: V,
  admission_ceiling: bcs.u8(), item_assetization: B, sealed: B, profile_keys: bcs.vector(S), profiles: Table,
})
export const EquipmentProfileBcs = bcs.struct('PartProfileV8', {
  index: U, part_key: S, core_part_payload_commitment: V, required: B, wardrobe_mode: bcs.u8(),
  behavior: bcs.u8(), capacity: U, admission_ceiling: bcs.u8(), profile_commitment: V,
})
export const EquipmentPackRegistryBcs = bcs.struct('PackRegistryV8', {
  id: A, version: U, root_id: A, root_version: U, root_content_commitment: V, definition_registry_id: A,
  admission_authority_id: A, admission_policy_commitment: V, revision: U, release_count: U, external_admission_count: U,
  wardrobe_revision: U, base_item_count: U, releases: Table, semantic_releases: Table, external_admissions: Table, base_item_owners: Table,
})
export const EquipmentExternalProductBcs = bcs.struct('ExternalItemProductV8', {
  id: A, version: U, root_id: A, root_version: U, root_content_commitment: V, creator: A, owner: A,
  control_epoch: U, admin_cap_id: A, lifecycle: bcs.u8(), part_key: S, item_key: S, style_key: S, layer_track_key: S,
  color_channel_key: bcs.option(S), default_swatch_key: bcs.option(S), asset_blob_id: S, asset_sha256: V,
  asset_media_type: S, asset_byte_length: U, asset_content_commitment: V, compatibility_commitment: V,
  content_commitment: V, transferable: B, supply: U,
})
export const EquipmentExternalAdmissionBcs = bcs.struct('ExternalAdmissionRecordV8', {
  product_id: A, compatibility_commitment: V, product_content_commitment: V, attestation_commitment: bcs.option(V),
  admitted_revision: U, admission_state: bcs.u8(),
})
export const EquipmentAccessPassBcs = bcs.struct('MakerAccessPassV8', {
  id: A, version: U, root_id: A, maker_version: U, root_content_commitment: V, holder: A, paid_atomic: U, issued_at_ms: U,
})
export const EquipmentAccessEntitlementBcs = bcs.struct('MakerAccessEntitlementCommitmentInputV8', {
  domain: V, version: U, pass_id: A, root_id: A, maker_version: U, root_content_commitment: V,
  holder: A, paid_atomic: U, issued_at_ms: U,
})
export const EquipmentBaseHolderKeyBcs = bcs.struct('BaseItemHolderKeyV8', { part_key: S, item_key: S, holder: A })
export const EquipmentBaseOwnershipBcs = bcs.struct('BaseItemOwnershipRecordV8', { item_id: A, ownership_epoch: U })
export const EquipmentTrackRowBcs = bcs.struct('TrackRowV2', { sequence: U, key: S, label: S, render_order: U, locked: B })
export const EquipmentAssetRowBcs = bcs.struct('AssetRowV2', {
  sequence: U, asset_id: S, kind: S, media_type: S, byte_length: U, sha256: V,
})
const Counts = bcs.struct('BaseDefinitionCountsV8', { tracks: U, colors: U, parts: U, items: U, styles: U, rules: U, assets: U })
const Commitments = bcs.struct('BaseDefinitionCommitmentsV8', { tracks: V, colors: V, parts: V, items: V, styles: V, rules: V, assets: V, aggregate: V })
export const EquipmentBaseRegistryBcs = bcs.struct('BaseDefinitionRegistryV8', {
  id: A, version: U, root_id: A, maker_version: U, root_content_commitment: V, expected_counts: Counts, observed_counts: Counts,
  initial_commitments: Commitments, rolling_commitments: Commitments, sealed_commitments: bcs.option(Commitments),
  next_sequence: U, expected_sequence_count: U, protected_style_count: U, color_swatch_count: U, total_capacity: U,
  rule_selector_count: U, visibility_leaf_count: U, author_rows_rolling_commitment: V, sealed: B,
})
export const EquipmentSemanticSelectorBcs = bcs.struct('SemanticSelectorV2', { source: bcs.u8(), source_key: bcs.option(S), part_key: S, item_key: bcs.option(S), style_key: bcs.option(S) })
const Selector = EquipmentSemanticSelectorBcs
export const EquipmentVisibilityTokensBcs = bcs.vector(bcs.struct('VisibilityTokenV1', { opcode: bcs.u8(), selector: bcs.option(Selector), arity: bcs.u16() }))
const Visibility = EquipmentVisibilityTokensBcs
export const EquipmentPartRowBcs = bcs.struct('PartRowV2', {
  sequence: U, key: S, label: S, kind: bcs.u8(), render_order: U, menu_order: U, visible: B,
  required: B, slot_mode: bcs.u8(), capacity: U, track_keys: bcs.vector(S),
  visibility_tokens: Visibility, visibility_commitment: V, payload_commitment: V,
})
const Signed = bcs.struct('SignedMilliV1', { negative: B, magnitude: U })
export const EquipmentItemRowBcs = bcs.struct('ItemRowV2', {
  sequence: U, part_key: S, item_key: S, label: S, status: bcs.u8(), display_order: U, default_style_key: S,
  visibility_tokens: Visibility, visibility_commitment: V, payload_commitment: V,
})
export const EquipmentStyleRowBcs = bcs.struct('StyleRowV2', {
  sequence: U, part_key: S, item_key: S, style_key: S, label: S, display_order: U, track_key: S,
  color_channel_key: bcs.option(S), default_swatch_key: bcs.option(S), asset_id: S, asset_blob_id: S, asset_sha256: V, protected: B,
  transform: bcs.struct('TransformFixedV1', { x_milli: Signed, y_milli: Signed, scale_ppm: U, rotation_millidegrees: Signed }),
  opacity_ppm: U, blend_mode: bcs.u8(), physical: bcs.option(bcs.struct('PhysicalPolicyV1', {
    material: S, issuance: bcs.u8(), proof: bcs.u8(), price_atomic: U, max_supply: U, transferable: B,
  })), visibility_tokens: Visibility, visibility_commitment: V, payload_commitment: V,
})
export const EquipmentColorRowBcs = bcs.struct('ColorChannelRowV2', { sequence: U, key: S, label: S, default_swatch_key: S,
  swatches: bcs.vector(bcs.struct('ColorSwatchV2', { key: S, label: S, rgba: bcs.u32(),
    stops: bcs.vector(bcs.struct('ColorStopV2', { offset_ppm: U, rgba: bcs.u32() })) })) })
