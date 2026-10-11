'use client'

import { useEffect } from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPublicCommunityVoteIntent, readPublicCommunityVotes, runPublicCommunityVoteOperation, publicCommunityVoteOperationKey, PublicCommunityVotePersistenceError,
  type PublicCommunityVoteOperation, type PublicCommunityVotesSnapshot } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { getBrowserVoteConfig, getBrowserVoteReadConfig } from '@/lib/community/vote-config'
import { browserPublicCommunityVoteOperationStore, createPublicCommunityVoteOperationClient } from '@/lib/community/vote-operation-client'
import { useWalletSign } from './use-wallet-sign'

// Feed cards are routinely removed by sorting/filtering/refresh. Emergency
// signatures must outlive those components when durable storage has failed.
// Scope remains exact release/wallet/Post; WeakMap lifetime is the app session,
// not persistent storage. Export is still required before closing/reloading it.
const sessionEmergency = new WeakMap<ReturnType<typeof useQueryClient>, Map<string, PublicCommunityVoteOperation>>()

function configuration() {
  try { return { config: structuredClone(getBrowserVoteReadConfig()), error: null } }
  catch (error) { return { config: null, error: error instanceof Error ? error : new Error('Vote configuration unavailable') } }
}
function queryKey(postId: string | null, owner: string | null, config: ReturnType<typeof configuration>['config']) {
  return ['vote-status', config?.deployment ?? null, postId, owner] as const
}
export function useWalletVoteStatus(postId: string | null) {
  const { walletAddress } = useAuth()
  const { suiGrpcClient } = useWalletSign()
  const { config, error } = configuration()
  return useQuery<PublicCommunityVotesSnapshot>({
    queryKey: queryKey(postId, walletAddress, config),
    queryFn: async ({ signal }) => {
      if (!config) throw error
      if (!postId) throw new Error('Vote target is required')
      return readPublicCommunityVotes({ client: suiGrpcClient, deployment: config.deployment,
        postId, viewerAddress: walletAddress, signal })
    },
    enabled: !!postId,
  })
}

/** The browser log is recovery evidence only. Never optimistically claim a
 * vote, replace unknown signed bytes, or apply another wallet/release's result. */
