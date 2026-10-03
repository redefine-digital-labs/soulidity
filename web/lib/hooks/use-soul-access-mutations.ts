'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toHex } from '@mysten/sui/utils'
import { getRequiredSoulidityEnv, readSoulPublicSnapshotBySoulId } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { getBrowserContentWriteConfig, readBrowserContentWriteState } from '@/lib/soulidity/browser-content-write-state'
import { createSoulAccessAdapter, parseSoulAccessRecord } from '@/lib/soulidity/soul-access-operation'
import { prepareSoulAccessPlan, readSoulAccessState } from '@/lib/soulidity/soul-access-state'
import { observeSoulAccessPlan, parseSoulAccessDeployment, parseSoulAccessPlan, soulAccessKey,
  type SoulAccessPlan, type SoulAccessRecord, type SoulAccessRequest, type SoulAccessQuery } from '@/lib/soulidity/soul-access-plan'
import { browserSoulAccessStore, SOUL_ACCESS_STORE_CHANGED } from '@/lib/soulidity/soul-access-store'
import { runSoulAccess } from '@/lib/soulidity/soul-access-runner'
import { publicMutationCanonical } from '@/lib/sui/public-mutation-journal'

export interface SoulAccessSubject {
  onChainId: string; stateOnChainId: string; originalPackageId?: string
  contentOnChainId?: string | null; paidAccessListOnChainId?: string | null
}
function configuration() {
  const config = getBrowserContentWriteConfig()
  const deployment = parseSoulAccessDeployment({
    chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)),
    originalPackageId: config.target.soulidityOriginalPackageId, callablePackageId: config.target.soulidityCallablePackageId,
    kindRegistryId: config.kindRegistryId, marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
    paymentCoinType: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE'),
  })
  return { config, deployment }
}
function configKey() { try { return JSON.stringify(configuration()) } catch { return 'unavailable' } }
const noop = () => {}

/** Quote preparation is read-only. Only explicit execute/resume can request a
 * wallet signature; discovery/query/export never adopt a different packet. */
