import { Transaction } from '@mysten/sui/transactions'
import { isValidTransactionDigest, normalizeStructTag } from '@mysten/sui/utils'
import { buildExactPaymentCoin } from './buy'

/** Explicit certified deployment inputs, not an ownership or listing proof. */
export interface AnimacraftEquipmentMarketV8Target {
  marketCallablePackageId: string
  paymentCoinType: string
  registryId: string
  treasuryId: string
  rootId: string
  protocolConfigId: string
  catalogId: string
  replacementId: string
  packageConfigId: string
}
export type AnimacraftEquipmentMarketV8Asset =
  | { kind: 'base'; itemId: string; packRegistryId: string; definitionRegistryId: string; baseRegistryId: string }
  | { kind: 'external'; itemId: string; productId: string }
export interface AnimacraftEquipmentMarketV8Receiving {
  objectId: string
  version: string
  digest: string
}
export type AnimacraftEquipmentMarketV8Listing = {
  target: AnimacraftEquipmentMarketV8Target
  listingId: string
  expectedRevision: string
  receiving: AnimacraftEquipmentMarketV8Receiving
} & ({ kind: 'base'; packRegistryId: string; definitionRegistryId: string } | { kind: 'external' })

const MAX_U64 = (1n << 64n) - 1n
const targetIds = ['registryId', 'treasuryId', 'rootId', 'protocolConfigId', 'catalogId',
  'replacementId', 'packageConfigId'] as const
function id(value: unknown) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error('Equipment Market requires canonical nonzero object IDs')
  }
}
function integer(value: unknown, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)
    || BigInt(value) > MAX_U64 || (positive && BigInt(value) === 0n)) {
    throw new Error('Equipment Market requires an exact u64 string')
  }
}
function price(value: unknown): asserts value is bigint {
  // Existing floor-bps economics reject prices whose protocol fee rounds to zero.
  if (typeof value !== 'bigint' || value < 40n || value > MAX_U64) {
    throw new Error('Equipment price must be an exact u64 bigint with a nonzero 2.5% fee')
  }
}
function distinct(values: string[]) {
  values.forEach(id)
  if (new Set(values).size !== values.length) throw new Error('Equipment Market object roles must be distinct')
}
function target(value: AnimacraftEquipmentMarketV8Target): string[] {
  id(value.marketCallablePackageId)
  if (typeof value.paymentCoinType !== 'string' || !value.paymentCoinType.includes('::')) {
    throw new Error('Equipment payment coin type is required')
  }
  normalizeStructTag(value.paymentCoinType)
  const ids = [value.marketCallablePackageId, ...targetIds.map(key => value[key])]
  distinct(ids)
  return ids
}
function kind(value: unknown): asserts value is 'base' | 'external' {
  if (value !== 'base' && value !== 'external') throw new Error('Unsupported equipment kind')
}
function common(tx: Transaction, t: AnimacraftEquipmentMarketV8Target, protocol: boolean) {
  return [t.registryId, t.treasuryId, t.rootId, ...(protocol ? [t.protocolConfigId] : []),
    t.catalogId, t.replacementId, t.packageConfigId].map(value => tx.object(value))
}
function call(tx: Transaction, t: AnimacraftEquipmentMarketV8Target, name: string,
  args: Parameters<Transaction['moveCall']>[0]['arguments']) {
  return tx.moveCall({ target: `${t.marketCallablePackageId}::market_v8::${name}`,
    typeArguments: [normalizeStructTag(t.paymentCoinType)], arguments: args })
}

/** Append exactly one selected instance. Optional prior unequip must finish first. */
export function appendListAnimacraftEquipmentV8(tx: Transaction, input: {
  target: AnimacraftEquipmentMarketV8Target; asset: AnimacraftEquipmentMarketV8Asset; priceAtomic: bigint
}) {
  const p = structuredClone(input), a = p.asset
  const ids = target(p.target); kind(a.kind); price(p.priceAtomic)
  distinct([...ids, a.itemId, ...(a.kind === 'base'
    ? [a.packRegistryId, a.definitionRegistryId, a.baseRegistryId] : [a.productId])])
  const scope = a.kind === 'base' ? [a.packRegistryId, a.definitionRegistryId, a.baseRegistryId] : [a.productId]
  return call(tx, p.target, `list_${a.kind}_equipment_v8`, [...common(tx, p.target, true),
    ...scope.map(value => tx.object(value)), tx.object(a.itemId), tx.pure.u64(p.priceAtomic)])
}
export function buildListAnimacraftEquipmentV8Tx(input: Parameters<typeof appendListAnimacraftEquipmentV8>[1]) {
  const tx = new Transaction(); appendListAnimacraftEquipmentV8(tx, input); return tx
}

