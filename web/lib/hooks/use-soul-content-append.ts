'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { KIND_SKILL, KIND_SPRITE, READ_PUBLIC, getRequiredSoulidityEnv,
  extractSkillBundleMetadata, hasZipSignature, validateSoulUploadFile, validateSoulUploadSignature,
  type SoulDownloadPolicy } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'
import { inferSoulUploadContentType } from '@/lib/upload/content-type'
import { sha256Hex } from '@/lib/upload/client-seal'
import { getBrowserPrivateLoadoutUploadConfig } from '@/lib/animacraft/private-loadout-storage'
import { getBrowserContentSealConfig } from '@/lib/soulidity/browser-content-open'
import { getBrowserContentWriteConfig, readBrowserContentWriteState } from '@/lib/soulidity/browser-content-write-state'
import { prepareContentAppend, type ContentAppendPreparation, type ContentAppendPreparationScope } from '@/lib/soulidity/content-append-preparation'
import { browserContentAppendStore, contentAppendStoreKey, CONTENT_APPEND_STORE_CHANGED } from '@/lib/soulidity/content-append-store'
import { exportContentAppendRecovery, importContentAppendRecovery, type ContentAppendRecoveryBundle } from '@/lib/soulidity/content-append-recovery'
import { runContentAppend, parseContentAppendIntent, contentAppendWalrusIntent, assertContentAppendWalrusRecord, type ContentAppendIntent } from '@/lib/soulidity/content-append-operation'
import { queryContentAppendCompletion, queryLocalContentAppendCompletion, finishContentAppendCompletion,
  describeContentAppendCompletion } from '@/lib/soulidity/content-append-completion'
import { browserContentAppendRebaseStore } from '@/lib/soulidity/content-append-rebase-store'
import { prepareContentAppendRebase, contentAppendRebaseContinuation } from '@/lib/soulidity/content-append-rebase'
import { browserContentAppendRestoreStore } from '@/lib/soulidity/content-append-restore-store'
import { restoreContentAppend } from '@/lib/soulidity/content-append-restore'
import { readWalrusSingleRecord, walrusSingleKey } from '@/lib/upload/walrus-single-operation'

