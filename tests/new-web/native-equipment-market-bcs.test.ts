import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { decodeNativeBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentMarketListingBcs, EquipmentMarketCustodyBcs, EquipmentMarketRegistryBcs,
  EquipmentMarketTreasuryBcs, EquipmentMarketConfigBcs, EquipmentMarketRuntimeCallerCapBcs,
  EquipmentMarketQuoteCommitmentBcs, EquipmentMarketProtocolTreasuryBcs, EquipmentMarketReplacementBcs,
  EquipmentMarketReplacementCommitmentBcs, EquipmentMarketCallerCapCommitmentBcs,
  EquipmentMarketZeroStateCommitmentBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'

// Independent field/type transcription from the current authoritative Move:
// market_v8.move, runtime_v8.move, package_binding_v8.move, protocol_config_v8.move.
// Each named tuple below serializes the Move fields directly, independently of
// the exported JS struct definitions. These are wire-layout fixtures, not live
// ownership, commitment or economic-policy evidence.
const fields: Record<string, string> = {
  RuntimeCallerCapV1: `schema_revision:u64 role:u8 catalog_id:ID replacement_binding_id:ID
    package_tuple_commitment:bytes caller_original_package_id:ID caller_callable_package_id:ID
    call_cap_set_commitment:bytes cap_commitment:bytes`,
  MarketPackageConfigV8: `id:UID version:u64 catalog_id:ID product_binding_commitment:bytes
    call_cap_set_commitment:bytes installation_commitment:bytes runtime_caller_cap:Option<RuntimeCallerCapV1>`,
  EquipmentMarketCustodyBindingV8: `version:u64 catalog_id:ID product_binding_commitment:bytes
    call_cap_set_commitment:bytes market_authority_id:ID market_registry_id:ID market_treasury_id:ID
    listing_id:ID root_id:ID maker_version:u64 root_content_commitment:bytes asset_id:ID asset_kind:u8
    source_id:ID asset_commitment:bytes holder:address ownership_epoch:u64`,
  EquipmentListingV8: `id:UID version:u64 registry_id:ID treasury_id:ID package_config_id:ID root_id:ID
    maker_version:u64 root_content_commitment:bytes custody:EquipmentMarketCustodyBindingV8
    gross_atomic:u64 protocol_atomic:u64 creator_atomic:u64 source_atomic:u64 seller_atomic:u64
    quote_commitment:bytes status:u8 revision:u64 terminal_recipient:address`,
  MarketRegistryV8: `id:UID catalog_id:ID package_config_id:ID product_binding_commitment:bytes
    call_cap_set_commitment:bytes root_id:ID maker_version:u64 root_content_commitment:bytes
    protocol_config_id:ID protocol_config_revision:u64 protocol_config_commitment:bytes economics_commitment:bytes
    rights_commitment:bytes maker_market_fee_bps:u16 soul_market_fee_bps:u16 soul_creator_royalty_bps:u16
    maker_source_royalty_bps:u16 maker_resale_royalty_bps:u16 treasury_id:ID sealed:bool revision:u64
    listing_count:u64 escrow_count:u64 completed_sale_count:u64 canceled_sale_count:u64 recovered_sale_count:u64
    gross_volume_atomic:u128 protocol_paid_atomic:u128 creator_paid_atomic:u128 source_paid_atomic:u128
    seller_paid_atomic:u128 zero_state_commitment:bytes`,
  Balance: 'value:u64',
  MarketTreasuryV8: `id:UID version:u64 catalog_id:ID package_config_id:ID root_id:ID maker_version:u64
    root_content_commitment:bytes escrow:Balance gross_escrowed_atomic:u128 gross_released_atomic:u128`,
  MarketQuoteCommitmentInputV8: `domain:bytes version:u64 quote_kind:u8 root_id:ID maker_version:u64
    root_content_commitment:bytes economics_commitment:bytes rights_commitment:bytes gross_atomic:u64
    protocol_atomic:u64 creator_atomic:u64 source_atomic:u64 seller_atomic:u64`,
  ProtocolTreasuryV8: 'id:UID version:u64 config_id:ID revenue:Balance total_collected:u128 total_withdrawn:u128',
  FreshTupleReplacementBindingV2: `id:UID version:u64 catalog_id:ID core_binding_commitment:bytes
    seal_binding_commitment:bytes runtime_binding_commitment:bytes output_binding_commitment:bytes
    physical_binding_commitment:bytes market_binding_commitment:bytes release_binding_commitment:bytes
    package_tuple_commitment:bytes call_cap_set_commitment:bytes runtime_config_id:ID output_config_id:ID
    market_config_id:ID release_config_id:ID binding_commitment:bytes`,
  FreshTupleReplacementBindingCommitmentInputV2: `domain:String schema_revision:u64 binding_id:ID catalog_id:ID
    core_binding_commitment:bytes seal_binding_commitment:bytes runtime_binding_commitment:bytes
    output_binding_commitment:bytes physical_binding_commitment:bytes market_binding_commitment:bytes
    release_binding_commitment:bytes package_tuple_commitment:bytes call_cap_set_commitment:bytes
    runtime_config_id:ID output_config_id:ID market_config_id:ID release_config_id:ID`,
  RuntimeCallerCapCommitmentInputV1: `domain:String schema_revision:u64 role:u8 catalog_id:ID
    replacement_binding_id:ID package_tuple_commitment:bytes caller_original_package_id:ID
    caller_callable_package_id:ID call_cap_set_commitment:bytes`,
  MarketZeroStateCommitmentInputV8: `domain:bytes version:u64 catalog_id:ID package_config_id:ID
    product_binding_commitment:bytes call_cap_set_commitment:bytes root_id:ID maker_version:u64
    root_content_commitment:bytes protocol_config_id:ID protocol_config_revision:u64 protocol_config_commitment:bytes
    economics_commitment:bytes rights_commitment:bytes maker_market_fee_bps:u16 soul_market_fee_bps:u16
    soul_creator_royalty_bps:u16 maker_source_royalty_bps:u16 maker_resale_royalty_bps:u16 treasury_id:ID`,
}
const rows = (name: string) => fields[name].trim().split(/\s+/).map(row => row.split(':') as [string, string])
const schemas = [EquipmentMarketRuntimeCallerCapBcs, EquipmentMarketConfigBcs, EquipmentMarketCustodyBcs,
  EquipmentMarketListingBcs, EquipmentMarketRegistryBcs, EquipmentMarketTreasuryBcs, EquipmentMarketQuoteCommitmentBcs,
  EquipmentMarketProtocolTreasuryBcs, EquipmentMarketReplacementBcs, EquipmentMarketReplacementCommitmentBcs,
  EquipmentMarketCallerCapCommitmentBcs, EquipmentMarketZeroStateCommitmentBcs]
const primitive = { UID: bcs.Address, ID: bcs.Address, address: bcs.Address, u64: bcs.u64(), u128: bcs.u128(),
  u16: bcs.u16(), u8: bcs.u8(), bool: bcs.bool(), bytes: bcs.vector(bcs.u8()), String: bcs.string() }
function wire(type: string): any {
  const option = type.match(/^Option<(.+)>$/)?.[1]
  if (option) return bcs.option(wire(option))
  return primitive[type as keyof typeof primitive] ?? bcs.tuple(rows(type).map(([, fieldType]) => wire(fieldType)))
}
function tupleValue(type: string, value: any): any {
  const option = type.match(/^Option<(.+)>$/)?.[1]
  if (option) return value === null ? null : tupleValue(option, value)
  if (type in primitive) return value
  return rows(type).map(([field, fieldType]) => tupleValue(fieldType, value[field]))
}
const domains: Record<string, string> = {
  MarketQuoteCommitmentInputV8: 'animacraft-v8/market/quote',
  MarketZeroStateCommitmentInputV8: 'animacraft-v8/market/zero-state',
  RuntimeCallerCapCommitmentInputV1: 'animacraft-fresh-v8/core/runtime-caller-cap/v1',
  FreshTupleReplacementBindingCommitmentInputV2: 'animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2',
}
function sample(name: string, start = 1): Record<string, any> {
  return Object.fromEntries(rows(name).map(([field, type], index) => {
    const n = start + index
    const value = type === 'u64' ? String(9007199254740993n + BigInt(n))
      : type === 'u128' ? String((1n << 100n) + BigInt(n))
      : type === 'u16' || type === 'u8' ? n % 200
      : ['UID', 'ID', 'address'].includes(type) ? '0x' + n.toString(16).padStart(64, '0')
      : type === 'bool' ? true
      : type === 'bytes' ? field === 'domain' ? [...new TextEncoder().encode(domains[name])] : Array(32).fill(n % 256)
      : type === 'String' ? domains[name]
      : sample(type.startsWith('Option<') ? type.slice(7, -1) : type, n + 20)
    return [field, value]
  }))
}

it.each(schemas)('$name matches every current Move field and type in canonical byte order', schema => {
  const value = sample(schema.name)
  const expected = wire(schema.name).serialize(tupleValue(schema.name, value)).toBytes()
  expect(schema.serialize(value as never).toBytes()).toEqual(expected)
  const parsed = decodeNativeBcs(schema, expected)
  expect(parsed).toEqual(value)
  expect(Object.keys(parsed)).toEqual(rows(schema.name).map(([field]) => field))
})

it.each(schemas)('$name rejects trailing bytes and truncation via the shared canonical decoder', schema => {
  const bytes = schema.serialize(sample(schema.name) as never).toBytes()
  expect(() => decodeNativeBcs(schema, new Uint8Array([...bytes, 0]))).toThrow('Noncanonical BCS')
  expect(() => decodeNativeBcs(schema, bytes.slice(0, -1))).toThrow()
})

it('preserves both installed and absent caller-cap Options without inventing a UID on the cap', () => {
  const value = sample('MarketPackageConfigV8'); value.runtime_caller_cap = null
  const bytes = EquipmentMarketConfigBcs.serialize(value as never).toBytes()
  expect(decodeNativeBcs(EquipmentMarketConfigBcs, bytes).runtime_caller_cap).toBeNull()
  expect(bytes.at(-1)).toBe(0)
  const cap = sample('RuntimeCallerCapV1')
  const installed = EquipmentMarketConfigBcs.serialize({ ...value, runtime_caller_cap: cap } as never).toBytes()
  const capBytes = EquipmentMarketRuntimeCallerCapBcs.serialize(cap as never).toBytes()
  expect(installed).toEqual(new Uint8Array([...bytes.slice(0, -1), 1, ...capBytes]))
  expect(() => decodeNativeBcs(EquipmentMarketConfigBcs,
    new Uint8Array([...bytes.slice(0, -1), 2, ...capBytes, ...capBytes]))).toThrow()
})

it('preserves u64/u128 maxima and the Balance wrapper without JavaScript number rounding', () => {
  const value = sample('MarketTreasuryV8')
  value.escrow = { value: '18446744073709551615' }
  value.gross_escrowed_atomic = '340282366920938463463374607431768211455'
  value.gross_released_atomic = '18446744073709551617'
  expect(decodeNativeBcs(EquipmentMarketTreasuryBcs,
    EquipmentMarketTreasuryBcs.serialize(value as never).toBytes())).toEqual(value)
})

it('does not add a version or Table to MarketRegistry, and keeps commitments length-prefixed', () => {
  const value = sample('MarketRegistryV8'), bytes = EquipmentMarketRegistryBcs.serialize(value as never).toBytes()
  expect(bytes.slice(0, 64)).toEqual(new Uint8Array([
    ...bcs.Address.serialize(value.id).toBytes(), ...bcs.Address.serialize(value.catalog_id).toBytes(),
  ]))
  expect(rows('MarketRegistryV8').some(([field, type]) => field === 'version' || type === 'Table')).toBe(false)
  const custody = sample('EquipmentMarketCustodyBindingV8')
  custody.asset_commitment = Array.from({ length: 128 }, (_, index) => index)
  const encoded = EquipmentMarketCustodyBcs.serialize(custody as never).toBytes()
  expect(encoded).toEqual(wire('EquipmentMarketCustodyBindingV8')
    .serialize(tupleValue('EquipmentMarketCustodyBindingV8', custody)).toBytes())
  expect(decodeNativeBcs(EquipmentMarketCustodyBcs, encoded).asset_commitment).toHaveLength(128)
  // A hash's exact 32-byte policy belongs to the reader, not the Move vector codec.
})