function listing(p: AnimacraftEquipmentMarketV8Listing) {
  const ids = target(p.target); kind(p.kind); integer(p.expectedRevision)
  integer(p.receiving.version, true)
  if (typeof p.receiving.digest !== 'string' || !isValidTransactionDigest(p.receiving.digest)) {
    throw new Error('Equipment Receiving requires an exact object digest')
  }
  const all = [...ids, p.listingId, p.receiving.objectId,
    ...(p.kind === 'base' ? [p.packRegistryId, p.definitionRegistryId] : [])]
  distinct(all)
  return all
}

export function buildBuyAnimacraftEquipmentV8Tx(input: AnimacraftEquipmentMarketV8Listing & {
  protocolTreasuryId: string; priceAtomic: bigint; paymentCoinObjectIds: string[]
}) {
  const p = structuredClone(input), ids = listing(p); price(p.priceAtomic)
  if (!Array.isArray(p.paymentCoinObjectIds) || !p.paymentCoinObjectIds.length) throw new Error('Payment coins are required')
  distinct([...ids, p.protocolTreasuryId, ...p.paymentCoinObjectIds])
  const tx = new Transaction(), t = p.target
  const payment = buildExactPaymentCoin(tx, p.paymentCoinObjectIds, p.priceAtomic)
  call(tx, t, `purchase_${p.kind}_equipment_v8`, [tx.object(p.listingId),
    ...[t.registryId, t.treasuryId, t.rootId, t.protocolConfigId, p.protocolTreasuryId,
      t.catalogId, t.replacementId, t.packageConfigId].map(value => tx.object(value)),
    ...(p.kind === 'base' ? [tx.object(p.packRegistryId), tx.object(p.definitionRegistryId)] : []),
    tx.receivingRef(p.receiving), payment, tx.pure.u64(p.expectedRevision)])
  return tx
}

export function buildRepriceAnimacraftEquipmentV8Tx(input: {
  target: AnimacraftEquipmentMarketV8Target; listingId: string; expectedRevision: string; priceAtomic: bigint
}) {
  const p = structuredClone(input)
  distinct([...target(p.target), p.listingId]); integer(p.expectedRevision); price(p.priceAtomic)
  const tx = new Transaction()
  call(tx, p.target, 'reprice_equipment_listing_v8', [tx.object(p.listingId), ...common(tx, p.target, true),
    tx.pure.u64(p.expectedRevision), tx.pure.u64(p.priceAtomic)])
  return tx
}

function returnListing(input: AnimacraftEquipmentMarketV8Listing, recovery: boolean) {
  const p = structuredClone(input); listing(p)
  const tx = new Transaction()
  call(tx, p.target, `${recovery ? 'recover' : 'cancel'}_${p.kind}_equipment_listing_v8`, [
    tx.object(p.listingId), ...common(tx, p.target, recovery),
    ...(p.kind === 'base' ? [tx.object(p.packRegistryId), tx.object(p.definitionRegistryId)] : []),
    tx.receivingRef(p.receiving), tx.pure.u64(p.expectedRevision)])
  return tx
}
/** Returns only to the on-chain seller, even when Root/protocol is paused. */
export function buildCancelAnimacraftEquipmentV8Tx(input: AnimacraftEquipmentMarketV8Listing) {
  return returnListing(input, false)
}
/** Permissionless only under the contract's existing recovery conditions. */
export function buildRecoverAnimacraftEquipmentV8Tx(input: AnimacraftEquipmentMarketV8Listing) {
  return returnListing(input, true)
}