export interface AppendContentVersionParams {
  kind: number; name: string; file: File; uploadType: 'encrypted'
  slotReadModeMask: number; downloadPolicy: SoulDownloadPolicy; setActive?: boolean; spriteConfigJson?: string | null
}
function appendConfigurationKey() {
  try { return JSON.stringify([getBrowserContentWriteConfig(), getBrowserContentSealConfig(), getBrowserPrivateLoadoutUploadConfig(),
    getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')]) }
  catch (error) { return JSON.stringify({ unavailable: error instanceof Error ? error.message : 'Content configuration unavailable' }) }
}
export function useSoulContentAppend(soul: ChainSoulDetail, role: 'owner' | 'grantee' | 'visitor', blocked: boolean, onSuccess: () => void) {
  const account = useCurrentAccount(), { currentWallet: wallet } = useCurrentWallet(), client = useSuiClient()
  const grpc = (client as unknown as { grpc: SuiGrpcClient }).grpc
  const { mutateAsync: personal } = useSignPersonalMessage(), { mutateAsync: sign } = useSignTransaction()
  const { getAuthHeaders } = useAuth()
  const configurationKey = appendConfigurationKey()
  const scope = JSON.stringify([soul.originalPackageId, soul.onChainId, soul.stateOnChainId, soul.contentOnChainId,
    soul.currentOwnershipEpoch, role, configurationKey])
  const session = useCommittedSession(scope, account, client, wallet)
  const generation = session.generation
  const blockedRef = useRef(blocked)
  useLayoutEffect(() => { blockedRef.current = blocked }, [blocked])
  const active = useRef<AbortController | null>(null)
  const refreshSequence = useRef(0)
  const [pending, setPending] = useSessionState(session, false), [error, setError] = useSessionState<string | null>(session, null)
  const [recoveries, setRecoveries] = useSessionState<ContentAppendPreparation[]>(session, [])
  const [archivedRecoveries, setArchivedRecoveries] = useSessionState<ContentAppendPreparation[]>(session, [])
  const [notice, setNotice] = useSessionState<string | null>(session, null)
  const [queryStatus, setQueryStatus] = useSessionState<string | null>(session, null)
  const [importedRecovery, setImportedRecovery] = useSessionState<ContentAppendRecoveryBundle | null>(session, null)
  const [pendingRestores, setPendingRestores] = useSessionState<ContentAppendRecoveryBundle[]>(session, [])
  const matches = () => session.matches() && appendConfigurationKey() === configurationKey
  const refresh = useCallback(async () => {
    const lease = session.capture()
    const matches = () => lease?.matches() === true && appendConfigurationKey() === configurationKey
    if (!matches()) return
    const sequence = ++refreshSequence.current
    if (!account || !grpc) { setRecoveries([]); setArchivedRecoveries([]); setPendingRestores([]); return }
    const listScope = { originalPackageId: soul.originalPackageId, author: account.address, contentObjectId: soul.contentOnChainId }
    const store = browserContentAppendStore(grpc)
    try {
      const [found, archived, restoring] = await Promise.all([store.list(listScope), store.listArchived(listScope), browserContentAppendRestoreStore(grpc).list(listScope)])
      if ([...found, ...archived, ...restoring.map(b => b.record)].reduce((size, r) => size + r.ciphertext.length, 0) > 128 * 1024 * 1024)
        throw new Error('Content recovery list exceeds 128 MiB')
      if (matches() && sequence === refreshSequence.current) { setRecoveries(found); setArchivedRecoveries(archived); setPendingRestores(restoring) }
    } catch (error) { if (matches() && sequence === refreshSequence.current) throw error }
  }, [scope, account, wallet, client, generation])
  useEffect(() => {
    void refresh().catch(e => { if (matches()) setError(e instanceof Error ? e.message : 'Content recovery is unavailable') })
    return () => { active.current?.abort(); active.current = null }
  }, [scope, account, wallet, client, generation])
  useEffect(() => {
    const changed = () => { void refresh().catch(e => { if (matches()) setError(e instanceof Error ? e.message : 'Content recovery is unavailable') }) }
    window.addEventListener(CONTENT_APPEND_STORE_CHANGED, changed)
    return () => window.removeEventListener(CONTENT_APPEND_STORE_CHANGED, changed)
  }, [refresh])
  async function exclusive<T>(work: (controller: AbortController, guard: () => void) => Promise<T>, requiresWallet = true) {
    const lease = session.capture()
    const matches = () => lease?.matches() === true && appendConfigurationKey() === configurationKey
    if (!matches() || !grpc || requiresWallet && (!account || !wallet)) throw new Error('Connect the preparing Sui wallet')
    if (active.current || blockedRef.current) throw new Error('Another content action is pending')
    const controller = new AbortController(); active.current = controller; lease!.requests.add(controller)
    const guard = () => { controller.signal.throwIfAborted(); if (!matches()) throw new Error('Content wallet session changed') }
    setPending(true); setError(null)
    try { return await work(controller, guard) }
    catch (e) { if (matches()) setError(e instanceof Error ? e.message : 'Content append failed'); throw e }
    finally {
      lease!.requests.delete(controller)
      if (active.current === controller) active.current = null
      if (matches()) { setPending(false); void refresh().catch(e => { if (matches()) setError(e instanceof Error ? e.message : 'Content recovery is unavailable') }) }
    }
  }
  async function run(record: ContentAppendPreparation, controller: AbortController, guard: () => void, approved?: string) {
    guard()
    const config = getBrowserContentWriteConfig(), store = browserContentAppendStore(grpc)
    if (await browserContentAppendRestoreStore(grpc).read(contentAppendStoreKey(record.scope))) throw new Error('Finish restoring this upload before resuming or rebasing it')
    guard()
    const execution = { client: grpc, getAddress: () => { try { guard(); return account!.address } catch { return null } },
      beforeWrite: async () => {
        guard()
        if (approved !== undefined && JSON.stringify(readWalrusSingleRecord(walrusSingleKey(contentAppendWalrusIntent(record)))?.approved) !== approved)
          throw new Error('Recorded gas approval changed; review this upload again')
      },
      sign: async (tx: Parameters<typeof sign>[0]['transaction']) => { guard(); const value = await sign({ transaction: tx, account: account! }); guard(); return value } }
    const rebase = parseContentAppendIntent(record).rebase
      ? await contentAppendRebaseContinuation(record, execution, controller.signal) : null
    if (!rebase && await browserContentAppendRebaseStore(grpc).pending(record)) throw new Error('A rebase is already prepared. Use Rebase paid upload to finish that exact recovery; the previous attempt will not be resumed.')
    guard()
    const result = await runContentAppend({ record, config, signal: controller.signal,
      execution, ...(rebase ? { rebase } : {}),
      confirmQuote: async quote => {
        guard()
        const yes = window.confirm(`Approve encrypted content storage for ${record.scope.name} v${record.scope.versionIndex}?\n`
          + `Storage + write: ${(quote.walStorageCost + quote.walWriteCost).toString()} atomic WAL\n`
          + `Relay tip: ${quote.relayTipMist.toString()} MIST\nEstimated gas budget: ${quote.gasBudgetMist.toString()} MIST\n`
          + `${quote.storageEpochs} epoch(s). Register and certify + append are separate wallet transactions.`)
        guard(); return yes
      } })
    guard(); await store.archive(contentAppendStoreKey(record.scope), record); guard(); onSuccess(); return result.version
  }
  const resume = (record: ContentAppendPreparation) => exclusive(async (controller, guard) => {
    const store = browserContentAppendStore(grpc), key = contentAppendStoreKey(record.scope)
    return store.exclusive(key, async () => {
      guard(); const saved = await store.read(key); guard()
      if (!saved) throw new Error('Prepared content recovery is missing')
      if (await reportCompleted(saved, controller, guard)) return
      const payment = readWalrusSingleRecord(walrusSingleKey(contentAppendWalrusIntent(saved)))
      if (payment) assertContentAppendWalrusRecord(saved, payment)
      const approved = payment?.approved ? JSON.stringify(payment.approved) : undefined
      const gas = payment?.approved ? `\nRecorded certify gas budget: ${BigInt(payment.approved.gasBudget) / 2n} MIST (1 SUI = 1,000,000,000 MIST).` : '\nStorage costs require a separate approval if not previously approved.'
      if (!window.confirm(`Resume the recorded append of ${saved.scope.name} v${saved.scope.versionIndex}? Existing transaction outcomes will be checked first. This does not approve another storage payment.${gas}`)) return
      guard(); return run(saved, controller, guard, approved)
    })
  })
  const rebase = (record: ContentAppendPreparation) => exclusive(async (controller, guard) => {
    const store = browserContentAppendStore(grpc), key = contentAppendStoreKey(record.scope)
    return store.exclusive(key, async () => {
      guard(); const saved = await store.read(key); guard()
      if (!saved) throw new Error('Prepared content recovery is missing')
      if (await reportCompleted(saved, controller, guard)) return
      if (await browserContentAppendRestoreStore(grpc).read(key)) throw new Error('Finish restoring this upload before rebasing it')
      guard()
      const next = await prepareContentAppendRebase({ record: saved, config: getBrowserContentWriteConfig(), signal: controller.signal,
        execution: { client: grpc, getAddress: () => { try { guard(); return account!.address } catch { return null } },
          sign: async () => { throw new Error('Rebase preparation cannot sign a chain transaction') } },
        wallet: { client: grpc, sealClient: client as never, signal: controller.signal,
          getAddress: () => { try { guard(); return account!.address } catch { return null } },
          signPersonalMessage: async message => { guard(); const value = await personal({ message, account: account! }); guard(); return value.signature } },
        approveGas: async request => {
          guard()
          const value = window.prompt(`${request.alreadyPrepared ? 'Finish the prepared recovery' : 'Rebase the paid upload'} from v${request.previousVersion} to v${request.nextVersion}?\n`
            + `Reuse Blob ${request.blobObjectId}; ${request.remainingWalrusEpochs} storage epoch(s) remain. No new storage registration or storage charge.\n`
            + `${request.alreadyPrepared ? 'Keep the previously approved gas budget.' : 'Unlock your encrypted recovery and sign a new preparation, then certify + append in one transaction.'}\n`
            + 'Approve the certify transaction gas budget in MIST (1 SUI = 1,000,000,000 MIST):', request.suggestedGasBudgetMist)
          guard(); return value
        } })
      guard(); if (!next) return
      return run(next, controller, guard)
    })
  })
  async function reportCompleted(record: ContentAppendPreparation, controller: AbortController, guard: () => void) {
    const result = await queryLocalContentAppendCompletion({ record, client: grpc, signal: controller.signal }); guard()
    if (!result.completed) return false
    setQueryStatus(`${describeContentAppendCompletion(result)} Use Finish completed upload to archive this local recovery.`)
    return true
  }
  const query = (record: ContentAppendPreparation) => exclusive(async (controller, guard) => {
    const result = await queryLocalContentAppendCompletion({ record, client: grpc, signal: controller.signal })
    guard(); setQueryStatus(describeContentAppendCompletion(result))
    return result
  }, false)
  const queryImported = (bundle: ContentAppendRecoveryBundle) => exclusive(async (controller, guard) => {
    const result = await queryContentAppendCompletion({ bundle, client: grpc, signal: controller.signal })
    guard(); setQueryStatus(describeContentAppendCompletion(result)); return result
  }, false)
  const finish = (record: ContentAppendPreparation) => exclusive(async (controller, guard) => {
    guard()
    const result = await finishContentAppendCompletion({ record, client: grpc, signal: controller.signal,
      getAddress: () => { try { guard(); return account!.address } catch { return null } } })
    guard(); setQueryStatus(`${describeContentAppendCompletion(result)} Local recovery archived; encrypted records and transaction history remain available below.`)
    onSuccess(); return result
  })
  const append = (input: AppendContentVersionParams) => exclusive(async (controller, guard) => {
    const params = { ...input }, file = params.file
    if (!['owner', 'grantee'].includes(role) || params.uploadType !== 'encrypted') throw new Error('Encrypted content append requires owner or scoped grantee authority')
    const config = getBrowserContentWriteConfig(), sealConfig = getBrowserContentSealConfig()
    const contentType = inferSoulUploadContentType(file, 'encrypted')
    const normalized = file.type === contentType ? file : new File([file], file.name, { type: contentType })
    const validation = validateSoulUploadFile(normalized, 'encrypted'); if (validation) throw new Error(validation)
    const plaintext = new Uint8Array(await normalized.arrayBuffer())
    try {
      guard()
      const invalid = validateSoulUploadSignature(plaintext, 'encrypted', contentType); if (invalid) throw new Error(invalid)
      let name = params.name
      if (params.kind === KIND_SKILL) {
        if (!hasZipSignature(plaintext)) throw new Error('Skill bundle must be a .zip archive')
        name = extractSkillBundleMetadata(plaintext).skillName
      }
      const observed = await readBrowserContentWriteState({ config, soulId: soul.onChainId, stateId: soul.stateOnChainId,
        contentId: soul.contentOnChainId, kind: params.kind, viewerAddress: account!.address, signal: controller.signal }, { client: () => grpc }); guard()
      const state = observed.snapshot, versions = state.contentVersions.filter(v => v.kind === params.kind && v.name === name)
      const expectedVersionIndex = String(versions.length)
      const descriptor = state.kindDescriptors.find(d => d.kind === params.kind)
      if (!descriptor || descriptor.deprecated || (BigInt(descriptor.op_mask) & 1n) === 0n) throw new Error('This content kind does not allow append')
      const grant = role === 'grantee' ? state.grants.find(g => g.slot.grantee === account!.address && g.currentEpoch && g.unexpiredAtObservation
        && (BigInt(g.slot.scope_mask) & BigInt(descriptor.default_grant_scope_mask)) === BigInt(descriptor.default_grant_scope_mask)) : null
      if (role === 'owner' ? state.currentOwner !== account!.address : !grant?.grant) throw new Error('Current owner or grant authority is unavailable')
      let autoGrantPlan: ContentAppendIntent['autoGrantPlan'] = null
      // Account-agent association remains a separate retained-feature cutover.
      // Preserve its original best-effort discovery while never trusting its
      // mirror masks: merge each returned address against this raw chain read.
      if (role === 'owner' && (params.slotReadModeMask & READ_PUBLIC) === 0 && BigInt(descriptor.default_grant_scope_mask) > 0n) {
        try {
          const headers = await getAuthHeaders(); guard()
          const response = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/auto-grant-targets?scopeMask=${descriptor.default_grant_scope_mask}`, { headers, signal: controller.signal })
          if (!response.ok) throw new Error('Account agent discovery unavailable')
          const body = await response.json(); guard()
          if (!Array.isArray(body.targets)) throw new Error('Account agent discovery invalid')
          const scopeMask = Number(descriptor.default_grant_scope_mask), seen = new Set<string>()
          const targets = body.targets.map((target: { address: string }) => {
            if (!/^0x[0-9a-f]{64}$/.test(target.address) || seen.has(target.address)) throw new Error('Account agent address invalid')
            seen.add(target.address)
            const current = state.grants.find(g => g.currentEpoch && g.unexpiredAtObservation && g.slot.grantee === target.address)
            return { address: target.address, scopeMask: Number(current?.slot.scope_mask ?? 0) | scopeMask }
          })
          if (targets.length) {
            const fresh = targets.filter((t: { address: string }) => !state.grants.some(g => g.currentEpoch && g.slot.grantee === t.address)).length
            const required = BigInt(state.activeGrantCount) + BigInt(fresh)
            autoGrantPlan = { capacityBefore: state.grantCapacity,
              capacityAfter: String(required > BigInt(state.grantCapacity) ? required : BigInt(state.grantCapacity)), targets }
          }
        } catch (e) { guard(); setNotice('Automatic account-agent grants are unavailable. This upload can continue; existing grants are preserved.') }
      }
      const intent: ContentAppendIntent = { schema: 'soulidity.content-append-intent.v1', soulId: soul.onChainId, stateId: soul.stateOnChainId,
        kindRegistryId: config.kindRegistryId, marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
        ownershipEpoch: state.ownershipEpoch, grantId: grant?.slot.grant_id ?? null, readModeMask: params.slotReadModeMask,
        downloadPolicy: params.downloadPolicy, spriteConfigJson: role === 'owner' && params.kind === KIND_SPRITE ? params.spriteConfigJson ?? null : null,
        setActive: role === 'owner' && params.kind === KIND_SPRITE && (Boolean(params.setActive) || !state.activeBindings.some(b => b.kind === KIND_SPRITE)),
        autoGrantPlan, contentHash: await sha256Hex(plaintext), plaintextByteLength: plaintext.length, fileName: normalized.name,
        mimeType: contentType, uploadConfig: getBrowserPrivateLoadoutUploadConfig(), rebase: null }
      const preparationScope: ContentAppendPreparationScope = { author: account!.address, originalPackageId: observed.originalPackageId,
        callablePackageId: observed.callablePackageId, contentObjectId: soul.contentOnChainId, kind: params.kind, name,
        versionIndex: expectedVersionIndex, intentJson: JSON.stringify(intent) }
      guard(); const store = browserContentAppendStore(grpc), key = contentAppendStoreKey(preparationScope)
      return await store.exclusive(key, async () => {
        guard(); let record = await store.read(key); guard()
        if (await browserContentAppendRestoreStore(grpc).read(key)) throw new Error('Finish restoring this upload before preparing another')
        guard()
        if (record && JSON.stringify(record.scope) !== JSON.stringify(preparationScope)) throw new Error('An unresolved append exists for this slot. Use its recovery controls before preparing another.')
        if (!record) {
          if (!window.confirm('Prepare this encrypted content upload? First sign a recovery-preparation message (no payment), then review storage costs and the two chain transactions.')) return
          record = await prepareContentAppend({ scope: preparationScope, sealConfig, plaintext, fileName: normalized.name, mimeType: contentType,
            wallet: { client: grpc, sealClient: client as never, signal: controller.signal,
              getAddress: () => { try { guard(); return account!.address } catch { return null } },
              signPersonalMessage: async message => { guard(); const value = await personal({ message, account: account! }); guard(); return value.signature } } })
          guard(); await store.create(key, record); guard(); await refresh(); guard()
        }
        return run(record, controller, guard)
      })
    } finally { plaintext.fill(0) }
  })
  const exportRecovery = (record: ContentAppendPreparation) => exclusive(async (_controller, guard) => {
    const data = await exportContentAppendRecovery(record, grpc); guard()
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'soul-content-encrypted-recovery.json'
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, false)
  const importRecovery = (file: File) => exclusive(async (_controller, guard) => {
    if (file.size > 100 * 1024 * 1024) throw new Error('Content recovery file exceeds 100 MiB')
    const text = await file.text(); guard()
    const bundle = await importContentAppendRecovery(text, grpc); guard()
    if (bundle.record.scope.originalPackageId !== soul.originalPackageId || bundle.record.scope.contentObjectId !== soul.contentOnChainId) {
      throw new Error('This recovery belongs to a different Soul or release')
    }
    setImportedRecovery(bundle)
    setQueryStatus('Encrypted recovery verified. It has not replaced any local record or authorized payment. Use Check imported transaction to query its original packets.')
  }, false)
  const restore = (input: ContentAppendRecoveryBundle) => exclusive(async (controller, guard) => {
    const bundle = structuredClone(input)
    if (bundle.record.scope.originalPackageId !== soul.originalPackageId || bundle.record.scope.contentObjectId !== soul.contentOnChainId)
      throw new Error('This recovery belongs to a different Soul or release')
    if (bundle.record.scope.author !== account!.address) throw new Error('Connect the original preparing wallet to restore this recovery')
    guard()
    if (!window.confirm(`Restore the encrypted recovery for ${bundle.record.scope.name} to this device? This checks recorded transactions and saves local recovery records only. No unlock, signature, upload or payment. Resume or Rebase is a separate action.`)) return
    guard()
    await restoreContentAppend({ bundle, client: grpc, signal: controller.signal,
      getAddress: () => { try { guard(); return account!.address } catch { return null } } })
    guard(); setImportedRecovery(null)
    setQueryStatus('Encrypted recovery restored to this device. No transaction was signed or sent. Use Resume for the recorded attempt, or Rebase if its version or gas is stale.')
  })
  return { append, resume, rebase, restore, query, queryImported, finish, exportRecovery, importRecovery, importedRecovery,
    pendingRestores, recoveries, archivedRecoveries, pending, error, notice, queryStatus, refresh }
}
