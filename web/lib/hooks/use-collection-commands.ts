'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toHex } from '@mysten/sui/utils'
import { getPersonalKioskCapTypePackageAddress, getRequiredSoulidityEnv, readCollectionPublicRoot,
  readCollectionListingCandidate } from '@soulidity/sdk'
import { getBrowserNativeReceiveTarget } from '@/lib/animacraft/browser-native-config'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { check, same, parseCollectionCommandTarget, type CollectionCommandRecord, type CollectionCommandQuery,
  type CollectionCommandRequest, type CollectionCommandPlan } from '@/lib/collections/collection-command-plan'
import { prepareCollectionCommandPlan } from '@/lib/collections/collection-command-state'
import { createCollectionCommandAdapter, parseCollectionCommandRecord } from '@/lib/collections/collection-command-operation'
import { COLLECTION_COMMAND_CHANGED, browserCollectionCommandStore, collectionCommandKey, prepareCollectionCommand,
  runCollectionCommand, importCollectionCommand } from '@/lib/collections/collection-command-journal'

export interface CollectionCommandSubject {
  onChainId: string; name: string; listedPriceAtomic: string | null; listingObjectOnChainId?: string | null
}
export function getCollectionCommandTarget() {
  const release = getBrowserNativeReceiveTarget()
  return parseCollectionCommandTarget({ chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)),
    originalPackageId: release.soulidityOriginalPackageId, callablePackageId: release.soulidityCallablePackageId,
    callableDigest: release.soulidityCallableDigest, marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
    kioskRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID'),
    personalKioskTypePackageId: getPersonalKioskCapTypePackageAddress(), paymentCoinType: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE') })
}
function targetIdentity() { try { return JSON.stringify(getCollectionCommandTarget()) } catch { return 'unavailable' } }
const noop = () => {}

/** Original collection forms use chain IDs only. Neither Agent authentication
 * nor SQL personal-kiosk/listing mirrors can authorize these commands. */
