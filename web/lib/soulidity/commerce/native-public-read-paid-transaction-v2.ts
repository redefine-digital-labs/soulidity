import { Transaction } from '@mysten/sui/transactions'
import { fromBase58, fromHex, toBase58, normalizeStructTag } from '@mysten/sui/utils'
import { commerceCheck, commerceId } from './economics-read'

type SharedRef = { objectId: string; initialSharedVersion: string }
export interface NativePublicReadPaidQuoteV2 {
  format: 'native-public-read-v2'; nativeCallablePackageId: string; coinType: string;
  config: SharedRef; host: SharedRef; kind: number;
}
export interface NativePublicReadPaidPurchaseV2 extends NativePublicReadPaidQuoteV2 {
  buyer: string; registry: SharedRef; kiosk: SharedRef;
  quote: { hash: Uint8Array; total: string }; entryHash: Uint8Array | null;
  feeRevision: string; quoteExpiryMs: string; attempt: Uint8Array;
  // Absent only in original historical two-command purchases.
  recordGuard?: { index: number; namespace: string };
  paymentCoin: { objectId: string; version: string; digest: string; balance: string };
}
const clockId = `0x${'6'.padStart(64, '0')}`
function uint(value: string, positive = false) {
  commerceCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= (1n << 64n) - 1n
    && (!positive || BigInt(value) > 0n), 'PUBLIC_PAID_V2_U64')
  return BigInt(value)
}
function quoteInput(input: NativePublicReadPaidQuoteV2) {
  const p = structuredClone(input)
  commerceCheck(p.format === 'native-public-read-v2' && !('service' in p) && !('rootRevision' in p) && !('account' in p), 'PUBLIC_PAID_V2_FORMAT')
  commerceCheck([p.nativeCallablePackageId, p.config.objectId, p.host.objectId].every(commerceId)
    && new Set([p.nativeCallablePackageId, p.config.objectId, p.host.objectId, clockId]).size === 4, 'PUBLIC_PAID_V2_ROLES')
  uint(p.config.initialSharedVersion, true); uint(p.host.initialSharedVersion, true)
  commerceCheck(Number.isSafeInteger(p.kind) && p.kind >= 0 && p.kind <= 0xffffffff, 'PUBLIC_PAID_V2_KIND')
  return p
}
/** Isolated HostV2 prototype ABI only. This unsigned quote query cannot validate
 * a release, current entitlement or delivery. Never a v1 State fallback. */
export function buildNativePublicReadPaidQuoteV2(input: NativePublicReadPaidQuoteV2) {
  const p = quoteInput(input), tx = new Transaction()
  tx.moveCall({ target: `${p.nativeCallablePackageId}::birth::quote_public_read_paid_v2`, typeArguments: [normalizeStructTag(p.coinType)], arguments: [
    tx.sharedObjectRef({ ...p.config, mutable: false }), tx.sharedObjectRef({ ...p.host, mutable: false }), tx.pure.u32(p.kind),
  ] })
  return tx
}
/** Isolated HostV2 prototype ABI. Host and Config mutate; Kiosk/Registry/Clock
 * are readonly. State is EMBEDDED in Host, never a v1 ObjectOwned input. No
 * SourceService, Account or rootRevision. Caller owes adopted qualified source,
 * exact live Host/Record/Entry/owner/generation/scope/fees, funding, full packet,
 * simulation, durable execution and real protected delivery. No gas/sign/store.
 * Never rebuild/relabel saved v1 or unknown operations through this adapter.
 */
export function buildNativePublicReadPaidPurchaseV2(input: NativePublicReadPaidPurchaseV2) {
  const p = structuredClone(input); quoteInput(p)
  commerceCheck([p.buyer, p.registry.objectId, p.kiosk.objectId, p.paymentCoin.objectId].every(commerceId)
    && new Set([p.nativeCallablePackageId, p.config.objectId, p.host.objectId, p.registry.objectId, p.kiosk.objectId, p.paymentCoin.objectId, clockId]).size === 7, 'PUBLIC_PAID_V2_PURCHASE_ROLES')
  uint(p.registry.initialSharedVersion, true); uint(p.kiosk.initialSharedVersion, true); uint(p.paymentCoin.version, true)
  uint(p.feeRevision); uint(p.quoteExpiryMs, true)
  const total = uint(p.quote.total, true)
  commerceCheck(uint(p.paymentCoin.balance) >= total, 'PUBLIC_PAID_V2_FUNDING')
  commerceCheck(p.quote.hash instanceof Uint8Array && p.quote.hash.length === 32 && (p.entryHash === null || p.entryHash instanceof Uint8Array && p.entryHash.length === 32)
    && p.attempt instanceof Uint8Array && p.attempt.length === 32 && p.attempt.some(b => b !== 0), 'PUBLIC_PAID_V2_HASH')
  const guard = p.recordGuard
  if (Object.hasOwn(p, 'recordGuard')) {
    commerceCheck(guard && Object.keys(guard).sort().join() === 'index,namespace'
      && Number.isSafeInteger(guard.index) && guard.index >= 0 && guard.index < 4096
      && typeof guard.namespace === 'string' && /^(?:[0-9a-f]{2}){1,256}$/.test(guard.namespace), 'PUBLIC_PAID_V2_RECORD_GUARD')
  }
  const digest = fromBase58(p.paymentCoin.digest)
  commerceCheck(digest.length === 32 && toBase58(digest) === p.paymentCoin.digest, 'PUBLIC_PAID_V2_COIN_DIGEST')
  const tx = new Transaction(); tx.setSender(p.buyer)
  const registry = tx.sharedObjectRef({ ...p.registry, mutable: false }), config = tx.sharedObjectRef({ ...p.config, mutable: true })
  const kiosk = tx.sharedObjectRef({ ...p.kiosk, mutable: false }), host = tx.sharedObjectRef({ ...p.host, mutable: true })
  const coin = tx.objectRef({ objectId: p.paymentCoin.objectId, version: p.paymentCoin.version, digest: p.paymentCoin.digest })
  const [payment] = tx.splitCoins(coin, [tx.pure.u64(total)])
  const args = [
    registry, config, kiosk, host, tx.pure.u32(p.kind), tx.pure.vector('u8', p.quote.hash),
    tx.pure.option('vector<u8>', p.entryHash === null ? null : Array.from(p.entryHash)), tx.pure.u64(p.feeRevision), tx.pure.u64(p.quoteExpiryMs),
    tx.pure.vector('u8', p.attempt), payment,
  ]
  const clock = tx.sharedObjectRef({ objectId: clockId, initialSharedVersion: '1', mutable: false })
  tx.moveCall({ target: `${p.nativeCallablePackageId}::birth::buy_public_read_paid_v2`, typeArguments: [normalizeStructTag(p.coinType)], arguments: [...args, clock] })
  // A failure here aborts the purchase, payout and Entry written earlier in
  // the same transaction. The read policy checks the selected record itself.
  if (guard) tx.moveCall({ target: `${p.nativeCallablePackageId}::birth::seal_approve_content_paid_v2`, arguments: [
    tx.pure.vector('u8', fromHex(guard.namespace)), kiosk, host, tx.pure.u64(guard.index), clock,
  ] })
  return tx
}
