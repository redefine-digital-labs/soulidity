import type { SameSoulMutationHeadPort } from './same-soul-mutation-heads'
import { withSoulAccessAssetLock, soulAccessAssetKey, type SoulAccessAssetScope } from './soul-access-asset-lock'

export interface SameSoulMutationLockPort {
  /** Must serialize this exact asset key across all participating domains. */
  exclusive<T>(scope: Readonly<SoulAccessAssetScope>, work: () => Promise<T>): Promise<T>
}
declare const sameSoulLease: unique symbol
export interface SameSoulMutationLease { readonly [sameSoulLease]: true }
export interface SameSoulMutationCoordination { lease?: SameSoulMutationLease; lockPort?: SameSoulMutationLockPort; headPort?: SameSoulMutationHeadPort }
const leases = new WeakMap<object, { key: string; active: boolean; closing: boolean; pending: Promise<void> | null }>()

export function sameSoulMutationScope(input: SoulAccessAssetScope): Readonly<SoulAccessAssetScope> {
  const scope = { chainIdentifier: input.chainIdentifier, soulId: input.soulId, author: input.author }
  // The established storage/lock token is short mainnet ID. The independent
  // ledger readers still require the full genesis digest before any operation.
  if (scope.chainIdentifier !== '35834a8a' || ![scope.soulId, scope.author].every(v => /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n))
    throw Error('SAME_SOUL_MUTATION_SCOPE')
  return Object.freeze(scope)
}

/** Shared outer exclusion, not source/permission qualification. A lease is
 * usable only during this callback and only for the exact same asset scope.
 * It permits the confirmed-failure bridge to reuse its held asset lock while
 * the original journal retains authority over nested domain writes.
 * Server/third-party consumers may supply an explicit cross-domain lock port;
 * there is no unprotected non-browser fallback.
 */
export function withSameSoulMutation<T>(input: {
  scope: SoulAccessAssetScope; signal: AbortSignal; coordination?: SameSoulMutationCoordination
}, work: (lease: SameSoulMutationLease) => Promise<T>): Promise<T> {
  const scope = sameSoulMutationScope(input.scope), key = soulAccessAssetKey(scope), signal = input.signal
  const supplied = input.coordination?.lease, port = input.coordination?.lockPort
  const exclusive = port?.exclusive.bind(port)
  signal.throwIfAborted()
  if (supplied) {
    const entry = leases.get(supplied)
    if (!entry?.active || entry.closing || entry.key !== key || port) throw Error('SAME_SOUL_MUTATION_LEASE')
    if (entry.pending) throw Error('SAME_SOUL_MUTATION_LEASE_BUSY')
    const result = Promise.resolve().then(() => { signal.throwIfAborted(); return work(supplied) })
    const settled = result.then(() => {}, () => {}).finally(() => { if (entry.pending === settled) entry.pending = null })
    entry.pending = settled
    return result
  }
  const run = async () => {
    signal.throwIfAborted()
    const lease = Object.freeze({}) as SameSoulMutationLease, entry = { key, active: true, closing: false, pending: null as Promise<void> | null }
    leases.set(lease, entry)
    try { return await work(lease) } finally {
      // A faulty caller cannot release the actual lock while a borrowed child
      // still has a journal/ACK in flight, even if it forgot to await that child.
      entry.closing = true
      if (entry.pending) await entry.pending
      entry.active = false
    }
  }
  return exclusive ? exclusive(scope, run) : withSoulAccessAssetLock(scope, run)
}

/** Batches acquire exact asset keys in stable order before wallet/domain locks. */
export function withSameSoulMutations<T>(input: { scopes: readonly SoulAccessAssetScope[]; signal: AbortSignal }, work: () => Promise<T>): Promise<T> {
  const scopes = input.scopes.map(sameSoulMutationScope).sort((a, b) => soulAccessAssetKey(a).localeCompare(soulAccessAssetKey(b))), signal = input.signal
  if (!scopes.length || scopes.length > 64 || new Set(scopes.map(soulAccessAssetKey)).size !== scopes.length) throw Error('SAME_SOUL_MUTATION_BATCH_SCOPE')
  const run = (index: number): Promise<T> => index === scopes.length ? work() : withSameSoulMutation({ scope: scopes[index], signal }, () => run(index + 1))
  return run(0)
}