export function useWalletVoteOperation(postId: string) {
  const { walletAddress, loading, profileError } = useAuth()
  const { suiGrpcClient, getWalletAddress, signTransaction, walletAccount, currentWallet } = useWalletSign()
  const queryClient = useQueryClient()
  const rendered = configuration()
  const scope = JSON.stringify([rendered.config?.deployment ?? null, walletAddress, postId])
  const session=useCommittedSession(scope,walletAccount,suiGrpcClient,currentWallet)
  const [record,setRecord]=useSessionState<PublicCommunityVoteOperation|null>(session,null)
  const [error,setError]=useSessionState<string|null>(session,null)
  const [busy,setBusy]=useSessionState(session,false)
  const [recoveryExport,setRecoveryExport]=useSessionState<string|null>(session,null)
  function emergency(){
    let recovery=sessionEmergency.get(queryClient)
    if(!recovery){recovery=new Map();sessionEmergency.set(queryClient,recovery)}
    return recovery
  }

  function context(lease:SessionLease|null=session.capture()) {
    if(!lease?.matches())throw new Error('Vote context changed')
    if (!walletAddress) throw new Error('Connect your profile wallet')
    const config = rendered.config
    if (!config) throw rendered.error
    const live = getBrowserVoteReadConfig()
    if (JSON.stringify(live.deployment) !== JSON.stringify(config.deployment)) throw new Error('Vote release changed')
    const key = publicCommunityVoteOperationKey({ deployment: config.deployment, owner: walletAddress, postId })
    const store = browserPublicCommunityVoteOperationStore()
    const client = createPublicCommunityVoteOperationClient({ client: suiGrpcClient, deployment: config.deployment,
      writesEnabled: () => {
        const live = getBrowserVoteConfig()
        if (publicCommunityVoteOperationKey({ deployment: live.deployment, owner: walletAddress, postId }) !== key) {
          throw new Error('Vote release changed')
        }
        return lease.matches()&&live.writesEnabled
      },
      // Query-only recovery remains available, but an asynchronous preparation
      // cannot prompt or send after unmount, navigation, or a release change.
      getAddress: () => lease.matches()?getWalletAddress():null,
      sign: transaction=>{
        if(!lease.matches()||getWalletAddress()!==walletAddress)throw new Error('Vote context changed')
        return Promise.resolve(signTransaction(transaction)).then(result=>{
          if(!lease.matches())throw new Error('Vote context changed')
          return result
        })
      } })
    return { config, key, store, client, owner: walletAddress }
  }
  function show(next: PublicCommunityVoteOperation | null) {
    const savedEmergency = emergency().get(scope) ?? null
    const exported = savedEmergency && (!next || savedEmergency.digest === next.digest) ? savedEmergency : next
    setRecord(next); setRecoveryExport(exported ? JSON.stringify(exported, null, 2) : null)
  }
  useEffect(() => {
    if (!walletAddress) return
    try { const ctx = context(); show(ctx.store.read(ctx.key)) }
    catch (failure) {
      const savedEmergency = emergency().get(scope)
      if (savedEmergency) setRecoveryExport(JSON.stringify(savedEmergency, null, 2))
      setError(failure instanceof Error ? failure.message : 'Vote recovery could not be read')
    }
    // No fresh transaction is created by inspection, navigation or wallet connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function run(mode: 'set' | 'query' | 'resume' | 'cancel', snapshot?: PublicCommunityVotesSnapshot, desired?: 0 | 1 | 2) {
    const lease=session.capture()
    if(!lease?.matches())throw new Error('Vote context changed')
    if(lease.isRunning())throw new Error('Vote operation is already running')
    lease.setRunning(true)
    const current=lease.matches
    setBusy(true);setError(null)
    let ctx: ReturnType<typeof context> | undefined
    try {
      ctx = context(lease)
      const { config, key, store, client, owner } = ctx
      const result = await store.exclusive(key, async () => {
        if(!current())throw new Error('Vote context changed')
        const previous = store.read(key)
        const leased = { ...store, exclusive: async <T,>(requested: string, work: () => Promise<T>) => {
          if (requested !== key) throw new Error('Vote recovery lock scope changed')
          return work()
        } }
        if (mode !== 'set') {
          if (!previous) throw new Error('No saved vote transaction')
          return runPublicCommunityVoteOperation({ intent: previous.intent, store: leased, adapter: client.adapter,
            queryOnly: mode === 'query', cancelUnsigned: mode === 'cancel' })
        }
        if (loading || profileError) throw new Error('Reload your chain profile before voting')
        if (!snapshot?.viewer || snapshot.viewer.owner !== owner || snapshot.viewerAddress !== owner || snapshot.post.id !== postId
          || snapshot.post.registryId !== config.deployment.community.registryId
          || snapshot.post.profileRegistryId !== config.deployment.community.profile.registryId
          || (desired !== 0 && desired !== 1 && desired !== 2)) {
          throw new Error('Read the registered profiles before voting')
        }
        if (previous && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(previous.phase)) {
          throw new Error('Recover the existing vote transaction first')
        }
        const intent = createPublicCommunityVoteIntent({ deployment: config.deployment, owner, actorId: snapshot.viewer.id,
          postId, expectedRevision: snapshot.revision, desired })
        const prepared = await client.prepare(intent)
        if(!current())throw new Error('Vote context changed')
        return runPublicCommunityVoteOperation({ intent, prepared, store: leased, adapter: client.adapter })
      })
      if (current()) {
        show(result)
        if (result.phase === 'SUCCEEDED' || result.phase === 'FAILED') {
          await queryClient.invalidateQueries({ queryKey: queryKey(postId, walletAddress, config) })
        }
      }
      return result
    } catch (failure) {
      if (failure instanceof PublicCommunityVotePersistenceError) {
        const failed = failure.record, previous = emergency().get(scope)
        const evidence = previous?.digest === failed.digest && previous.signature && !failed.signature ? previous : failed
        emergency().set(scope, evidence)
      }
      if (current()) {
        if (ctx) { try { show(ctx.store.read(ctx.key)) } catch { /* Keep prior evidence visible. */ } }
        if (failure instanceof PublicCommunityVotePersistenceError) {
          setRecoveryExport(JSON.stringify(emergency().get(scope), null, 2))
        }
        setError(failure instanceof Error ? failure.message : 'Vote transaction failed')
      }
      throw failure
    } finally {
      lease.setRunning(false)
      if(current())setBusy(false)
    }
  }
  return { record,error,busy,recoveryExport,
    setVote: (snapshot: PublicCommunityVotesSnapshot, desired: 0 | 1 | 2) => run('set', snapshot, desired),
    query: () => run('query'), resume: () => run('resume'), cancel: () => run('cancel') }
}
