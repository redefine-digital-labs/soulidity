import { Transaction } from '@mysten/sui/transactions'
import { buildExactPaymentCoin } from './buy'
import { buildBuyerKioskArgs, finishBuyerKioskArgs } from './shared'

/** Explicit target metadata, not a live deployment, listing or ownership proof. */
export interface AnimacraftV8MarketTarget {
  soulidityCallablePackageId: string
  marketConfigV2Id: string
  kioskRegistryId: string
  soulTransferPolicyId: string
  kioskPackageId: string
}
export interface AnimacraftV8SoulListingScope {
  target: AnimacraftV8MarketTarget
  soulStateId: string
  provenanceBindingId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}
export interface AnimacraftV8SoulCancelScope {
  soulidityCallablePackageId: string
  soulStateId: string
  listingId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}

const U64_MAX = (1n << 64n) - 1n
function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error(`${label} must be a canonical nonzero object ID`)
  }
}
function price(value: unknown): asserts value is bigint {
  if (typeof value !== 'bigint' || value <= 0n || value > U64_MAX) {
    throw new Error('priceAtomic must be a positive exact u64 bigint')
  }
}
function target(value: AnimacraftV8MarketTarget) {
  if (!value) throw new Error('An explicit native Market target is required')
  for (const field of ['soulidityCallablePackageId', 'marketConfigV2Id', 'kioskRegistryId',
    'soulTransferPolicyId', 'kioskPackageId'] as const) id(value[field], field)
}
function listingScope(value: AnimacraftV8SoulListingScope) {
  target(value.target)
  for (const field of ['soulStateId', 'provenanceBindingId', 'currentKioskId',
    'currentKioskCapOnChainId'] as const) id(value[field], field)
}
function cancelScope(value: AnimacraftV8SoulCancelScope) {
  for (const field of ['soulidityCallablePackageId', 'soulStateId', 'listingId',
    'currentKioskId', 'currentKioskCapOnChainId'] as const) id(value[field], field)
}
function call(packageId: string, name: string): `${string}::${string}::${string}` {
  return `${packageId}::market::${name}`
}

/** Caller may append explicit equipment removal/close before this operation.
 * It never sells wallet components implicitly or bypasses the on-chain DF10 guard. */
export function appendListAnimacraftV8Soul(tx: Transaction, input: AnimacraftV8SoulListingScope & { priceAtomic: bigint }) {
  const params = structuredClone(input)
  listingScope(params); price(params.priceAtomic)
  const runtime = params.target
  tx.moveCall({ target: call(runtime.soulidityCallablePackageId, 'ensure_personal_kiosk_registered_v2'), arguments: [
    tx.object(runtime.marketConfigV2Id), tx.object(runtime.kioskRegistryId), tx.object(params.currentKioskCapOnChainId),
  ] })
  const listing = tx.moveCall({ target: call(runtime.soulidityCallablePackageId, 'list_animacraft_v8_soul_fixed_price'), arguments: [
    tx.object(runtime.marketConfigV2Id), tx.object(runtime.kioskRegistryId), tx.object(params.provenanceBindingId),
    tx.object(params.currentKioskId), tx.object(params.currentKioskCapOnChainId), tx.object(params.soulStateId),
    tx.pure.u64(params.priceAtomic),
  ] })
  tx.moveCall({ target: call(runtime.soulidityCallablePackageId, 'finalize_soul_listing'), arguments: [listing] })
}

export function buildListAnimacraftV8SoulTx(params: AnimacraftV8SoulListingScope & { priceAtomic: bigint }): Transaction {
  const tx = new Transaction()
  appendListAnimacraftV8Soul(tx, params)
  return tx
}

