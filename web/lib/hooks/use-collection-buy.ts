'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { getKioskPackageAddress, getRequiredSoulidityEnv, readCollectionPublicRoot } from '@soulidity/sdk'
import { getCollectionCommandTarget, type CollectionCommandSubject } from './use-collection-commands'
import { same } from '../collections/collection-command-plan'
import { publicMutationCanonical } from '../sui/public-mutation-journal'
import type { CollectionBuyRecord, CollectionBuyQuery } from '../collections/collection-buy-plan'
import { prepareCollectionBuyPlan } from '../collections/collection-buy-state'
import { createCollectionBuyAdapter, parseCollectionBuyRecord } from '../collections/collection-buy-operation'
import { COLLECTION_BUY_CHANGED, browserCollectionBuyStore, collectionBuyKey, prepareCollectionBuy,
  runCollectionBuy, importCollectionBuy } from '../collections/collection-buy-journal'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COLLECTION_BUY_${code}`) }
export function getCollectionBuyTarget() {
  return { ...getCollectionCommandTarget(), kioskPackageId: getKioskPackageAddress(),
    collectionTransferPolicyId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID') }
}
function targetIdentity() { try { return publicMutationCanonical(getCollectionBuyTarget()) } catch { return 'unavailable' } }
const noop = () => {}
const empty = { records: [] as CollectionBuyRecord[], history: [] as CollectionBuyRecord[], pending: false,
  error: null as string | null, status: null as string | null, currentObservation: null as string | null }

/** Buying is wallet-only; all quotes, custody and recovery use chain IDs. A
 * changed Listing or deployment never opens another payment while an earlier
 * packet for this buyer/Collection has an unresolved result. */
export function useCollectionBuy(subject: CollectionCommandSubject, onSuccess: () => void = noop) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc, { mutateAsync: sign } = useSignTransaction()
  const targetKey = targetIdentity(), scope = JSON.stringify([subject.onChainId, subject.listingObjectOnChainId, targetKey])
  const session = useCommittedSession(scope, account, client, wallet)
  const generation = session.generation, active = useRef<AbortController | null>(null)
  const [state, setState] = useSessionState(session, { ...empty, generation, pending: Boolean(grpc) })
  const matches = () => session.matches() && targetIdentity() === targetKey
  const publish = (patch: Partial<typeof empty>) => { if (matches()) setState(old => ({ ...(old.generation === generation ? old : empty), generation, ...patch })) }
  const refresh = useCallback(() => {
    if (!matches()) return
    const store = browserCollectionBuyStore(), records = store.discover(subject.onChainId)
    const history = records.flatMap(record => store.history(collectionBuyKey(record.plan)))
    publish({ records, history })
  }, [scope, generation])
  function adapter(guard: () => void) {
    check(grpc, 'CHAIN_READER_UNAVAILABLE')
    return createCollectionBuyAdapter({ client: grpc,
      getAddress: () => { try { guard(); return account?.address ?? null } catch { return null } },
      sign: async transaction => { guard(); return sign({ transaction, account: account! }) },
      preflight: async plan => { guard(); check(same(plan.target, getCollectionBuyTarget()), 'RELEASE_CHANGED_QUERY_ONLY') } })
  }
  function report(record: CollectionBuyRecord, result: CollectionBuyQuery) {
    publish({ status: result.status === 'SUCCEEDED' ? `Original purchase confirmed at checkpoint ${result.checkpoint}. Receipt retained.`
      : result.status === 'FAILED' ? 'The original transaction failed on chain. Receipt retained.'
        : result.status === 'PENDING' ? 'Final checkpoint pending. Query this same purchase.'
          : record.packet.phase === 'CANCELLED' ? 'Cancelled before this journal requested a signature. Bytes retained.'
            : 'No finalized result found. This does not prove failure; recover this same purchase.' })
  }
  async function observeCurrent(record: CollectionBuyRecord, result: CollectionBuyQuery, signal: AbortSignal, guard: () => void) {
    if (result.status !== 'SUCCEEDED') return
    const p = record.plan
    try {
      const d = p.target
      const c = await readCollectionPublicRoot({ client: grpc!, deployment: { originalPackageId: d.originalPackageId,
        chainIdentifier: d.chainIdentifier, marketConfigId: d.marketConfigId, paymentCoinType: d.paymentCoinType,
        kioskRegistryId: d.kioskRegistryId, personalKioskTypePackageId: d.personalKioskTypePackageId }, collectionId: p.request.collectionId, signal })
      guard(); publish({ currentObservation: c.collection.current_holder === p.author
        ? 'Current Collection holder is the purchasing wallet.' : 'Current custody has changed since the confirmed purchase.' })
    } catch { if (matches() && !signal.aborted) publish({ currentObservation: 'Current custody could not be refreshed. Historical purchase confirmation is unchanged.' }) }
  }
  async function exclusive<T>(work: (signal: AbortSignal, guard: () => void) => Promise<T>, requiresWallet = true, announce = true) {
    const lease = session.capture()
    const matches = () => lease?.matches() === true && targetIdentity() === targetKey
    check(grpc && matches() && (!requiresWallet || account && wallet), 'CONNECT_PURCHASING_WALLET')
    check(!active.current, 'LOCAL_OPERATION_BUSY')
    const controller = new AbortController(); active.current = controller; lease!.requests.add(controller)
    const guard = () => { controller.signal.throwIfAborted(); check(matches(), 'WALLET_CLIENT_RELEASE_CHANGED') }
    if (announce) publish({ pending: true, error: null, status: null, currentObservation: null })
    try { const result = await work(controller.signal, guard); guard(); return result }
    catch (cause) { if (matches()) publish({ error: cause instanceof Error ? cause.message : 'Collection purchase failed' }); throw cause }
    finally { lease!.requests.delete(controller); if (active.current === controller) active.current = null
      if (matches()) { publish({ pending: false }); try { refresh() } catch (cause) { publish({ error: cause instanceof Error ? cause.message : 'Recovery storage unavailable' }) } } }
  }
  useEffect(() => {
    const changed = () => { try { refresh() } catch (cause) { publish({ error: cause instanceof Error ? cause.message : 'Recovery storage unavailable' }) } }
    changed()
    if (grpc) void exclusive(async (signal, guard) => {
      const store = browserCollectionBuyStore(); let newlyConfirmed = false
      for (const record of store.discover(subject.onChainId)) {
        guard(); const result = await runCollectionBuy({ record, store, adapter: adapter(guard), mode: 'query' })
        guard(); report(result.record, result)
        if (result.status === 'SUCCEEDED') {
          await observeCurrent(result.record, result, signal, guard)
          newlyConfirmed ||= record.packet.phase !== 'SUCCEEDED'
        }
      }
      // Already-confirmed cold receipts do not invalidate and remount forever.
      guard(); if (newlyConfirmed) onSuccess()
    }, false, false).catch(() => {})
    window.addEventListener(COLLECTION_BUY_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { active.current?.abort(); active.current = null
      window.removeEventListener(COLLECTION_BUY_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [refresh])
  const prepare = () => exclusive(async (signal, guard) => {
    check(subject.listingObjectOnChainId, 'NO_VERIFIED_LISTING')
    const plan = await prepareCollectionBuyPlan({ client: grpc!, target: getCollectionBuyTarget(), author: account!.address,
      request: { collectionId: subject.onChainId, listingId: subject.listingObjectOnChainId }, signal })
    guard(); const record = await prepareCollectionBuy({ plan, store: browserCollectionBuyStore(), adapter: adapter(guard) })
    guard(); publish({ status: 'Exact purchase saved. Review the full USDC quote and SUI gas budget before signing.' }); return record
  })
  const run = (record: CollectionBuyRecord, mode: 'query' | 'resume' | 'cancel-unsigned') => exclusive(async (signal, guard) => {
    check(record.plan.request.collectionId === subject.onChainId, 'SELECTED_COLLECTION_CHANGED')
    const result = await runCollectionBuy({ record, store: browserCollectionBuyStore(), adapter: adapter(guard), mode })
    guard(); report(result.record, result); await observeCurrent(result.record, result, signal, guard)
    guard(); if (result.status === 'SUCCEEDED' && (record.packet.phase !== 'SUCCEEDED' || mode === 'resume')) onSuccess()
    return result
  }, mode === 'resume')
  const importRecord = (encoded: string) => exclusive(async (_signal, guard) => {
    check(encoded.length > 0 && encoded.length <= 3 * 1024 * 1024, 'IMPORT_BUDGET')
    const record = await importCollectionBuy({ input: JSON.parse(encoded), collectionId: subject.onChainId,
      store: browserCollectionBuyStore(), adapter: adapter(guard) })
    guard(); publish({ status: 'Public purchase recovery imported. Query it before explicitly resuming.' }); return record
  }, false)
  const exportRecord = (record: CollectionBuyRecord) => JSON.stringify(parseCollectionBuyRecord(record), null, 2)
  return { ...(state.generation === generation ? state : empty), prepare, run, importRecord, exportRecord,
    currentAddress: account?.address ?? null, targetKey, identityKey: `${scope}:${generation}` }
}
