'use client'

import {useEffect} from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { useQueryClient } from '@tanstack/react-query'
import { profileReadStep } from '@soulidity/sdk'
import { getBrowserNativeMarketConfig, getBrowserNativeMarketCancelConfig, readBrowserNativeMarketBuy,
  type BrowserNativeMarketConfig, type BrowserNativeMarketCancelConfig } from '@/lib/animacraft/browser-native-market-read'
import { confirmBrowserNativeMarketBuy } from '@/lib/animacraft/browser-native-market-readback'
import { browserMarketBuyOperationStore, marketBuyOperationKey, runMarketBuyOperation, queryMarketBuyHistory,
  terminalMarketBuyOperation, validateMarketBuySnapshot,
  type MarketBuyOperationRecord, type MarketBuySnapshot } from '@/lib/animacraft/market-buy-operation'
import { createMarketBuyOperationAdapter } from '@/lib/animacraft/market-buy-operation-adapter'

type HistoryResult = 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
type Scope = { soulId: string; stateId: string; listingId: string | null } | null

/** A native checkout remains recoverable after its listing disappears. Neither
 * wallet/session changes nor failed chain refreshes erase money-bearing intents. */
export function useNativeMarketBuyActions(scope: Scope) {
  const account = useCurrentAccount(), client = useSuiClient()
  const { currentWallet } = useCurrentWallet(), { mutateAsync: signTransaction } = useSignTransaction()
  const queryClient = useQueryClient()
  const address = account?.address ?? null
  let releaseConfig: BrowserNativeMarketConfig | null = null, configError: unknown
  try { if (scope) releaseConfig = getBrowserNativeMarketConfig() } catch (cause) { configError = cause }
  let readbackConfig: BrowserNativeMarketCancelConfig | null = null, readbackError: unknown
  try { if (scope) readbackConfig = getBrowserNativeMarketCancelConfig() } catch (cause) { readbackError = cause }
  const key = JSON.stringify([scope?.soulId, scope?.stateId, scope?.listingId, address,
    releaseConfig ?? message(configError), readbackConfig ?? message(readbackError)])
  const session=useCommittedSession(key,account,client,currentWallet),matches=session.matches
  const [snapshot, setSnapshot] = useSessionState<MarketBuySnapshot | null>(session,null)
  const [record, setRecord] = useSessionState<MarketBuyOperationRecord | null>(session,null)
  const [confirmedResult, setConfirmedResult] = useSessionState<MarketBuyOperationRecord | null>(session,null)
  const [history, setHistory] = useSessionState<MarketBuyOperationRecord[]>(session,[])
  const [historyResults, setHistoryResults] = useSessionState<Record<string, HistoryResult>>(session,{})
  const [error, setError] = useSessionState<string | null>(session,null)
  const [loading,setLoading]=useSessionState(session,Boolean(scope&&address)), [busy, setBusy] = useSessionState(session,false)
  const [refreshIndex, setRefreshIndex] = useSessionState(session,0)
  function readRecovery() {
    if (!scope || !address || !matches()) return
    const store = browserMarketBuyOperationStore(), storageKey = marketBuyOperationKey(scope.soulId, address)
    const saved = store.read(storageKey), archived = store.history(storageKey)
    setRecord(saved); setHistory(archived)
  }
  useEffect(() => {
    try { readRecovery() } catch (cause) { setError(message(cause)) }
    const changed = (event: StorageEvent) => {
      if (!scope || !address) return
      const storageKey = marketBuyOperationKey(scope.soulId, address)
      if (event.key !== null && event.key !== storageKey && !event.key.startsWith(`${storageKey}:retired:`)) return
      try { readRecovery() } catch (cause) { setError(message(cause)) }
    }
    window.addEventListener('storage', changed)
    return () => {
      window.removeEventListener('storage', changed)
    }
  }, [session])

  async function read(listingId = scope?.listingId ?? undefined,lease:SessionLease|null=session.capture()) {
    const matches=()=>lease?.matches()===true
    if (!scope || !address || !matches()) throw new Error('Soul or wallet changed; reopen checkout')
    if (!releaseConfig) throw configError ?? new Error('Native market configuration unavailable')
    const controller = new AbortController(); lease!.requests.add(controller)
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])
      const value = await profileReadStep(signal, () => readBrowserNativeMarketBuy({ soulId: scope.soulId,
        stateId: scope.stateId, buyer: address, listingId, config: releaseConfig!, signal }))
      const verified = validateMarketBuySnapshot(value)
      if (!matches() || verified.soulId !== scope.soulId || verified.stateId !== scope.stateId || verified.buyer !== address) {
        throw new Error('Purchase quote does not match this Soul and wallet')
      }
      return verified
    } finally { lease!.requests.delete(controller) }
  }
  useEffect(() => {
    if (!scope || !address) return
    let current = true
    void read().then(value => { if (current && matches()) { setSnapshot(value) } })
      .catch(cause => { if (current && matches()) setError(message(cause)) })
      .finally(() => { if (current && matches()) setLoading(false) })
    return () => { current = false }
  }, [session, scope?.listingId, refreshIndex])

  const visibleRecord = record?.snapshot.soulId === scope?.soulId && record?.snapshot.buyer === address ? record : null
  const visibleHistory = history.filter(value => value.snapshot.soulId === scope?.soulId && value.snapshot.buyer === address)
  const visibleSnapshot = snapshot?.soulId === scope?.soulId && snapshot?.buyer === address ? snapshot : null
  const visibleConfirmed = confirmedResult?.digest === visibleRecord?.digest ? confirmedResult : null
  const pending = Boolean(visibleRecord && !terminalMarketBuyOperation(visibleRecord))
  const needsRecovery = pending || visibleRecord?.phase === 'RETIRED' || visibleRecord?.phase === 'SUCCEEDED'
    && (!visibleConfirmed || visibleRecord.syncStatus === 'PENDING')
  const canStart = Boolean(scope && account && currentWallet && visibleSnapshot?.buyer === address
    && visibleSnapshot.seller !== address && visibleSnapshot.purchaseAvailable && visibleSnapshot.release.writesEnabled && !busy && !loading && !pending)
  function createAdapter(start = false,lease:SessionLease) {
    const matches=lease.matches
    const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
    if (!grpc) throw new Error('The verified gRPC wallet client is required')
    return createMarketBuyOperationAdapter({ client:grpc,read:listingId=>read(listingId,lease), observed: start ? visibleSnapshot ?? undefined : undefined,
      getAddress: () => matches() ? address : null,
      sign: transaction => {
        if (!matches() || !account) throw new Error('Wallet or network client changed before signature')
        return Promise.resolve(signTransaction({transaction,account,chain:'sui:mainnet'})).then(result=>{
          if(!matches())throw new Error('Wallet or network client changed during signature')
          return result
        })
      },
      sync: async value => {
        if (!matches()) throw new Error('Wallet changed; check the saved purchase after reconnecting')
        if (!readbackConfig) throw readbackError ?? new Error('Native release configuration unavailable; saved transaction remains queryable')
        const controller = new AbortController(); lease!.requests.add(controller)
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])
          const result = await profileReadStep(signal, () => confirmBrowserNativeMarketBuy(value,
            { target: readbackConfig!.target, signal }, { client: grpc }))
          if (!matches()) throw new Error('Wallet changed during purchase readback')
          return result
        } finally { lease!.requests.delete(controller) }
      },
    })
  }
  async function run(start = false, queryOnly = false, cancelUnsigned = false, retireExpired = false) {
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if (!scope || !address || !account || !matches() || lease!.isRunning() || (start && !canStart)) return null
    lease!.setRunning(true); setBusy(true); setError(null)
    setConfirmedResult(null)
    try {
      const result = await runMarketBuyOperation({ soulId: scope.soulId, owner: address, start, queryOnly, cancelUnsigned, retireExpired,
        store: browserMarketBuyOperationStore(), adapter: createAdapter(start,lease!), onRecord: value => { if (matches()) setRecord(value) },
      })
      if (!matches()) return null
      readRecovery(); setRecord(result)
      if (result.phase === 'RETIRED' && retireExpired) { setSnapshot(null);setLoading(Boolean(scope&&address)); setRefreshIndex(value => value + 1) }
      if (result.phase === 'SUCCEEDED') {
        setConfirmedResult(result)
        void queryClient.invalidateQueries({ queryKey: ['soul'] }); void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
        void queryClient.invalidateQueries({ queryKey: ['souls'] })
      }
      return result
    } catch (cause) {
      if (matches()) {
        setError(message(cause))
        try { readRecovery() } catch { /* Preserve the original failure and unknown packet. */ }
      }
      return null
    } finally { lease!.setRunning(false); if (matches()) setBusy(false) }
  }
  async function checkHistory(digest: string): Promise<HistoryResult | null> {
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if (!scope || !address || !account || !matches() || lease!.isRunning()) return null
    lease!.setRunning(true); setBusy(true); setError(null)
    try {
      const result = await queryMarketBuyHistory({ soulId: scope.soulId, owner: address, digest,
        store: browserMarketBuyOperationStore(), adapter: createAdapter(false,lease!) })
      if (!matches()) return null
      setHistoryResults(previous => ({ ...previous, [digest]: result })); return result
    } catch (cause) { if (matches()) setError(message(cause)); return null }
    finally { lease!.setRunning(false); if (matches()) setBusy(false) }
  }
  return { snapshot: visibleSnapshot, record: visibleRecord, confirmedResult: visibleConfirmed, history: visibleHistory,
    historyResults, error, loading, busy, pending, needsRecovery, canStart,
    wallet: account ? { address: account.address } : null,
    refresh: () => { setError(null);setSnapshot(null);setLoading(Boolean(scope&&address)); setRefreshIndex(value => value + 1) }, checkHistory,
    start: () => run(true), resume: () => run(), check: () => run(false, true), cancelUnsigned: () => run(false, false, true),
    retireExpired: () => run(false, false, false, true) }
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Purchase result is unknown. Check the saved transaction before retrying.'
}
