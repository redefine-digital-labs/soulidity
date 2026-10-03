'use client'

import { useEffect, useRef, useState } from 'react'
import { createPublicCommentDocument, createPublicPostDocument, createPublicCommunityPublishIntent,
  publicCommunityPublishOperationKey, PublicCommunityPublishPersistenceError,
  type PublicCommunityPublishIntent, type PublicCommunityPublishOperation } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import { createBrowserCommunityPublishController } from '@/lib/community/publish-browser-controller'
import { getBrowserCommunityPublishReadConfig, getBrowserCommunityPublishWritesEnabled } from '@/lib/community/publish-config'
import { CommunityJournalPersistenceError, type CommunityPublishJournal } from '@/lib/community/publish-journal'
import { browserPublicCommunityPublishOperationStore } from '@/lib/community/publish-operation-client'
import type { readCommunityPublicationResult } from '@/lib/community/publish-receipt'
import { useWalletSign } from './use-wallet-sign'

export type CommunityPublishTarget = { kind: 'post' } | { kind: 'comment'; postId: string }
export interface CommunityPublishPayload { title?: string; content: string; tags?: string[]; postType?: 0 | 1 | 2; channel?: 0 | 1 }
type PublicationResult = Awaited<ReturnType<typeof readCommunityPublicationResult>>
type Emergency = { journal: CommunityPublishJournal | null; operation: PublicCommunityPublishOperation | null }
function configuration() {
  try { return { config: structuredClone(getBrowserCommunityPublishReadConfig()), error: null } }
  catch (error) { return { config: null, error: error instanceof Error ? error : new Error('Publication configuration unavailable') } }
}

/** Inspection only reads the active lane. Explicit publish is the sole source of
 * operation IDs; all recovery actions execute the persisted frozen intent. */
