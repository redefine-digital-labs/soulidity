'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toHex } from '@mysten/sui/utils'
import { getRequiredSoulidityEnv, SoulContentSlotPublicBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { getBrowserContentWriteConfig, readBrowserContentWriteState } from '@/lib/soulidity/browser-content-write-state'
import { assertContentMutationAuthority, observeContentMutation, contentMutationKey, createContentMutationAdapter, parseContentMutationPlan,
  parseContentMutationRecord, type ContentMutationPlan, type ContentMutationQuery, type ContentMutationRecord } from '@/lib/soulidity/content-mutation-transaction'
import { browserContentMutationStore, CONTENT_MUTATION_STORE_CHANGED } from '@/lib/soulidity/content-mutation-store'
import { runContentMutation } from '@/lib/soulidity/content-mutation-runner'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

function configKey() {
  try { return JSON.stringify([getBrowserContentWriteConfig(), getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')]) }
  catch { return 'unavailable' }
}
const idle = () => false
export function useSoulContentMutations(soul: ChainSoulDetail, onSuccess: () => void, blocked: () => boolean = idle) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const grpc = (client as unknown as { grpc: SuiGrpcClient }).grpc, { mutateAsync: sign } = useSignTransaction()
  const configuration = configKey(), scope = JSON.stringify([soul.originalPackageId, soul.onChainId, soul.stateOnChainId, soul.contentOnChainId, configuration])
  const session = useCommittedSession(scope, account, client, wallet)
  const generation = session.generation, active = useRef<AbortController | null>(null)
  const [pendingAction, setPendingAction] = useSessionState<ContentMutationPlan['action'] | 'recovery' | null>(session, null)
  const [error, setError] = useSessionState<string | null>(session, null), [status, setStatus] = useSessionState<string | null>(session, null)
  const [currentObservation, setCurrentObservation] = useSessionState<string | null>(session, null)
  const [records, setRecords] = useSessionState<ContentMutationRecord[]>(session, []), [history, setHistory] = useSessionState<ContentMutationRecord[]>(session, [])
  const matches = () => session.matches() && configKey() === configuration
  const refresh = useCallback(async () => {
    try {
      const store = browserContentMutationStore()
      const found = store.discover({ soulId: soul.onChainId, originalPackageId: soul.originalPackageId })
      const archived = found.flatMap(record => store.history(contentMutationKey(record.plan)))
      if (matches()) { setRecords(found); setHistory(archived) }
    } catch (e) {
      if (matches()) setError(e instanceof Error ? e.message : 'Recovery storage unavailable')
      throw e
    }
  }, [scope, generation])
  useEffect(() => {
    const changed = () => void refresh().catch(e => { if (matches()) setError(e instanceof Error ? e.message : 'Recovery storage unavailable') })
    changed(); window.addEventListener(CONTENT_MUTATION_STORE_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { active.current?.abort(); active.current = null
      window.removeEventListener(CONTENT_MUTATION_STORE_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [refresh])
  async function exclusive<T>(action: ContentMutationPlan['action'] | 'recovery', work: (signal: AbortSignal, guard: () => void) => Promise<T>, writes = true) {
    const lease = session.capture()
    const matches = () => lease?.matches() === true && configKey() === configuration
    const unavailable = !matches() || !grpc || writes && (!account || !wallet)
      ? 'Connect the preparing Sui wallet'
      : active.current || blocked() ? 'Another content action is pending' : null
    if (unavailable) {
      if (matches()) setError(unavailable)
      throw new Error(unavailable)
    }
    const controller = new AbortController(); active.current = controller; lease!.requests.add(controller)
    const guard = () => { controller.signal.throwIfAborted(); if (!matches()) throw new Error('Content wallet or deployment changed') }
    setPendingAction(action); setError(null); setStatus(null); setCurrentObservation(null)
    try { return await work(controller.signal, guard) }
    catch (e) { if (matches()) setError(e instanceof Error ? e.message : 'Content operation failed'); throw e }
    finally {
      lease!.requests.delete(controller)
      if (active.current === controller) active.current = null
      if (matches()) { setPendingAction(null); void refresh().catch(e => { if (matches()) setError(e instanceof Error ? e.message : 'Recovery storage unavailable') }) }
    }
  }
  function adapter(signal: AbortSignal, guard: () => void) {
    return createContentMutationAdapter({ client: grpc,
      getAddress: () => { try { guard(); return account?.address ?? null } catch { return null } },
      sign: async tx => { guard(); const result = await sign({ transaction: tx, account: account! }); guard(); return result },
      preflight: async plan => {
        guard(); const config = getBrowserContentWriteConfig(), d = plan.deployment
        if (config.target.soulidityOriginalPackageId !== d.originalPackageId || config.target.soulidityCallablePackageId !== d.callablePackageId
          || config.kindRegistryId !== d.kindRegistryId || getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID') !== d.marketConfigId)
          throw new Error('Recorded deployment changed; this transaction remains queryable')
        const proof = await readBrowserContentWriteState({ config, soulId: plan.soulId, stateId: plan.stateId, contentId: plan.contentId,
          viewerAddress: plan.author, kind: plan.kind, signal }, { client: () => grpc })
        guard(); assertContentMutationAuthority(plan, proof)
      } })
  }
  function report(record: ContentMutationRecord, result: ContentMutationQuery, guard: () => void) {
    guard()
    const text = result.status === 'SUCCEEDED' ? `Original ${record.plan.action} confirmed at checkpoint ${result.checkpoint}. Later content or ownership changes do not undo this receipt.`
      : result.status === 'FAILED' ? 'Original transaction failed on chain. Its receipt is retained.'
        : result.status === 'PENDING' ? 'Transaction observed; final checkpoint is pending. Query the same transaction.'
          : record.packet.phase === 'CANCELLED' ? 'Cancelled before this journal requested a signature. Public recovery bytes are retained.'
            : 'No finalized transaction found. This is not proof of failure; use the recorded recovery.'
    setStatus(text)
    if (result.status === 'SUCCEEDED') onSuccess()
  }
  async function mutate(action: ContentMutationPlan['action'], kind: number, target: ContentMutationPlan['target']) {
    target = structuredClone(target)
    return exclusive(action, async (signal, guard) => {
      guard(); const config = getBrowserContentWriteConfig(), author = account!.address
      const proof = await readBrowserContentWriteState({ config, soulId: soul.onChainId, stateId: soul.stateOnChainId,
        contentId: soul.contentOnChainId, viewerAddress: author, kind, signal }, { client: () => grpc })
      guard(); const s = proof.snapshot, active = s.activeBindings.find(row => row.kind === kind)
      const slot = target ? s.contentVersions.find(row => row.kind === kind && row.name === target.name && row.versionIndex === target.versionIndex)?.slot : null
      if (target && !slot) throw new Error('Content version is no longer available')
      const grant = s.currentOwner === author ? null : s.grants.find(row => row.slot.grantee === author && row.currentEpoch && row.unexpiredAtObservation
        && row.grant && slot && BigInt(slot.grant_scope_mask) > 0n
        && (BigInt(row.slot.scope_mask) & BigInt(slot.grant_scope_mask)) === BigInt(slot.grant_scope_mask))
      if (s.currentOwner !== author && (!grant || action !== 'delete')) throw new Error('Only the owner or a currently scoped delete grantee can perform this action')
      const plan = parseContentMutationPlan({ deployment: { chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)),
        originalPackageId: proof.originalPackageId, callablePackageId: proof.callablePackageId, kindRegistryId: proof.kindRegistryId,
        marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID') }, soulId: proof.soulId, stateId: proof.stateId,
        contentId: proof.contentId, author, ownershipEpoch: s.ownershipEpoch, kind, action, target,
        expectedActive: active ? { name: active.name, versionIndex: active.version_index } : null,
        grantId: grant?.slot.grant_id ?? null, expectedSlot: slot ? SoulContentSlotPublicBcs.serialize(slot).toBase64() : null })
      assertContentMutationAuthority(plan, proof)
      const result = await runContentMutation({ plan, store: browserContentMutationStore(), adapter: adapter(signal, guard), startNew: true })
      report(result.record, result, guard)
      // Existing purge modal closes only on proved success; uncertain execution
      // retains its error/retry affordance and the separate exact recovery row.
      if (result.status !== 'SUCCEEDED') throw new Error(`Content transaction ${result.status.toLowerCase()}; use its recovery controls`)
      return result
    })
  }
  const resume = (input: ContentMutationRecord) => exclusive(input.plan.action, async (signal, guard) => {
    const record = parseContentMutationRecord(input), store = browserContentMutationStore()
    const current = store.read(contentMutationKey(record.plan))
    if (!current || current.packet.digest !== record.packet.digest || current.packet.bytes !== record.packet.bytes) throw new Error('Recovery head changed; refresh before resuming')
    const result = await runContentMutation({ plan: record.plan, store, adapter: adapter(signal, guard),
      expectedPacket: { bytes: record.packet.bytes, digest: record.packet.digest } }); report(result.record, result, guard); return result
  })
  const query = (input: ContentMutationRecord) => exclusive('recovery', async (signal, guard) => {
    const record = parseContentMutationRecord(input), result = await adapter(signal, guard).query(record)
    report(record, result, guard)
    if (result.status === 'SUCCEEDED') {
      try {
        const config = getBrowserContentWriteConfig(), p = record.plan
        const proof = await readBrowserContentWriteState({ config, soulId: p.soulId, stateId: p.stateId, contentId: p.contentId,
          viewerAddress: p.author, kind: p.kind, signal }, { client: () => grpc })
        guard(); setCurrentObservation(`Current observation: ${observeContentMutation(p, proof)}. This does not change the original result.`)
      } catch {
        guard(); setCurrentObservation('Current observation: UNAVAILABLE. The original transaction remains confirmed.')
      }
    }
    return result
  }, false)
  const cancel = (input: ContentMutationRecord) => exclusive('recovery', async (signal, guard) => {
    const record = parseContentMutationRecord(input), store = browserContentMutationStore(), current = store.read(contentMutationKey(record.plan))
    if (!current || current.packet.digest !== record.packet.digest || current.packet.bytes !== record.packet.bytes) throw new Error('Recovery head changed; refresh before cancelling')
    const result = await runContentMutation({ plan: record.plan, store, adapter: adapter(signal, guard), cancelUnsigned: true,
      expectedPacket: { bytes: record.packet.bytes, digest: record.packet.digest } })
    report(result.record, result, guard); return result
  }, false)
  const exportRecord = (input: ContentMutationRecord) => {
    const record = parseContentMutationRecord(input), url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `soul-content-${record.packet.digest}.json`; link.click(); URL.revokeObjectURL(url)
  }
  return { mutate, resume, query, cancel, exportRecord, refresh, pendingAction, pending: pendingAction !== null, error, status, currentObservation, records, history,
    author: account?.address ?? null }
}
