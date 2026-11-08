import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'

export const PaidContentOfferBcs = bcs.struct('Offer', { issuer: bcs.Address, generation: bcs.u64(), price: bcs.u64(),
  scope: bcs.u64(), duration: bcs.option(bcs.u64()), revision: bcs.u64() })
export const PaidContentEntryBcs = bcs.struct('Entry', { issuer: bcs.Address, generation: bcs.u64(), scope: bcs.u64(),
  expiry: bcs.option(bcs.u64()), revision: bcs.u64() })
export const PaidContentBuyerKeyBcs = bcs.struct('BuyerKey', { kind: bcs.u32(), buyer: bcs.Address })
const NativeQuote = bcs.struct('NativeQuote', { domain: bcs.byteVector(), root: bcs.Address, protocol: bcs.Address, kind: bcs.u32(),
  offer: PaidContentOfferBcs, fee_revision: bcs.u64(), platform_recipient: bcs.Address, total: bcs.u64(), platform_fee: bcs.u64() })
type Offer = ReturnType<typeof PaidContentOfferBcs.parse>
type Entry = ReturnType<typeof PaidContentEntryBcs.parse>
const MAX = (1n << 64n) - 1n

/** This is a per-kind, owner-revocable content subscription on one existing
 * Soul. It is neither an Animacraft Pack nor an equipable asset/license.
 * Valid entries remain reusable even after their sale offer is removed.
 * Source custody/generation and ledger evidence must be authenticated by caller.
 */
export function paidContentScopeCovers(scope: bigint, required: bigint) {
  return required > 0n && (scope & required) === required
}

export function paidContentDecision(input: { buyer: string; owner: string; generation: bigint; scope: bigint; nowMs: bigint;
  entry: Entry | null; offer: Offer | null }) {
  if (input.scope <= 0n || input.scope > MAX || input.nowMs < 0n || input.nowMs > MAX
    || input.generation < 0n || input.generation > MAX) throw Error('Invalid paid content scope/time/generation')
  if (input.buyer === input.owner) return { action: 'REUSE_OWNER' as const }
  const e = input.entry, same = e !== null && e.issuer === input.owner && BigInt(e.generation) === input.generation
  if (same && (e.expiry === null || BigInt(e.expiry) > input.nowMs) && paidContentScopeCovers(BigInt(e.scope), input.scope)) {
    return { action: 'REUSE_ENTRY' as const }
  }
  if (same && e.expiry === null) return { action: 'BLOCKED' as const, reason: 'PERMANENT_ENTRY_SCOPE_MISMATCH' }
  const o = input.offer
  if (!o) return { action: 'BLOCKED' as const, reason: 'NO_SALE_OFFER' }
  if (o.issuer !== input.owner || BigInt(o.generation) !== input.generation) return { action: 'BLOCKED' as const, reason: 'STALE_OFFER' }
  if (!paidContentScopeCovers(BigInt(o.scope), input.scope)) return { action: 'BLOCKED' as const, reason: 'OFFER_SCOPE_MISMATCH' }
  if (BigInt(o.price) <= 0n || (o.duration !== null && BigInt(o.duration) <= 0n)) throw Error('Invalid paid content offer')
  const base = same && e.expiry !== null && BigInt(e.expiry) > input.nowMs ? BigInt(e.expiry) : input.nowMs
  const expiry = o.duration === null ? null : base + BigInt(o.duration)
  if (expiry !== null && expiry > MAX) return { action: 'BLOCKED' as const, reason: 'EXPIRY_OVERFLOW' }
  return { action: 'PURCHASE_REQUIRED' as const, previewExpiryMs: expiry === null ? null : String(expiry) }
}

/** Mirrors paid_access::native_quote, including Native additive per-item CEIL.
 * Snapshot bytes are part of quote identity; no Maker gross/FLOOR reuse.
 */
export function quoteNativePaidContent(input: { root: string; protocol: string; kind: number; offer: Offer;
  feeRevision: string; primaryBps: number; platformRecipient: string }) {
  const ask = BigInt(input.offer.price), bps = input.primaryBps
  if (ask <= 0n || ask > MAX || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw Error('Invalid paid content price/rate')
  const fee = (ask * BigInt(bps) + 9999n) / 10000n, total = ask + fee
  if (total > MAX) throw Error('Paid content total overflow')
  const hash = sha256(NativeQuote.serialize({ domain: new TextEncoder().encode('soulidity-native-paid-kind-v1'),
    root: input.root, protocol: input.protocol, kind: input.kind, offer: input.offer, fee_revision: input.feeRevision,
    platform_recipient: input.platformRecipient, total, platform_fee: fee }).toBytes())
  return { ask: String(ask), platformFee: String(fee), total: String(total), hash }
}