/** Cancellation has no enabled/current-config dependency, quote or payment. */
export function appendCancelAnimacraftV8SoulListing(tx: Transaction, input: AnimacraftV8SoulCancelScope) {
  const params = structuredClone(input)
  cancelScope(params)
  tx.moveCall({ target: call(params.soulidityCallablePackageId, 'cancel_animacraft_v8_soul_listing'), arguments: [
    tx.object(params.currentKioskId), tx.object(params.currentKioskCapOnChainId),
    tx.object(params.soulStateId), tx.object(params.listingId),
  ] })
}

export function buildCancelAnimacraftV8SoulListingTx(params: AnimacraftV8SoulCancelScope): Transaction {
  const tx = new Transaction()
  appendCancelAnimacraftV8SoulListing(tx, params)
  return tx
}

/** Atomic cancel → relist → share. A failed relist cannot leave a delisted Soul. */
export function buildRepriceAnimacraftV8SoulTx(input: AnimacraftV8SoulListingScope & {
  listingId: string; priceAtomic: bigint
}): Transaction {
  const params = structuredClone(input)
  listingScope(params); id(params.listingId, 'listingId'); price(params.priceAtomic)
  const tx = new Transaction()
  appendCancelAnimacraftV8SoulListing(tx, { ...params, soulidityCallablePackageId: params.target.soulidityCallablePackageId })
  appendListAnimacraftV8Soul(tx, params)
  return tx
}

export function buildBuyAnimacraftV8SoulTx(input: {
  target: AnimacraftV8MarketTarget
  soulStateId: string; provenanceBindingId: string; listingId: string; sellerKioskId: string
  priceAtomic: bigint; paymentCoinObjectIds: string[]
  buyerKioskId?: string | null; buyerKioskCapOnChainId?: string | null
}): Transaction {
  const params = structuredClone(input)
  target(params.target); price(params.priceAtomic)
  for (const field of ['soulStateId', 'provenanceBindingId', 'listingId', 'sellerKioskId'] as const) id(params[field], field)
  const { buyerKioskId, buyerKioskCapOnChainId } = params
  if ((buyerKioskId == null) !== (buyerKioskCapOnChainId == null)) throw new Error('Buyer kiosk and capability must be provided together')
  if (buyerKioskId != null) {
    id(buyerKioskId, 'buyerKioskId'); id(buyerKioskCapOnChainId, 'buyerKioskCapOnChainId')
    if (buyerKioskId === params.sellerKioskId) throw new Error('Buyer and seller kiosks must differ')
  }
  if (!Array.isArray(params.paymentCoinObjectIds) || params.paymentCoinObjectIds.length === 0
    || new Set(params.paymentCoinObjectIds).size !== params.paymentCoinObjectIds.length) {
    throw new Error('Payment requires distinct coin object IDs')
  }
  params.paymentCoinObjectIds.forEach(value => id(value, 'payment coin'))
  const runtime = params.target
  const tx = new Transaction()
  // The fresh target uses the same exact MarketConfigV2 as native mint. No
  // ambient V6 configuration or legacy provenance is selected by this builder.
  const buyer = buildBuyerKioskArgs(tx, { buyerKioskId, buyerKioskCapOnChainId,
    runtime: {
      packageId: runtime.soulidityCallablePackageId, marketConfigId: runtime.marketConfigV2Id,
      kioskRegistryId: runtime.kioskRegistryId, kioskPackageId: runtime.kioskPackageId,
    } })
  const payment = buildExactPaymentCoin(tx, params.paymentCoinObjectIds, params.priceAtomic)
  tx.moveCall({ target: call(runtime.soulidityCallablePackageId, 'buy_animacraft_v8_soul_fixed_price'), arguments: [
    tx.object(runtime.marketConfigV2Id), tx.object(runtime.kioskRegistryId), tx.object(runtime.soulTransferPolicyId),
    tx.object(params.provenanceBindingId), tx.object(params.sellerKioskId), buyer.buyerKiosk, buyer.buyerKioskCap,
    tx.object(params.soulStateId), tx.object(params.listingId), payment,
  ] })
  finishBuyerKioskArgs(tx, buyer)
  return tx
}
