'use client'

import { useEffect, useState } from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import { useQueryClient } from '@tanstack/react-query'
import { createPublicCommunityAcceptIntent, runPublicCommunityAcceptOperation, publicCommunityAcceptOperationKey,
  PublicCommunityAcceptPersistenceError, type PublicCommunityAcceptIntent, type PublicCommunityAcceptOperation, type PublicCommunityPostSnapshot } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { getBrowserCommunityAcceptDeployment, getBrowserCommunityAcceptWritesEnabled } from '@/lib/community/accept-config'
import { browserPublicCommunityAcceptOperationStore, createPublicCommunityAcceptOperationClient } from '@/lib/community/accept-operation-client'
import { useWalletSign } from './use-wallet-sign'

function configuration() {
  try { return { deployment: structuredClone(getBrowserCommunityAcceptDeployment()), error: null } }
  catch (error) { return { deployment: null, error: error instanceof Error ? error : new Error('Acceptance configuration unavailable') } }
}

/** Keep the selected answer frozen while its transaction is unresolved. No
 * optimistic accepted badge: only refreshed chain detail is display authority. */
export function useCommunityAccept(postId: string) {
  const { walletAddress, loading, profileError } = useAuth()
  const { suiGrpcClient, getWalletAddress, signTransaction, walletAccount, currentWallet } = useWalletSign()
  const queryClient = useQueryClient(), rendered = configuration()
  const scope = JSON.stringify([rendered.deployment, walletAddress, postId])
  const session=useCommittedSession(scope,walletAccount,suiGrpcClient,currentWallet)
  const [emergency]=useState(()=>new Map<string,PublicCommunityAcceptOperation>())
  const [view,setView]=useSessionState<{record:PublicCommunityAcceptOperation|null;error:string|null;recoveryExport:string|null}>(
    session,{record:null,error:null,recoveryExport:null})
  const [busy,setBusy]=useSessionState(session,false)
  function contextCurrent(lease:SessionLease|null) {
    if (!lease?.matches()) return false
    if (!rendered.deployment) return true
    try { return JSON.stringify(getBrowserCommunityAcceptDeployment()) === JSON.stringify(rendered.deployment) }
    catch { return false }
  }
  function context(lease:SessionLease|null=session.capture()) {
    const current=()=>contextCurrent(lease)
    if (!current()) throw new Error('Acceptance context changed')
    if (!walletAddress) throw new Error('Connect your profile wallet')
    const deployment = rendered.deployment
    if (!deployment) throw rendered.error
    const key = publicCommunityAcceptOperationKey({ deployment, owner: walletAddress, postId })
    const store = browserPublicCommunityAcceptOperationStore()
    const client = createPublicCommunityAcceptOperationClient({ client: suiGrpcClient, deployment,
      writesEnabled: () => current() && getWalletAddress() === walletAddress && getBrowserCommunityAcceptWritesEnabled(),
      getAddress: () => current() ? getWalletAddress() : null,
      sign: transaction=>{
        if(!current()||getWalletAddress()!==walletAddress)throw new Error('Acceptance context changed')
        return Promise.resolve(signTransaction(transaction)).then(result=>{
          if(!current())throw new Error('Acceptance context changed')
          return result
        })
      } })
    return { deployment, key, store, client, owner: walletAddress }
  }
  function show(record: PublicCommunityAcceptOperation | null, error: string | null = null) {
    const evidence = emergency.get(scope)
    const exported = evidence && (!record || evidence.digest === record.digest) ? evidence : record
    setView({ record, error, recoveryExport: exported ? JSON.stringify(exported, null, 2) : null })
  }
  useEffect(() => {
    if (!walletAddress) { show(null); return }
    try { const ctx = context(); show(ctx.store.read(ctx.key)) }
    catch (error) { show(null, error instanceof Error ? error.message : 'Acceptance recovery unavailable') }
    // Inspect only; never prepare/sign because a page was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function run(mode: 'accept' | 'query' | 'resume' | 'cancel', post?: PublicCommunityPostSnapshot, commentId?: string) {
    const lease=session.capture(),current=()=>contextCurrent(lease)
    if (!current()) throw new Error('Acceptance context changed')
    if (lease!.isRunning()) throw new Error('Acceptance operation is already running')
    lease!.setRunning(true); setBusy(true)
    setView(previous => ({ ...previous, error: null }))
    let ctx: ReturnType<typeof context> | undefined
    try {
      ctx = context(lease)
      const { deployment, key, store, client, owner } = ctx
      // Capture the click before waiting for another tab's lock or any network.
      let intent: PublicCommunityAcceptIntent | undefined
      if (mode === 'accept') {
        if (loading || profileError) throw new Error('Reload your chain profile before accepting an answer')
        if (post?.id !== postId || post.postType !== 'question' || post.author.owner !== owner
          || post.registryId !== deployment.registryId || post.profileRegistryId !== deployment.profile.registryId || !commentId) {
          throw new Error('Read your question before accepting an answer')
        }
        intent = createPublicCommunityAcceptIntent({ deployment, owner, authorId: post.author.id, postId,
          expectedRevision: post.acceptanceRevision, commentId })
      }
      const result = await store.exclusive(key, async () => {
        if (!current()) throw new Error('Acceptance context changed')
        const previous = store.read(key)
        const leased = { ...store, exclusive: async <T,>(requested: string, work: () => Promise<T>) => {
          if (requested !== key) throw new Error('Acceptance recovery lock scope changed')
          return work()
        } }
        if (!intent) {
          if (!previous) throw new Error('No saved acceptance transaction')
          return runPublicCommunityAcceptOperation({ intent: previous.intent, store: leased, adapter: client.adapter,
            queryOnly: mode === 'query', cancelUnsigned: mode === 'cancel' })
        }
        if (previous && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(previous.phase)) {
          throw new Error('Recover the existing acceptance transaction first')
        }
        const prepared = await client.prepare(intent)
        if(!current())throw new Error('Acceptance context changed')
        return runPublicCommunityAcceptOperation({ intent, prepared, store: leased, adapter: client.adapter })
      })
      if (current()) {
        show(result)
        if (result.phase === 'SUCCEEDED' || result.phase === 'FAILED') {
          await queryClient.invalidateQueries({ predicate: query => query.queryKey[0] === 'community-chain-post'
            && query.queryKey[2] === postId && query.queryKey[3] === owner
            && JSON.stringify((query.queryKey[1] as { deployment?: unknown } | null)?.deployment) === JSON.stringify(deployment) })
        }
      }
      return result
    } catch (error) {
      if (error instanceof PublicCommunityAcceptPersistenceError) {
        const failed = error.record, previous = emergency.get(scope)
        emergency.set(scope, previous?.digest === failed.digest && previous.signature && !failed.signature ? previous : failed)
      }
      if (current()) {
        let saved = view.record
        if (ctx) { try { saved = ctx.store.read(ctx.key) } catch { /* Preserve existing recovery evidence. */ } }
        show(saved, error instanceof Error ? error.message : 'Acceptance failed')
      }
      throw error
    } finally {
      lease!.setRunning(false)
      if(current())setBusy(false)
    }
  }
  return { record:view.record,error:view.error,recoveryExport:view.recoveryExport,busy,
    accept: (post: PublicCommunityPostSnapshot, commentId: string) => run('accept', post, commentId),
    query: () => run('query'), resume: () => run('resume'), cancel: () => run('cancel') }
}
