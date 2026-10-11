import { bcs } from '@mysten/sui/bcs'

// Exact current Move field order: market_v8::{EquipmentListingV8,
// MarketRegistryV8, MarketTreasuryV8, MarketPackageConfigV8,
// MarketQuoteCommitmentInputV8}, runtime_v8::EquipmentMarketCustodyBindingV8,
// and package_binding_v8::RuntimeCallerCapV1. UID/ID wrap one address and
// therefore use the same 32-byte BCS encoding. Registry has no version/Table;
// Balance retains its one u64 `value`. Decode with decodeNativeBcs so trailing
// bytes and noncanonical representations cannot be accepted as chain evidence.
const A = bcs.Address, U = bcs.u64(), V = bcs.vector(bcs.u8())
const Balance = bcs.struct('Balance', { value: U })

export const EquipmentMarketRuntimeCallerCapBcs = bcs.struct('RuntimeCallerCapV1', {
  schema_revision: U,
  role: bcs.u8(),
  catalog_id: A,
  replacement_binding_id: A,
  package_tuple_commitment: V,
  caller_original_package_id: A,
  caller_callable_package_id: A,
  call_cap_set_commitment: V,
  cap_commitment: V,
})

export const EquipmentMarketConfigBcs = bcs.struct('MarketPackageConfigV8', {
  id: A,
  version: U,
  catalog_id: A,
  product_binding_commitment: V,
  call_cap_set_commitment: V,
  installation_commitment: V,
  runtime_caller_cap: bcs.option(EquipmentMarketRuntimeCallerCapBcs),
})

export const EquipmentMarketCustodyBcs = bcs.struct('EquipmentMarketCustodyBindingV8', {
  version: U,
  catalog_id: A,
  product_binding_commitment: V,
  call_cap_set_commitment: V,
  market_authority_id: A,
  market_registry_id: A,
  market_treasury_id: A,
  listing_id: A,
  root_id: A,
  maker_version: U,
  root_content_commitment: V,
  asset_id: A,
  asset_kind: bcs.u8(),
  source_id: A,
  asset_commitment: V,
  holder: A,
  ownership_epoch: U,
})

export const EquipmentMarketListingBcs = bcs.struct('EquipmentListingV8', {
  id: A,
  version: U,
  registry_id: A,
  treasury_id: A,
  package_config_id: A,
  root_id: A,
  maker_version: U,
  root_content_commitment: V,
  custody: EquipmentMarketCustodyBcs,
  gross_atomic: U,
  protocol_atomic: U,
  creator_atomic: U,
  source_atomic: U,
  seller_atomic: U,
  quote_commitment: V,
  status: bcs.u8(),
  revision: U,
  terminal_recipient: A,
})

export const EquipmentMarketRegistryBcs = bcs.struct('MarketRegistryV8', {
  id: A,
  catalog_id: A,
  package_config_id: A,
  product_binding_commitment: V,
  call_cap_set_commitment: V,
  root_id: A,
  maker_version: U,
  root_content_commitment: V,
  protocol_config_id: A,
  protocol_config_revision: U,
  protocol_config_commitment: V,
  economics_commitment: V,
  rights_commitment: V,
  maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
  soul_creator_royalty_bps: bcs.u16(),
  maker_source_royalty_bps: bcs.u16(),
  maker_resale_royalty_bps: bcs.u16(),
  treasury_id: A,
  sealed: bcs.bool(),
  revision: U,
  listing_count: U,
  escrow_count: U,
  completed_sale_count: U,
  canceled_sale_count: U,
  recovered_sale_count: U,
  gross_volume_atomic: bcs.u128(),
  protocol_paid_atomic: bcs.u128(),
  creator_paid_atomic: bcs.u128(),
  source_paid_atomic: bcs.u128(),
  seller_paid_atomic: bcs.u128(),
  zero_state_commitment: V,
})

export const EquipmentMarketTreasuryBcs = bcs.struct('MarketTreasuryV8', {
  id: A,
  version: U,
  catalog_id: A,
  package_config_id: A,
  root_id: A,
  maker_version: U,
  root_content_commitment: V,
  escrow: Balance,
  gross_escrowed_atomic: bcs.u128(),
  gross_released_atomic: bcs.u128(),
})

/** The domain is vector<u8>, not a struct name or JSON prefix. Equipment
 * quotes use quote_kind=3 and domain UTF-8 `animacraft-v8/market/quote`.
 * Policy/identity validation belongs to the authenticated reader. */
export const EquipmentMarketQuoteCommitmentBcs = bcs.struct('MarketQuoteCommitmentInputV8', {
  domain: V,
  version: U,
  quote_kind: bcs.u8(),
  root_id: A,
  maker_version: U,
  root_content_commitment: V,
  economics_commitment: V,
  rights_commitment: V,
  gross_atomic: U,
  protocol_atomic: U,
  creator_atomic: U,
  source_atomic: U,
  seller_atomic: U,
})

export const EquipmentMarketProtocolTreasuryBcs = bcs.struct('ProtocolTreasuryV8', {
  id: A, version: U, config_id: A, revenue: Balance,
  total_collected: bcs.u128(), total_withdrawn: bcs.u128(),
})

const replacementFields = {
  catalog_id: A,
  core_binding_commitment: V, seal_binding_commitment: V, runtime_binding_commitment: V,
  output_binding_commitment: V, physical_binding_commitment: V, market_binding_commitment: V,
  release_binding_commitment: V, package_tuple_commitment: V, call_cap_set_commitment: V,
  runtime_config_id: A, output_config_id: A, market_config_id: A, release_config_id: A,
}
export const EquipmentMarketReplacementBcs = bcs.struct('FreshTupleReplacementBindingV2', {
  id: A, version: U, ...replacementFields, binding_commitment: V,
})
export const EquipmentMarketReplacementCommitmentBcs = bcs.struct('FreshTupleReplacementBindingCommitmentInputV2', {
  domain: bcs.string(), schema_revision: U, binding_id: A, ...replacementFields,
})
export const EquipmentMarketCallerCapCommitmentBcs = bcs.struct('RuntimeCallerCapCommitmentInputV1', {
  domain: bcs.string(), schema_revision: U, role: bcs.u8(), catalog_id: A,
  replacement_binding_id: A, package_tuple_commitment: V, caller_original_package_id: A,
  caller_callable_package_id: A, call_cap_set_commitment: V,
})
export const EquipmentMarketZeroStateCommitmentBcs = bcs.struct('MarketZeroStateCommitmentInputV8', {
  domain: V, version: U, catalog_id: A, package_config_id: A,
  product_binding_commitment: V, call_cap_set_commitment: V, root_id: A, maker_version: U,
  root_content_commitment: V, protocol_config_id: A, protocol_config_revision: U,
  protocol_config_commitment: V, economics_commitment: V, rights_commitment: V,
  maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(),
  soul_creator_royalty_bps: bcs.u16(), maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16(),
  treasury_id: A,
})
