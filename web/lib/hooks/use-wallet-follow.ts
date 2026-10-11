'use client'

import { useEffect, useState } from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createWalletFollowIntent, readWalletFollowState, runWalletFollowOperation, walletFollowOperationKey, WalletFollowPersistenceError,
  type WalletFollowOperation, type WalletFollowSnapshot } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { getBrowserSocialConfig } from '@/lib/social/social-config'
import { browserWalletFollowOperationStore, createWalletFollowOperationClient } from '@/lib/social/follow-operation-client'
import { useWalletSign } from './use-wallet-sign'

function configuration() {
  try { return { config: structuredClone(getBrowserSocialConfig()), error: null } }
  catch (error) { return { config: null, error: error instanceof Error ? error : new Error('Social configuration unavailable') } }
}
function queryKey(targetId: string | null, owner: string | null) {
  const { config } = configuration()
  return ['follow-status', config?.deployment ?? null, targetId, owner] as const
}
export function useWalletFollowStatus(targetId: string | null) {
  const { walletAddress } = useAuth()
  const { suiGrpcClient } = useWalletSign()
  return useQuery<WalletFollowSnapshot>({
    queryKey: queryKey(targetId, walletAddress),
    queryFn: async ({ signal }) => {
      const { config, error } = configuration()
      if (!config) throw error
      if (!targetId) throw new Error('Follow target is required')
      return readWalletFollowState({ client: suiGrpcClient, deployment: config.deployment,
        targetProfileId: targetId, viewerAddress: walletAddress, signal })
    },
    enabled: !!targetId,
  })
}

/** The browser log is recovery evidence only. Never optimistically claim a
 * relationship, replace unknown signed bytes, or apply another wallet's result. */
export function useWalletFollowOperation(targetId: string) {
  const { walletAddress, loading, profileError } = useAuth()
  const { suiGrpcClient, getWalletAddress, signTransaction, walletAccount, currentWallet } = useWalletSign()
  const queryClient = useQueryClient()
  const rendered=configuration(),scope=JSON.stringify([rendered.config?.deployment??null,walletAddress,targetId])
  const session=useCommittedSession(scope,walletAccount,suiGrpcClient,currentWallet)
  const [record, setRecord] = useSessionState<WalletFollowOperation | null>(session,null)
  const [error, setError] = useSessionState<string | null>(session,null)
  const [busy, setBusy] = useSessionState(session,false)
  const [recoveryExport, setRecoveryExport] = useSessionState<string | null>(session,null)
  const [emergency]=useState(()=>new Map<string,WalletFollowOperation>())

  function context(lease:SessionLease|null=session.capture()) {
    if(!lease?.matches())throw new Error('Follow context changed')
    if (!walletAddress) throw new Error('Connect your profile wallet')
    const config = rendered.config
    if(!config)throw rendered.error
    if(JSON.stringify(getBrowserSocialConfig().deployment)!==JSON.stringify(config.deployment))throw new Error('Follow release changed')
    const key = walletFollowOperationKey({ deployment: config.deployment, owner: walletAddress, targetId })
    const store = browserWalletFollowOperationStore()
    const client = createWalletFollowOperationClient({ client: suiGrpcClient, deployment: config.deployment,
      writesEnabled: () => {
        const live=getBrowserSocialConfig()
        if(JSON.stringify(live.deployment)!==JSON.stringify(config.deployment))throw new Error('Follow release changed')
        return lease.matches()&&live.writesEnabled
      },
      getAddress: () => lease.matches()?getWalletAddress():null,
      sign: transaction=>{
        if(!lease.matches()||getWalletAddress()!==walletAddress)throw new Error('Follow context changed')
        return Promise.resolve(signTransaction(transaction)).then(result=>{
          if(!lease.matches())throw new Error('Follow context changed')
          return result
        })
      } })
    return { config, key, store, client, owner: walletAddress }
  }
  function show(next: WalletFollowOperation | null) {
    const savedEmergency = emergency.get(scope)??null
    const exported = savedEmergency && (!next || savedEmergency.digest === next.digest) ? savedEmergency : next
    setRecord(next); setRecoveryExport(exported ? JSON.stringify(exported, null, 2) : null)
  }
  useEffect(() => {
    if (!walletAddress) return
    try { const ctx = context(); show(ctx.store.read(ctx.key)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Follow recovery could not be read') }
    // No fresh transaction is created by inspection, navigation or wallet connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function run(mode: 'set' | 'query' | 'resume' | 'cancel', snapshot?: WalletFollowSnapshot, following?: boolean) {
    const lease=session.capture()
    if(!lease?.matches())throw new Error('Follow context changed')
    if(lease.isRunning())throw new Error('Follow operation is already running')
    lease.setRunning(true)
    const current=lease.matches
    setBusy(true);setError(null)
    let ctx: ReturnType<typeof context> | undefined
    try {
      ctx = context(lease)
      const { config, key, store, client, owner } = ctx
      const result = await store.exclusive(key, async () => {
        if(!current())throw new Error('Follow context changed')
        const previous = store.read(key)
        const leased = { ...store, exclusive: async <T,>(requested: string, work: () => Promise<T>) => {
          if (requested !== key) throw new Error('Follow recovery lock scope changed')
          return work()
        } }
        if (mode !== 'set') {
          if (!previous) throw new Error('No saved follow transaction')
          return runWalletFollowOperation({ intent: previous.intent, store: leased, adapter: client.adapter,
            queryOnly: mode === 'query', cancelUnsigned: mode === 'cancel' })
        }
        if (loading || profileError) throw new Error('Reload your chain profile before following')
        if (!snapshot?.viewer || snapshot.viewer.owner !== owner || snapshot.target.id !== targetId || typeof following !== 'boolean') {
          throw new Error('Read the registered profiles before following')
        }
        if (previous && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(previous.phase)) {
          throw new Error('Recover the existing follow transaction first')
        }
        const intent = createWalletFollowIntent({ deployment: config.deployment, owner, actorId: snapshot.viewer.id,
          targetId, targetOwner: snapshot.target.owner, expectedRevision: snapshot.edgeRevision, following })
        const prepared = await client.prepare(intent)
        if(!current())throw new Error('Follow context changed')
        return runWalletFollowOperation({ intent, prepared, store: leased, adapter: client.adapter })
      })
      if (current()) {
        show(result)
        if (result.phase === 'SUCCEEDED' || result.phase === 'FAILED') {
          await queryClient.invalidateQueries({ queryKey: queryKey(targetId, walletAddress) })
        }
      }
      return result
    } catch (failure) {
      if (failure instanceof WalletFollowPersistenceError) {
        const failed=failure.record,previous=emergency.get(scope)
        emergency.set(scope,previous?.digest===failed.digest&&previous.signature&&!failed.signature?previous:failed)
      }
      if (current()) {
        if (ctx) { try { show(ctx.store.read(ctx.key)) } catch { /* Keep prior evidence visible. */ } }
        if (failure instanceof WalletFollowPersistenceError) {
          setRecoveryExport(JSON.stringify(emergency.get(scope), null, 2))
        }
        setError(failure instanceof Error ? failure.message : 'Follow transaction failed')
      }
      throw failure
    } finally {
      lease.setRunning(false)
      if(current())setBusy(false)
    }
  }
  return { record,error,busy,recoveryExport,
    setFollowing: (snapshot: WalletFollowSnapshot, following: boolean) => run('set', snapshot, following),
    query: () => run('query'), resume: () => run('resume'), cancel: () => run('cancel') }
}
