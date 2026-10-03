'use client'

import {useEffect} from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { profileReadStep } from '@soulidity/sdk'
import { getBrowserNativeMarketCancelConfig, readBrowserNativeMarketCancel, type BrowserNativeMarketCancelConfig } from '@/lib/animacraft/browser-native-market-read'
import { confirmBrowserNativeMarketCancel } from '@/lib/animacraft/browser-native-market-readback'
import { browserMarketCancelOperationStore, marketCancelOperationKey, runMarketCancelOperation, queryMarketCancelHistory,
  terminalMarketCancelOperation, type MarketCancelQueryResult, type MarketCancelOperationRecord, type MarketCancelSnapshot } from '@/lib/animacraft/market-cancel-operation'
import { createMarketCancelOperationAdapter } from '@/lib/animacraft/market-cancel-operation-adapter'

/** The original modal and its recovery notice share one durable wallet/Soul
 * intent. Closing a modal or losing current ownership never erases that intent. */
export function useNativeMarketCancelActions(params: {
  soulId: string; stateId: string; listingId: string | null; kioskCapId: string | null;
  enabled: boolean; onChanged: () => void
}) {
  const account = useCurrentAccount(), client = useSuiClient()
  const { currentWallet } = useCurrentWallet()
  const { mutateAsync: signTransaction } = useSignTransaction()
  const address = account?.address ?? null
  let releaseConfig: BrowserNativeMarketCancelConfig | null = null, configError: unknown
  try { releaseConfig = getBrowserNativeMarketCancelConfig() } catch (cause) { configError = cause }
  const key = JSON.stringify([params.soulId, params.stateId, params.enabled, params.listingId, params.kioskCapId, address, releaseConfig ?? message(configError)])
  const session=useCommittedSession(key,account,client,currentWallet),matches=session.matches
  const [snapshot, setSnapshot] = useSessionState<MarketCancelSnapshot | null>(session,null)
  const [record, setRecord] = useSessionState<MarketCancelOperationRecord | null>(session,null)
  const [confirmedResult, setConfirmedResult] = useSessionState<MarketCancelOperationRecord | null>(session,null)
  const [history, setHistory] = useSessionState<MarketCancelOperationRecord[]>(session,[])
  const [historyResults, setHistoryResults] = useSessionState<Record<string, MarketCancelQueryResult>>(session,{})
  const [error, setError] = useSessionState<string | null>(session,null)
  const [loading,setLoading]=useSessionState(session,params.enabled), [busy, setBusy] = useSessionState(session,false)
  const [refreshIndex, setRefreshIndex] = useSessionState(session,0)
  function readRecovery() {
    if (!address || !matches()) return
    const store = browserMarketCancelOperationStore(), scope = marketCancelOperationKey(params.soulId, address)
    // Read both before publishing state. A corrupt archive is not an empty history.
    const saved = store.read(scope), archived = store.history(scope)
    setRecord(saved); setHistory(archived)
  }
  useEffect(() => {
    if (address) {
      try { readRecovery() }
      catch (cause) { setError(message(cause)) }
    }
    const changed = (event: StorageEvent) => {
      if (!address) return
      const scope = marketCancelOperationKey(params.soulId, address)
      if (event.key !== null && event.key !== scope && !event.key.startsWith(`${scope}:retired:`)) return
      setConfirmedResult(null)
      try { readRecovery() }
      catch (cause) { setError(message(cause)) }
    }
    window.addEventListener('storage', changed)
    return () => {
      window.removeEventListener('storage', changed)
    }
  }, [session])

  async function read(listingId = params.listingId ?? undefined, capId = params.kioskCapId ?? undefined,lease:SessionLease|null=session.capture()) {
    const matches=()=>lease?.matches()===true
    if (!matches()) throw new Error('Soul or wallet changed; reopen cancellation')
    if (!releaseConfig) throw configError ?? new Error('Native cancellation configuration unavailable')
    if (!listingId) throw new Error('NATIVE_MARKET_CANCEL_LISTING_UNAVAILABLE')
    const controller = new AbortController(); lease!.requests.add(controller)
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])
      const value = await profileReadStep(signal, () => readBrowserNativeMarketCancel({ soulId: params.soulId,
        stateId: params.stateId, listingId, kioskCapId: capId, config: releaseConfig!, signal }))
      if (!matches() || value.schema !== 'native-market-cancel-v1' || value.soulId !== params.soulId || value.stateId !== params.stateId) {
        throw new Error('Cancellation state does not match this Soul')
      }
      return value as MarketCancelSnapshot
    } finally { lease!.requests.delete(controller) }
  }

  useEffect(() => {
    if (!params.enabled) return
    let current = true
    void read().then(value => { if (current && matches()) { setSnapshot(value) } })
      .catch(cause => { if (current && matches()) setError(message(cause)) })
      .finally(() => { if (current && matches()) setLoading(false) })
    return () => { current = false }
  }, [session, params.enabled, params.listingId, params.kioskCapId, refreshIndex])

  const visibleRecord = record?.soulId === params.soulId && record.owner === address ? record : null
  const visibleHistory = history.filter(value => value.soulId === params.soulId && value.owner === address)
  const visibleSnapshot = snapshot?.soulId === params.soulId && snapshot.stateId === params.stateId ? snapshot : null
  const visibleConfirmed = confirmedResult?.digest === visibleRecord?.digest ? confirmedResult : null
  const pending = Boolean(visibleRecord && !terminalMarketCancelOperation(visibleRecord))
  const needsRecovery = pending || visibleRecord?.phase === 'RETIRED' || visibleRecord?.phase === 'SUCCEEDED'
    && (!visibleConfirmed || visibleRecord.syncStatus === 'PENDING')
  const canStart = Boolean(account && currentWallet && visibleSnapshot?.owner === address && visibleSnapshot.listed
    && visibleSnapshot.listingActive && visibleSnapshot.release?.writesEnabled && !busy && !loading && !pending)
  function createAdapter(start = false,lease:SessionLease) {
    const matches=lease.matches
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      if (!grpc) throw new Error('The verified gRPC wallet client is required')
      return createMarketCancelOperationAdapter({ client:grpc,read:(listingId,capId)=>read(listingId,capId,lease), observed: start ? visibleSnapshot ?? undefined : undefined,
        getAddress: () => matches() ? address : null,
        sign: transaction => {
          if (!matches() || !account) throw new Error('Wallet or network client changed before signature')
          return Promise.resolve(signTransaction({transaction,account,chain:'sui:mainnet'})).then(result=>{
          if(!matches())throw new Error('Wallet or network client changed during signature')
          return result
        })
        },
        sync: async value => {
          if (!matches()) throw new Error('Wallet changed; check the saved cancellation after reconnecting')
          if (!releaseConfig) throw configError ?? new Error('Native cancellation configuration unavailable; saved transaction remains queryable')
          const controller = new AbortController(); lease!.requests.add(controller)
          try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])
            const result = await profileReadStep(signal, () => confirmBrowserNativeMarketCancel(value,
              { target: releaseConfig!.target, signal }, { client: grpc }))
            if (!matches()) throw new Error('Wallet changed during cancellation readback')
            return result
          } finally { lease!.requests.delete(controller) }
        },
      })
  }
  async function run(start = false, queryOnly = false, cancelUnsigned = false, retireExpired = false) {
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if (!address || !account || !matches() || lease!.isRunning() || (start && !canStart)) return null
    lease!.setRunning(true); setBusy(true); setError(null)
    setConfirmedResult(null)
    try {
      const result = await runMarketCancelOperation({ soulId: params.soulId, owner: address, start, queryOnly, cancelUnsigned, retireExpired,
        store: browserMarketCancelOperationStore(), adapter: createAdapter(start,lease!),
        onRecord: value => { if (matches()) setRecord(value) },
      })
      if (!matches()) return null
      readRecovery()
      setRecord(result)
      if (result.phase === 'RETIRED' && retireExpired) {
        setSnapshot(null);setLoading(params.enabled); setRefreshIndex(value => value + 1)
      }
      if (result.phase === 'SUCCEEDED') {
        setConfirmedResult(result)
        params.onChanged()
      }
      return result
    } catch (cause) {
      if (matches()) {
        setError(message(cause))
        try { readRecovery() }
        catch { /* Keep the storage/transaction error; never clear unknown bytes. */ }
      }
      return null
    } finally { lease!.setRunning(false); if (matches()) setBusy(false) }
  }
  async function checkHistory(digest: string): Promise<MarketCancelQueryResult | null> {
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if (!address || !account || !matches() || lease!.isRunning()) return null
    lease!.setRunning(true); setBusy(true); setError(null)
    try {
      const result = await queryMarketCancelHistory({ soulId: params.soulId, owner: address, digest,
        store: browserMarketCancelOperationStore(), adapter: createAdapter(false,lease!) })
      if (!matches()) return null
      setHistoryResults(previous => ({ ...previous, [digest]: result }))
      return result
    } catch (cause) {
      if (matches()) setError(message(cause))
      return null
    } finally { lease!.setRunning(false); if (matches()) setBusy(false) }
  }
  return { record: visibleRecord, confirmedResult: visibleConfirmed, snapshot: visibleSnapshot, history: visibleHistory,
    historyResults, checkHistory,
    error, loading, busy, pending, needsRecovery, canStart,
    refresh: () => { setError(null); setConfirmedResult(null);setSnapshot(null);setLoading(params.enabled); setRefreshIndex(value => value + 1) },
    start: () => run(true), resume: () => run(), check: () => run(false, true), cancelUnsigned: () => run(false, false, true),
    retireExpired: () => run(false, false, false, true) }
}
function message(error: unknown) {
  if (!(error instanceof Error)) return 'Cancellation result is unknown. Check the saved transaction before retrying.'
  const known: Record<string, string> = {
    NATIVE_RECEIVE_TARGET_UNAVAILABLE: 'The native market release is not configured. Saved transaction checks remain available.',
    NATIVE_MARKET_CANCEL_LISTING_UNAVAILABLE: 'The current listing could not be found. Refresh the Soul page.',
    NATIVE_MARKET_CANCEL_INVALID: 'Listing or wallet custody could not be verified. Refresh before signing.',
    NATIVE_EQUIPMENT_CHANGED: 'The Soul changed during verification. Refresh its current state.',
  }
  return known[error.message] ?? error.message
}