export function useCollectionCommands(subject: CollectionCommandSubject | null, onSuccess: () => void = noop) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const grpc = (client as unknown as { grpc: SuiGrpcClient }).grpc, { mutateAsync: sign } = useSignTransaction()
  const targetKey = targetIdentity(), scope = JSON.stringify([subject?.onChainId, targetKey])
  const session = useCommittedSession(scope, account, client, wallet)
  const generation = session.generation, active = useRef<AbortController | null>(null)
  const [records, setRecords] = useSessionState<CollectionCommandRecord[]>(session, []), [history, setHistory] = useSessionState<CollectionCommandRecord[]>(session, [])
  const [pending, setPending] = useSessionState(session, false), [error, setError] = useSessionState<string | null>(session, null)
  const [status, setStatus] = useSessionState<string | null>(session, null), [currentObservation, setCurrentObservation] = useSessionState<string | null>(session, null)
  const matches = () => session.matches() && targetIdentity() === targetKey
  const refresh = useCallback(() => {
    if (!subject || !matches()) return
    const store = browserCollectionCommandStore(), found = store.discover(subject.onChainId)
    const archived = found.flatMap(record => store.history(collectionCommandKey(record.plan)))
    if (matches()) { setRecords(found); setHistory(archived) }
  }, [scope, generation])
  function adapter(guard: () => void) {
    return createCollectionCommandAdapter({ client: grpc,
      getAddress: () => { try { guard(); return account?.address ?? null } catch { return null } },
      sign: async transaction => { guard(); return sign({ transaction, account: account! }) },
      preflight: async plan => { guard(); check(same(plan.target, getCollectionCommandTarget()), 'RELEASE_CHANGED_QUERY_ONLY') } })
  }
  const report = (record: CollectionCommandRecord, result: CollectionCommandQuery) => {
    if (!matches()) return
    setStatus(result.status === 'SUCCEEDED' ? `Original ${record.plan.request.action} confirmed at checkpoint ${result.checkpoint}. Receipt retained.`
      : result.status === 'FAILED' ? 'The original transaction failed on chain. Receipt retained.'
        : result.status === 'PENDING' ? 'Final checkpoint pending. Query this same request.'
          : record.packet.phase === 'CANCELLED' ? 'Cancelled before this journal requested a signature. Bytes retained.'
            : 'No finalized result found. This does not prove failure; recover the same request.')
    if (result.status === 'SUCCEEDED') onSuccess()
  }
  async function observeCurrent(record: CollectionCommandRecord, result: CollectionCommandQuery, signal: AbortSignal, guard: () => void) {
    if (result.status !== 'SUCCEEDED') return
    const p = record.plan, { callablePackageId: _callable, callableDigest: _digest, ...deployment } = p.target
    try {
      const root = await readCollectionPublicRoot({ client: grpc, deployment, collectionId: p.request.collectionId, signal })
      guard()
      if (root.collection.current_holder !== p.author) { setCurrentObservation('Current owner has changed since that confirmed command.'); return }
      const listingId = result.receipt?.newListingId ?? p.oldListingId
      if (!listingId) { setCurrentObservation('Current listing state unavailable; the historical receipt remains confirmed.'); return }
      const listing = await readCollectionListingCandidate({ client: grpc, deployment, listingId, signal }); guard()
      setCurrentObservation(listing?.listing.is_active
        ? 'That Listing is currently active.' : 'That Listing is now inactive. A different Listing may exist.')
    } catch { if (matches() && !signal.aborted) setCurrentObservation('Current state could not be refreshed. Historical confirmation is unchanged.') }
  }
  async function exclusive<T>(work: (signal: AbortSignal, guard: () => void) => Promise<T>, requiresWallet = true) {
    const lease = session.capture()
    const matches = () => lease?.matches() === true && targetIdentity() === targetKey
    check(subject && grpc && matches() && (!requiresWallet || account && wallet), 'CONNECT_PREPARING_WALLET')
    check(!active.current, 'LOCAL_OPERATION_BUSY')
    const controller = new AbortController(); active.current = controller; lease!.requests.add(controller)
    const guard = () => { controller.signal.throwIfAborted(); check(matches(), 'WALLET_CLIENT_RELEASE_CHANGED') }
    setPending(true); setError(null); setStatus(null); setCurrentObservation(null)
    try { const result = await work(controller.signal, guard); guard(); return result }
    catch (cause) { if (matches()) setError(cause instanceof Error ? cause.message : 'Collection operation failed'); throw cause }
    finally { lease!.requests.delete(controller); if (active.current === controller) active.current = null
      if (matches()) { setPending(false); try { refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery storage unavailable') } } }
  }
  useEffect(() => {
    const changed = () => { try { refresh() } catch (cause) { if (matches()) setError(cause instanceof Error ? cause.message : 'Recovery storage unavailable') } }
    changed()
    // Mount/reconnect discovery never signs or broadcasts. Unavailable history
    // leaves the unresolved WAL intact and a visible query-only recovery path.
    if (subject && grpc) void exclusive(async (signal, guard) => {
      const store = browserCollectionCommandStore()
      for (const record of store.discover(subject.onChainId)) {
        guard(); const result = await runCollectionCommand({ record, store, adapter: adapter(guard), mode: 'query' })
        guard(); report(result.record, result)
      }
    }, false).catch(() => {})
    window.addEventListener(COLLECTION_COMMAND_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { active.current?.abort(); active.current = null
      window.removeEventListener(COLLECTION_COMMAND_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [refresh])
  const prepare = (request: Omit<CollectionCommandRequest, 'collectionId'>) => exclusive(async (signal, guard) => {
    const plan = await prepareCollectionCommandPlan({ client: grpc, target: getCollectionCommandTarget(), author: account!.address,
      request: { ...request, collectionId: subject!.onChainId }, listingObjectOnChainId: subject!.listingObjectOnChainId, signal })
    guard(); const record = await prepareCollectionCommand({ plan, store: browserCollectionCommandStore(), adapter: adapter(guard) })
    guard(); setStatus('Prepared exact transaction saved. Review price and SUI gas budget before signing.'); return record
  })
  const run = (record: CollectionCommandRecord, mode: 'query' | 'resume' | 'cancel-unsigned') => exclusive(async (signal, guard) => {
    check(record.plan.request.collectionId === subject!.onChainId, 'SELECTED_COLLECTION_CHANGED')
    const result = await runCollectionCommand({ record, store: browserCollectionCommandStore(), adapter: adapter(guard), mode })
    guard(); report(result.record, result); await observeCurrent(result.record, result, signal, guard); return result
  }, mode === 'resume')
  const exportRecord = (record: CollectionCommandRecord) => JSON.stringify(parseCollectionCommandRecord(record), null, 2)
  const importRecord = (encoded: string) => exclusive(async (_signal, guard) => {
    check(encoded.length > 0 && encoded.length <= 3 * 1024 * 1024, 'IMPORT_BUDGET')
    const record = await importCollectionCommand({ input: JSON.parse(encoded), collectionId: subject!.onChainId,
      store: browserCollectionCommandStore(), adapter: adapter(guard) })
    guard(); setStatus('Exact public recovery packet imported. Query it before explicitly resuming.'); return record
  }, false)
  return { records, history, pending, error, status, currentObservation, prepare, run, exportRecord, importRecord,
    currentAddress: account?.address ?? null, targetKey }
}