export function useCommunityPublish(target: CommunityPublishTarget) {
  const { walletAddress, profile, loading, profileError } = useAuth()
  const { suiGrpcClient, getWalletAddress, signTransaction } = useWalletSign()
  const { requestUploadCostApproval } = useUploadCostReview()
  const rendered = configuration()
  const scope = JSON.stringify([rendered.config, walletAddress, target.kind, target.kind === 'comment' ? target.postId : null])
  const identity = useRef({ scope, generation: 0 })
  if (identity.current.scope !== scope) identity.current = { scope, generation: identity.current.generation + 1 }
  const token = identity.current
  const mounted = useRef(true), running = useRef(false), revision = useRef(0)
  const emergency = useRef(new Map<string, Emergency>())
  const [view, setView] = useState<{ scope: string; busy: boolean; error: string | null; pending: CommunityPublishJournal | null;
    recoveryExport: string | null; result: PublicationResult | null }>({ scope, busy: false, error: null, pending: null, recoveryExport: null, result: null })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = () => {
    if (!mounted.current || identity.current !== token) return false
    if (!rendered.config) return true
    try { return JSON.stringify(getBrowserCommunityPublishReadConfig()) === JSON.stringify(rendered.config) }
    catch { return false }
  }
  function context() {
    if (!current()) throw new Error('Publication context changed')
    if (!walletAddress) throw new Error('Connect your profile wallet')
    if (!rendered.config) throw rendered.error
    const config = rendered.config
    function sameRelease() { return JSON.stringify(getBrowserCommunityPublishReadConfig()) === JSON.stringify(config) }
    if (!sameRelease()) throw new Error('Publication release changed')
    const controller = createBrowserCommunityPublishController({ client: suiGrpcClient, config,
      writesEnabled: () => current() && sameRelease() && getWalletAddress() === walletAddress && getBrowserCommunityPublishWritesEnabled(),
      getAddress: () => current() && sameRelease() ? getWalletAddress() : null,
      sign: signTransaction,
      confirmQuote: async quote => current() && sameRelease() && await requestUploadCostApproval(quote) && current() && sameRelease(),
    })
    function intent(payload: CommunityPublishPayload, operationId: string, authorId: string) {
      const common = { deployment: config.deployment, owner: walletAddress!, authorId, operationId }
      return createPublicCommunityPublishIntent(target.kind === 'post'
        ? { ...common, kind: 'post', postType: payload.postType ?? 0, channel: payload.channel ?? 0,
          document: createPublicPostDocument({ title: payload.title, content: payload.content, tags: payload.tags }) }
        : { ...common, kind: 'comment', postId: target.postId, document: createPublicCommentDocument(payload.content) })
    }
    // Valid lookup-only values: author/document/operation ID are not lane keys.
    const lookup = intent({ title: 'Lookup', content: 'Lookup' }, '0'.repeat(32), walletAddress)
    return { controller, intent, lookup, operations: browserPublicCommunityPublishOperationStore() }
  }
  function exported(journal: CommunityPublishJournal | null, operation: PublicCommunityPublishOperation | null) {
    const saved = emergency.current.get(scope) ?? null
    return journal || operation || saved ? JSON.stringify({ schema: 'soulidity.community-publish-recovery.v1', journal, operation, emergency: saved }, null, 2) : null
  }
  async function snapshot(ctx: ReturnType<typeof context>, frozen?: PublicCommunityPublishIntent) {
    const journal = await ctx.controller.inspect(ctx.lookup)
    const intent = journal?.intent ?? frozen ?? emergency.current.get(scope)?.operation?.intent ?? emergency.current.get(scope)?.journal?.intent
    const operation = intent ? ctx.operations.read(publicCommunityPublishOperationKey(intent)) : null
    return { pending: journal, recoveryExport: exported(journal, operation) }
  }
  useEffect(() => {
    const version = ++revision.current
    setView({ scope, busy: false, error: null, pending: null, result: null, recoveryExport: exported(null, null) })
    if (walletAddress) void (async () => {
      try {
        const state = await snapshot(context())
        if (current() && revision.current === version) setView(value => ({ ...value, ...state }))
      } catch (failure) {
        if (current() && revision.current === version) setView(value => ({ ...value, error: failure instanceof Error ? failure.message : 'Publication recovery unavailable' }))
      }
    })()
    // No paid work, UUID or draft is created on navigation or wallet connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  async function run(mode: 'start' | 'query' | 'resume' | 'cancel' | 'archive', payload?: CommunityPublishPayload) {
    if (!current()) throw new Error('Publication context changed')
    if (running.current) throw new Error('Publication operation is already running')
    running.current = true; revision.current++
    setView(value => ({ ...value, scope, busy: true, error: null, result: mode === 'start' ? null : value.result }))
    let ctx: ReturnType<typeof context> | undefined, frozen: PublicCommunityPublishIntent | undefined
    try {
      ctx = context()
      // Freeze the submitted document before the first asynchronous boundary.
      if (mode === 'start') {
        if (loading || profileError || !profile || profile.owner !== walletAddress) throw new Error('Read your registered chain profile before publishing')
        frozen = ctx.intent(payload!, crypto.randomUUID().replaceAll('-', ''), profile.id)
      }
      const previous = await ctx.controller.inspect(ctx.lookup)
      if (!current()) throw new Error('Publication context changed')
      if (mode === 'start' && (previous || emergency.current.has(scope))) throw new Error('Recover the existing publication first')
      if (mode !== 'start') frozen = previous?.intent
      if (!frozen) throw new Error('No saved publication')
      const outcome = await ctx.controller.run({ intent: frozen, mode })
      if (outcome.status === 'published' && current()) setView(value => ({ ...value, result: outcome.result }))
      if (outcome.status === 'published' || outcome.status === 'archived') emergency.current.delete(scope)
      const state = await snapshot(ctx, frozen)
      if (current()) setView(value => ({ ...value, ...state, result: outcome.status === 'published' ? outcome.result : value.result }))
      return outcome
    } catch (failure) {
      const saved = emergency.current.get(scope) ?? { journal: null, operation: null }
      if (failure instanceof CommunityJournalPersistenceError) {
        const next = failure.record
        saved.journal = saved.journal?.receipt && !next.receipt ? saved.journal : next
        emergency.current.set(scope, saved)
      }
      if (failure instanceof PublicCommunityPublishPersistenceError) {
        const next = failure.record
        saved.operation = saved.operation?.digest === next.digest && saved.operation.signature && !next.signature ? saved.operation : next
        emergency.current.set(scope, saved)
      }
      let state: Awaited<ReturnType<typeof snapshot>> | undefined
      if (ctx) { try { state = await snapshot(ctx, frozen) } catch { /* Emergency records survive storage failure. */ } }
      if (current()) setView(value => ({ ...value, ...state,
        recoveryExport: state?.recoveryExport ?? exported(value.pending, null) ?? value.recoveryExport,
        error: failure instanceof Error ? failure.message : 'Publication failed' }))
      throw failure
    } finally {
      running.current = false
      if (current()) setView(value => ({ ...value, busy: false }))
    }
  }
  const visible = view.scope === scope ? view : { busy: false, error: null, pending: null, recoveryExport: null, result: null }
  return { busy: visible.busy, error: visible.error, pending: visible.pending, recoveryExport: visible.recoveryExport, result: visible.result,
    publish: (payload: CommunityPublishPayload) => run('start', payload), query: () => run('query'), resume: () => run('resume'),
    cancel: () => run('cancel'), archive: () => run('archive') }
}