export function useSoulAccessMutations(soul: SoulAccessSubject | null, onSuccess: () => void = noop) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const grpc = (client as unknown as { grpc: SuiGrpcClient }).grpc, { mutateAsync: sign } = useSignTransaction()
  const configIdentity = configKey(), scope = JSON.stringify([soul?.onChainId, soul?.stateOnChainId, soul?.originalPackageId,
    soul?.contentOnChainId, soul?.paidAccessListOnChainId, configIdentity])
  const session = useCommittedSession(scope, account, client, wallet)
  const generation = session.generation, active = useRef<AbortController | null>(null)
  const [pendingAction, setPendingAction] = useSessionState<SoulAccessRequest['action'] | 'recovery' | null>(session, null)
  const [error, setError] = useSessionState<string | null>(session, null), [status, setStatus] = useSessionState<string | null>(session, null)
  const [currentObservation, setCurrentObservation] = useSessionState<string | null>(session, null)
  const [records, setRecords] = useSessionState<SoulAccessRecord[]>(session, []), [history, setHistory] = useSessionState<SoulAccessRecord[]>(session, [])
  const matches = () => session.matches() && configKey() === configIdentity
  const refresh = useCallback(async () => {
    if (!soul) return
    try {
      const originalPackageId = soul.originalPackageId ?? configuration().deployment.originalPackageId
      const store = browserSoulAccessStore(), found = store.discover({ soulId: soul.onChainId, originalPackageId })
      const archived = found.flatMap(record => store.history(soulAccessKey(record.plan)))
      if (matches()) { setRecords(found); setHistory(archived) }
    } catch (e) { if (matches()) setError(e instanceof Error ? e.message : 'Recovery storage unavailable'); throw e }
  }, [scope, generation])
  useEffect(() => {
    const changed = () => void refresh().catch(() => {})
    changed(); window.addEventListener(SOUL_ACCESS_STORE_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { active.current?.abort(); active.current = null
      window.removeEventListener(SOUL_ACCESS_STORE_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [refresh])
  async function exclusive<T>(action: SoulAccessRequest['action'] | 'recovery', work: (signal: AbortSignal, guard: () => void) => Promise<T>, writes = true) {
    const lease = session.capture()
    const matches = () => lease?.matches() === true && configKey() === configIdentity
    if (!soul || !matches() || !grpc || writes && (!account || !wallet)) throw new Error('Connect the preparing Sui wallet and load the Soul')
    if (active.current) throw new Error('Another access operation is pending')
    const controller = new AbortController(); active.current = controller; lease!.requests.add(controller)
    const guard = () => { controller.signal.throwIfAborted(); if (!matches()) throw new Error('Access wallet or deployment changed') }
    setPendingAction(action); setError(null); setStatus(null); setCurrentObservation(null)
    try { return await work(controller.signal, guard) }
    catch (e) { if (matches()) setError(e instanceof Error ? e.message : 'Access operation failed'); throw e }
    finally { lease!.requests.delete(controller); if (active.current === controller) active.current = null
      if (matches()) { setPendingAction(null); void refresh().catch(() => {}) } }
  }
  async function attest(plan: SoulAccessPlan, signal: AbortSignal, guard: () => void) {
    guard(); const { config, deployment } = configuration()
    if (publicMutationCanonical(deployment) !== publicMutationCanonical(plan.deployment)) throw new Error('Recorded deployment changed; query the original transaction')
    const proof = await readBrowserContentWriteState({ config, soulId: plan.soulId, stateId: plan.stateId, contentId: plan.contentId,
      viewerAddress: plan.author, ...(plan.kind === null ? {} : { kind: plan.kind }), signal }, { client: () => grpc })
    guard(); if (proof.snapshot.paidAccessListId !== plan.paidAccessListId) throw new Error('Soul paid-access root changed')
  }
  function adapter(signal: AbortSignal, guard: () => void) {
    return createSoulAccessAdapter({ client: grpc,
      getAddress: () => { try { guard(); return account?.address ?? null } catch { return null } },
      sign: async tx => { guard(); const result = await sign({ transaction: tx, account: account! }); guard(); return result },
      preflight: plan => attest(plan, signal, guard) })
  }
  function report(record: SoulAccessRecord, result: SoulAccessQuery, guard: () => void) {
    guard()
    setStatus(result.status === 'SUCCEEDED' ? `Original ${record.plan.action} confirmed at checkpoint ${result.checkpoint}. Its receipt is retained.`
      : result.status === 'FAILED' ? 'Original transaction failed on chain. Its receipt is retained.'
        : result.status === 'PENDING' ? 'Final checkpoint pending. Query the same transaction.'
          : record.packet.phase === 'CANCELLED' ? 'Cancelled before this journal requested a signature. Public bytes are retained.'
            : 'No finalized result found. This is not proof of failure; use the recorded recovery.')
    if (result.status === 'SUCCEEDED') onSuccess()
  }
  async function prepareInside(request: SoulAccessRequest, signal: AbortSignal, guard: () => void) {
    guard(); const { config, deployment } = configuration(), subject = soul!, author = account!.address
    if (subject.originalPackageId && subject.originalPackageId !== deployment.originalPackageId) throw new Error('Soul deployment changed')
    const asset = await readSoulPublicSnapshotBySoulId({ client: grpc, deployment: {
      originalPackageId: deployment.originalPackageId, chainIdentifier: deployment.chainIdentifier }, soulId: subject.onChainId, signal })
    guard(); if (asset.stateId !== subject.stateOnChainId || subject.contentOnChainId && asset.contentId !== subject.contentOnChainId)
      throw new Error('Soul roots changed')
    const proof = await readBrowserContentWriteState({ config, soulId: subject.onChainId, stateId: asset.stateId, contentId: asset.contentId,
      viewerAddress: author, kind: request.kind, signal }, { client: () => grpc })
    guard(); const paidAccessListId = proof.snapshot.paidAccessListId
    if (subject.paidAccessListOnChainId && subject.paidAccessListOnChainId !== paidAccessListId) throw new Error('Paid-access root changed')
    const plan = await prepareSoulAccessPlan({ client: grpc, deployment, soulId: subject.onChainId, stateId: asset.stateId,
      contentId: asset.contentId, paidAccessListId, author, request, signal })
    guard(); return plan
  }
  const prepare = (request: SoulAccessRequest) => {
    const frozen = structuredClone(request)
    return exclusive(request.action, (signal, guard) => prepareInside(frozen, signal, guard))
  }
  async function executeInside(input: SoulAccessPlan, signal: AbortSignal, guard: () => void) {
    const plan = parseSoulAccessPlan(input)
    if (plan.soulId !== soul?.onChainId || plan.stateId !== soul.stateOnChainId || plan.author !== account?.address) throw new Error('Prepared quote scope changed')
    const result = await runSoulAccess({ plan, store: browserSoulAccessStore(), adapter: adapter(signal, guard), startNew: true })
    report(result.record, result, guard)
    if (result.status !== 'SUCCEEDED') throw new Error(`Access transaction ${result.status.toLowerCase()}; use its recovery controls`)
    return result
  }
  const execute = (input: SoulAccessPlan) => {
    const plan = parseSoulAccessPlan(input)
    return exclusive(plan.action, (signal, guard) => executeInside(plan, signal, guard))
  }
  const mutate = (request: SoulAccessRequest) => {
    const frozen = structuredClone(request)
    if (frozen.action === 'paid-purchase') throw new Error('Prepare and explicitly confirm the paid-access quote first')
    return exclusive(frozen.action, async (signal, guard) => executeInside(await prepareInside(frozen, signal, guard), signal, guard))
  }
  const recover = (input: SoulAccessRecord, cancelUnsigned: boolean) => {
    const record = parseSoulAccessRecord(input)
    return exclusive('recovery', async (signal, guard) => {
      if (record.plan.soulId !== soul?.onChainId) throw new Error('Recovery Soul changed')
      const result = await runSoulAccess({ plan: record.plan, store: browserSoulAccessStore(), adapter: adapter(signal, guard), cancelUnsigned,
        expectedPacket: { bytes: record.packet.bytes, digest: record.packet.digest } })
      report(result.record, result, guard); return result
    }, !cancelUnsigned)
  }
  const query = (input: SoulAccessRecord) => {
    const record = parseSoulAccessRecord(input)
    return exclusive('recovery', async (signal, guard) => {
      const result = await adapter(signal, guard).query(record); report(record, result, guard)
      if (result.status === 'SUCCEEDED') {
        try {
          const p = record.plan, observed = await readSoulAccessState({ client: grpc, ...p, kind: p.kind ?? undefined,
            granteeAddress: p.granteeAddress ?? undefined, signal })
          guard(); setCurrentObservation(`Current observation: ${observeSoulAccessPlan(p, observed).status}. This does not change the original result.`)
        } catch { guard(); setCurrentObservation('Current observation: UNAVAILABLE. The original transaction remains confirmed.') }
      }
      return result
    }, false)
  }
  const exportRecord = (input: SoulAccessRecord) => {
    const record = parseSoulAccessRecord(input), url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `soul-access-${record.packet.digest}.json`; link.click(); URL.revokeObjectURL(url)
  }
  return { prepare, execute, mutate, resume: (record: SoulAccessRecord) => recover(record, false), cancel: (record: SoulAccessRecord) => recover(record, true),
    query, exportRecord, refresh, records, history, pendingAction, pending: pendingAction !== null, error, status, currentObservation,
    author: account?.address ?? null, identityKey: `${generation}:${scope}` }
}
