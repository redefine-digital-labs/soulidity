import { Transaction } from '@mysten/sui/transactions'
import { fromBase58, toBase58, normalizeStructTag } from '@mysten/sui/utils'
import { commerceCheck, commerceId } from './economics-read'

type SharedRef = { objectId: string; initialSharedVersion: string }
export interface NativePaidContentPurchase {
  buyer: string; nativeCallablePackageId: string; coinType: string;
  registry: SharedRef; config: SharedRef; service: SharedRef; kiosk: SharedRef;
  kind: number; quote: { hash: Uint8Array; total: string }; entryHash: Uint8Array | null;
  feeRevision: string; quoteExpiryMs: string; attempt: Uint8Array; rootRevision: string;
  paymentCoin: { objectId: string; version: string; digest: string; balance: string }
}
const clockId = `0x${'6'.padStart(64, '0')}`, MAX = (1n << 64n) - 1n
function uint(value: string, positive = false) {
  commerceCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= MAX && (!positive || BigInt(value) > 0n), 'PAID_TX_U64')
  return BigInt(value)
}
/** New-intent unsigned composition of the current public Native ABI only.
 * Input is not an authorization token. Caller must prove current entitlement,
 * service/source/scope/quote/funding and gas, exact full packet simulation,
 * durable operation ownership and final business effects before success.
 * Never use this builder to replace a saved signed/paid/unknown packet.
 */
export function buildNativePaidContentPurchase(input: NativePaidContentPurchase) {
  const p = structuredClone(input), shared = [p.registry, p.config, p.service, p.kiosk]
  commerceCheck([p.buyer, p.nativeCallablePackageId, p.paymentCoin.objectId, ...shared.map(r => r.objectId)].every(commerceId), 'PAID_TX_ID')
  commerceCheck(new Set([p.nativeCallablePackageId, p.paymentCoin.objectId, clockId, ...shared.map(r => r.objectId)]).size === 7, 'PAID_TX_ROLE_ALIAS')
  for (const ref of shared) uint(ref.initialSharedVersion, true)
  uint(p.paymentCoin.version, true); uint(p.feeRevision); uint(p.quoteExpiryMs, true); uint(p.rootRevision, true)
  const total = uint(p.quote.total, true), balance = uint(p.paymentCoin.balance)
  commerceCheck(balance >= total, 'PAID_TX_FUNDING')
  commerceCheck(Number.isSafeInteger(p.kind) && p.kind >= 0 && p.kind <= 0xffffffff, 'PAID_TX_KIND')
  commerceCheck(p.quote.hash instanceof Uint8Array && p.quote.hash.length === 32
    && (p.entryHash === null || p.entryHash instanceof Uint8Array && p.entryHash.length === 32)
    && p.attempt instanceof Uint8Array && p.attempt.length === 32 && p.attempt.some(b => b !== 0), 'PAID_TX_HASH_OR_ATTEMPT')
  const digest = fromBase58(p.paymentCoin.digest)
  commerceCheck(digest.length === 32 && toBase58(digest) === p.paymentCoin.digest, 'PAID_TX_COIN_DIGEST')
  const tx = new Transaction(); tx.setSender(p.buyer)
  const registry = tx.sharedObjectRef({ ...p.registry, mutable: false }), config = tx.sharedObjectRef({ ...p.config, mutable: true })
  const service = tx.sharedObjectRef({ ...p.service, mutable: true }), kiosk = tx.sharedObjectRef({ ...p.kiosk, mutable: true })
  const coin = tx.objectRef({ objectId: p.paymentCoin.objectId, version: p.paymentCoin.version, digest: p.paymentCoin.digest })
  const [payment] = tx.splitCoins(coin, [tx.pure.u64(total)])
  tx.moveCall({ target: `${p.nativeCallablePackageId}::birth::buy_paid_service`, typeArguments: [normalizeStructTag(p.coinType)], arguments: [
    registry, config, service, kiosk, tx.pure.u32(p.kind), tx.pure.vector('u8', p.quote.hash),
    tx.pure.option('vector<u8>', p.entryHash === null ? null : Array.from(p.entryHash)), tx.pure.u64(p.feeRevision), tx.pure.u64(p.quoteExpiryMs),
    tx.pure.vector('u8', p.attempt), payment, tx.pure.u64(p.rootRevision), tx.sharedObjectRef({ objectId: clockId, initialSharedVersion: '1', mutable: false }),
  ] })
  return tx
}
