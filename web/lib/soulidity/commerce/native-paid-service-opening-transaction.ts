import { Transaction } from '@mysten/sui/transactions'
import { fromBase58, toBase58, normalizeStructTag } from '@mysten/sui/utils'
import { commerceCheck, commerceId } from './economics-read'

export interface NativePaidServiceOpening {
  owner: string; nativeCallablePackageId: string; coinType: string; soulId: string;
  registry: { objectId: string; initialSharedVersion: string };
  config: { objectId: string; initialSharedVersion: string };
  kiosk: { objectId: string; initialSharedVersion: string };
  account: { objectId: string; version: string; digest: string };
  rootRevision: string; expiresMs: string;
}
const clockId = `0x${'6'.padStart(64, '0')}`
function positive(value: string) {
  commerceCheck(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= (1n << 64n) - 1n, 'PAID_OPEN_TX_U64')
}
/** Unsigned current-ABI opening kind. New intents require fresh custody/source,
 * Clock, interface, gas and simulation qualification. Historical use may only
 * compare an independently expected kind with immutable original bytes; never
 * replace a saved signed/unknown operation or reinterpret an unknown old ABI.
 */
export function buildNativePaidServiceOpening(input: NativePaidServiceOpening) {
  const p = structuredClone(input), shared = [p.registry, p.config, p.kiosk]
  commerceCheck([p.owner, p.nativeCallablePackageId, p.soulId, p.account.objectId, ...shared.map(r => r.objectId)].every(commerceId), 'PAID_OPEN_TX_ID')
  commerceCheck(new Set([p.nativeCallablePackageId, p.soulId, p.account.objectId, clockId, ...shared.map(r => r.objectId)]).size === 7, 'PAID_OPEN_TX_ROLE_ALIAS')
  for (const ref of shared) positive(ref.initialSharedVersion)
  for (const value of [p.account.version, p.rootRevision, p.expiresMs]) positive(value)
  const digest = fromBase58(p.account.digest)
  commerceCheck(digest.length === 32 && toBase58(digest) === p.account.digest, 'PAID_OPEN_TX_ACCOUNT_DIGEST')
  const tx = new Transaction(); tx.setSender(p.owner)
  tx.moveCall({ target: `${p.nativeCallablePackageId}::birth::open_paid_service`, typeArguments: [normalizeStructTag(p.coinType)], arguments: [
    tx.sharedObjectRef({ ...p.registry, mutable: false }), tx.sharedObjectRef({ ...p.config, mutable: false }),
    tx.sharedObjectRef({ ...p.kiosk, mutable: true }), tx.objectRef(p.account), tx.pure.id(p.soulId),
    tx.pure.u64(p.rootRevision), tx.pure.u64(p.expiresMs), tx.sharedObjectRef({ objectId: clockId, initialSharedVersion: '1', mutable: false }),
  ] })
  return tx
}
