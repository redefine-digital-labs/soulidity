'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { toHex } from '@mysten/sui/utils'
import { NAMED_LOADOUT_LIMIT, captureNamedLoadout, type NamedLoadout, type NamedLoadoutSummary } from '@/lib/animacraft/named-loadout'
import { privateLoadoutCanonical, privateLoadoutCheck as check, privateLoadoutSummary, type PrivateLoadoutCapture, type PrivateLoadoutScope } from '@/lib/animacraft/private-loadout-library'
import { getBrowserPrivateLoadoutConfig, readBrowserPrivateLoadoutHead, unlockBrowserPrivateLoadout,
  encryptBrowserPrivateLoadout, decryptBrowserPrivateLoadoutCiphertext } from '@/lib/animacraft/browser-private-loadout'
import { getBrowserPrivateLoadoutUploadConfig, uploadPrivateLoadoutCiphertext, recoverPrivateLoadoutStorage, queryPrivateLoadoutStorageRecord,
  type DurableWalrusBlobResult } from '@/lib/animacraft/private-loadout-storage'
import { browserPrivateLoadoutRecoveryStore, exportPrivateLoadoutRecovery, importPrivateLoadoutRecovery,
  parsePrivateLoadoutRecoveryExport, privateLoadoutRecoveryKey, privateLoadoutStorageScope, type PrivateLoadoutRecovery } from '@/lib/animacraft/private-loadout-recovery'
import { parsePrivateLoadoutHistoricalExport, queryPrivateLoadoutHistory } from '@/lib/animacraft/private-loadout-history'
import { createPrivateLoadoutController, type PrivateLoadoutControllerResult } from '@/lib/animacraft/private-loadout-controller'
import { createPrivateLoadoutTransactionAdapter } from '@/lib/animacraft/private-loadout-transaction'
import { readBrowserNativeEquipment } from '@/lib/animacraft/browser-native-equipment'
import type { EquipmentSnapshot } from '@/lib/animacraft/equipment-operation'

type Controller = ReturnType<typeof createPrivateLoadoutController>
type Index = { revision: string; loadouts: NamedLoadoutSummary[] }
type Approval = { title: string; lines: string[] }
type View = { session: object; index: Index | null; selected: NamedLoadout | null; loading: boolean; busy: boolean;
  error: string | null; notice: string | null; record: PrivateLoadoutRecovery | null; backup: PrivateLoadoutRecovery | null;
  approval: Approval | null; endEpoch: number | null; historicalScopes: PrivateLoadoutScope[]; historicalResult: string | null; historyBusy: boolean }
const empty = { index: null, selected: null, loading: false, busy: false, error: null, notice: null, record: null,
  backup: null, approval: null, endEpoch: null, historicalScopes: [], historicalResult: null, historyBusy: false }
const units = (value: bigint) => { const digits = value.toString().padStart(10, '0'); return `${digits.slice(0, -9)}.${digits.slice(-9)}`.replace(/\.?0+$/, '') }

/** Only the owner's connected wallet unlocks the private library. Mount/refresh
 * never signs. Encrypted pending work is durable; plaintext lives in this session
 * only. Equipment Apply continues to use its separate existing transaction WAL. */
export function useNativeLoadouts(params: { snapshot: EquipmentSnapshot; blocked?: boolean }) {
  const account = useCurrentAccount(), client = useSuiClient(), { currentWallet: wallet } = useCurrentWallet()
  const { mutateAsync: signTransaction } = useSignTransaction(), { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const snapshot = params.snapshot, address = account?.address ?? null
  const scope = { soulId: snapshot.soulId, stateId: snapshot.stateId, owner: snapshot.owner, ownershipEpoch: snapshot.ownershipEpoch }
  let config: ReturnType<typeof getBrowserPrivateLoadoutConfig> | null = null
  let uploadConfig: ReturnType<typeof getBrowserPrivateLoadoutUploadConfig> | null = null, configError = '', uploadError = ''
  try { config = getBrowserPrivateLoadoutConfig() }
  catch (error) { configError = error instanceof Error ? error.message : 'Private loadout configuration unavailable.' }
  try { uploadConfig = getBrowserPrivateLoadoutUploadConfig() }
  catch (error) { uploadError = error instanceof Error ? error.message : 'Private loadout upload configuration unavailable.' }
  const key = JSON.stringify([scope, address, config, uploadConfig, configError, uploadError])
  const session = useCommittedSession(key, null, client, wallet)
  const current = useRef({ address, blocked: params.blocked, writes: snapshot.release.writesEnabled })
  useLayoutEffect(() => { current.current = { address, blocked: params.blocked, writes: snapshot.release.writesEnabled } }, [address, params.blocked, snapshot.release.writesEnabled])
  const active = useRef<{ session: object; abort: AbortController; controller: Controller; store: ReturnType<typeof browserPrivateLoadoutRecoveryStore>;
    running: boolean; approve: ((value: boolean) => void) | null } | null>(null)
  const historyAttempt = useRef<AbortController | null>(null)
  const canManage = Boolean(account && wallet && address === scope.owner)
  const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
  const initialError = canManage ? !config ? configError : !grpc ? 'Reconnect a wallet with the verified chain reader.' : null : null
  const [visible, setView] = useSessionState<View>(session, { session, ...empty, error: initialError })
  const matches = () => session.matches() && active.current?.session === session && !active.current.abort.signal.aborted
  const patch = (value: Partial<View>) => { if (matches()) setView(old => ({ ...(old.session === session ? old : { session, ...empty }), ...value })) }
  const patchHistory = (value: Partial<View>) => { if (session.matches())
    setView(old => ({ ...(old.session === session ? old : { session, ...empty }), ...value })) }

  useEffect(() => {
    const lease = session.capture()
    if (!canManage || !config || !account || !grpc || !lease?.matches()) return
    const abort = new AbortController(), signal = abort.signal, store = browserPrivateLoadoutRecoveryStore()
    lease.requests.add(abort)
    const matches = () => lease.matches() && active.current?.abort === abort && !signal.aborted
    const patch = (value: Partial<View>) => { if (matches()) setView(old => ({ ...old, ...value })) }
    const frozenConfig = config, frozenUpload = uploadConfig
    const live = () => { signal.throwIfAborted(); check(matches(), 'Private loadout wallet or release changed.') }
    const getAddress = () => matches() ? current.current.address : null
    const approve = (value: Approval) => new Promise<boolean>((resolve, reject) => {
      try { live(); check(active.current && !active.current.approve, 'Another approval is open.') }
      catch (error) { reject(error); return }
      const done = (accepted: boolean) => { signal.removeEventListener('abort', cancelled); if (active.current?.session === session) active.current.approve = null
        patch({ approval: null }); resolve(accepted) }
      const cancelled = () => done(false)
      active.current!.approve = done; signal.addEventListener('abort', cancelled, { once: true }); patch({ approval: value })
    })
    const execution = { client: grpc, getAddress, sign: async (transaction: Transaction) => {
      live(); check(frozenUpload && current.current.writes && !current.current.blocked, 'Loadout writes are currently disabled.')
      return signTransaction({ transaction, account, chain: 'sui:mainnet' })
    } }
    const readParams = { scope, config: frozenConfig, signal }, dependencies = { client: () => grpc }
    const walletParams = { ...readParams, client: grpc, sealClient: client as unknown as SealCompatibleClient, getAddress,
      signPersonalMessage: async (message: Uint8Array) => { live(); return (await signPersonalMessage({ message, account })).signature } }
    async function captureEquipment(): Promise<{ content: ReturnType<typeof captureNamedLoadout>; capture: PrivateLoadoutCapture }> {
      live()
      const currentEquipment = await readBrowserNativeEquipment({ soulId: scope.soulId, stateId: scope.stateId,
        query: new URLSearchParams({ source: '1' }), signal }, { ...dependencies, target: () => frozenConfig.target })
      live(); check(currentEquipment.owner === scope.owner && currentEquipment.ownershipEpoch === scope.ownershipEpoch, 'Soul owner changed. Refresh the wardrobe.')
      const content = captureNamedLoadout(currentEquipment), equipment = currentEquipment.equipment!.loadout
      return { content, capture: { equipmentId: equipment.id, revision: equipment.revision, commitment: toHex(new Uint8Array(equipment.commitment)) } }
    }
    const receipt = (record: PrivateLoadoutRecovery, result: DurableWalrusBlobResult) => ({
      reference: { blobObjectId: result.blobObjectId, blobId: result.blobId, sha256: record.cipherSha256, byteLength: String(record.ciphertext.length) },
      storageTxDigest: result.storageTxDigest, certifyTxDigest: result.certifyTxDigest, recoveryKey: result.recoveryKey, quoteId: result.quoteId,
    })
    let controller!: Controller
    const transactions = createPrivateLoadoutTransactionAdapter({ ...execution, preflight: (plan, signing) => controller.preflight(plan, signing) })
    controller = createPrivateLoadoutController({ scope, config: frozenConfig, uploadConfig: frozenUpload, store, signal, getAddress,
      writesEnabled: () => Boolean(frozenUpload) && matches() && current.current.writes && !current.current.blocked, transactions,
      readers: {
        head: () => readBrowserPrivateLoadoutHead(readParams, dependencies),
        unlock: () => unlockBrowserPrivateLoadout(walletParams, dependencies),
        capture: captureEquipment,
        verifyCapture: async expected => { check(privateLoadoutCanonical((await captureEquipment()).capture) === privateLoadoutCanonical(expected),
          'Equipment changed after this loadout was captured. Rebase only after checking the current equipment.') },
        encrypt: async (library, verifyCapture) => (await encryptBrowserPrivateLoadout({ ...walletParams, library, verifyCapture }, dependencies)).ciphertext,
        decryptRecovery: async record => (await decryptBrowserPrivateLoadoutCiphertext({ ...walletParams, bytes: record.ciphertext, context: record.context }, dependencies)).library,
      },
      payments: {
        upload: async (record, verify) => {
          check(frozenUpload, 'Loadout upload configuration unavailable; no payment was started.')
          return receipt(record, await uploadPrivateLoadoutCiphertext({ bytes: record.ciphertext, owner: scope.owner,
          operationScope: privateLoadoutStorageScope(record), config: frozenUpload, execution, verify,
          confirmQuote: quote => approve({ title: 'Approve encrypted library storage', lines: [
            `Storage and write: ${units(quote.walStorageCost + quote.walWriteCost)} WAL. Relay tip: ${units(quote.relayTipMist)} SUI.`,
            `Total gas budget across both storage transactions: ${units(quote.gasBudgetMist)} SUI; unused gas is not charged.`,
            `${frozenUpload.storageEpochs} storage epochs. Two storage wallet transactions, then a separate library-head transaction.`,
            'Names and saved references stay encrypted. Previously certified storage is retained if the head conflicts.',
          ] }) }))
        },
        recover: async record => {
          const result = await recoverPrivateLoadoutStorage({ owner: scope.owner, operationScope: privateLoadoutStorageScope(record), config: record.uploadConfig, execution })
          return result.status === 'CERTIFIED' ? { status: 'CERTIFIED', receipt: receipt(record, result.result) } : { status: result.status }
        },
      },
      confirmHead: (plan, packet) => approve({ title: 'Approve private library update', lines: [
        `Library revision ${plan.expectedRevision} → ${BigInt(plan.expectedRevision) + 1n}.`,
        `Head transaction gas budget: ${units(BigInt(Transaction.from(packet.bytes).getData().gasData.budget!))} SUI.`,
        'This updates the encrypted library pointer, not Soul equipment. A conflicting newer library will not be overwritten.',
      ] }),
      onRecord: record => patch({ record }),
    })
    const owned = { session, abort, controller, store, running: false, approve: null as ((value: boolean) => void) | null }
    active.current = owned
    void controller.inspect().then(record => { if (!owned.running) patch({ record }) }).catch(error => patch({ error: error instanceof Error ? error.message : 'Encrypted recovery unavailable.' }))
    return () => { abort.abort(); lease.requests.delete(abort); controller.lock(); owned.approve?.(false); if (active.current === owned) active.current = null }
  // Public configuration, owner epoch, wallet and client are captured together.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    let cancelled = false
    if (address && wallet && config) {
      void browserPrivateLoadoutRecoveryStore().listActiveScopes(config.target.soulidityOriginalPackageId, scope.soulId, scope.stateId, address)
        .then(scopes => { if (!cancelled) patchHistory({ historicalScopes: scopes.filter(row => row.owner !== scope.owner || row.ownershipEpoch !== scope.ownershipEpoch) }) })
        .catch(error => { if (!cancelled) patchHistory({ historicalResult: error instanceof Error ? error.message : 'Previous ownership requests unavailable.' }) })
    }
    return () => { cancelled = true; historyAttempt.current?.abort(); historyAttempt.current = null }
  // Previous ownership transactions are public query-only even for a former owner.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function run(work: (controller: Controller) => Promise<void>, loading = false) {
    const owned = active.current
    if (!canManage || !owned || owned.session !== session || owned.running || historyAttempt.current) return
    owned.running = true; patch({ busy: !loading, loading, error: null, notice: null })
    try { await work(owned.controller) }
    catch (error) { patch({ error: error instanceof Error ? error.message : 'The result is unknown. Query the saved request before trying again.' }) }
    finally { if (matches()) {
      try { patch({ record: await owned.controller.inspect() }) } catch (error) { patch({ error: error instanceof Error ? error.message : 'Recovery storage unavailable.' }) }
      patch({ busy: false, loading: false })
    }; owned.running = false }
  }
  async function acceptResult(controller: Controller, result: PrivateLoadoutControllerResult) {
    if (result.status === 'SAVED') {
      patch({ index: null, selected: null, backup: result.record, notice: 'Private library saved and verified. Unlock to view the new revision.' })
      await controller.archive(); patch({ record: null })
    } else patch({ record: result.record, notice: result.status === 'FAILED' ? 'The recorded transaction failed. Review recovery before starting a new request.'
      : 'The request is not finalized. Query or resume the same saved request.' })
  }
  const unlock = () => run(async controller => {
    const result = await controller.unlock()
    patch({ index: { revision: result.library.revision, loadouts: result.library.entries.map(privateLoadoutSummary) }, selected: null, endEpoch: result.endEpoch })
  }, true)
  const refresh = () => run(async controller => {
    controller.lock(); patch({ index: null, selected: null, endEpoch: null })
    await readBrowserPrivateLoadoutHead({ scope, config: config!, signal: active.current!.abort.signal },
      { client: () => (client as unknown as { grpc: SuiGrpcClient }).grpc })
    patch({ notice: 'Current library head checked. Unlock to view private names and references.' })
  }, true)
  const mutate = (action: 'save' | 'rename' | 'delete' | 'renew', name?: string, loadoutId?: string) => run(async controller => {
    check(!current.current.blocked, 'Wait for the current equipment operation.')
    await acceptResult(controller, await controller.start(action, name, loadoutId))
  })
  const pending = visible.record !== null
  const writesEnabled = Boolean(uploadConfig && config?.target.equipmentWritesEnabled && snapshot.release.writesEnabled && !params.blocked)
  async function queryHistory(input: string | PrivateLoadoutScope) {
    const lease = session.capture()
    if (!lease?.matches() || !account || !wallet || !address || !config || active.current?.running || historyAttempt.current) return
    const controller = new AbortController(); historyAttempt.current = controller
    lease.requests.add(controller)
    const valid = () => lease.matches() && historyAttempt.current === controller && !controller.signal.aborted
    patchHistory({ historyBusy: true, historicalResult: null })
    try {
      const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
      check(grpc, 'Reconnect a wallet with the verified chain reader.')
      const expected = { originalPackageId: config.target.soulidityOriginalPackageId, soulId: scope.soulId, stateId: scope.stateId, owner: address }
      const imported = typeof input === 'string' ? parsePrivateLoadoutHistoricalExport(input, expected) : null
      const record = imported ? imported.record
        : await browserPrivateLoadoutRecoveryStore().read(privateLoadoutRecoveryKey(input as PrivateLoadoutScope, expected.originalPackageId))
      check(record && record.context.scope.soulId === scope.soulId && record.context.scope.stateId === scope.stateId
        && record.context.scope.owner === address, 'The historical request belongs to another Soul or wallet.')
      check(valid(), 'Historical query session changed.')
      const neverSign = async (): Promise<never> => { throw new Error('Historical recovery is query-only.') }
      const execution = { client: grpc, getAddress: () => null, sign: neverSign }
      const transactions = createPrivateLoadoutTransactionAdapter({ ...execution, preflight: neverSign })
      const result = await queryPrivateLoadoutHistory({ record, config, transactions, ...(imported ? { walrus: imported.walrus } : {}),
        recoverStorage: async (row, walrus) => {
          if (walrus === null) return { status: 'NONE' }
          const storageParams = { owner: row.context.scope.owner, operationScope: privateLoadoutStorageScope(row), config: row.uploadConfig, execution }
          const recovered = walrus === undefined ? await recoverPrivateLoadoutStorage(storageParams)
            : await queryPrivateLoadoutStorageRecord({ ...storageParams, record: walrus })
          return { status: recovered.status }
        } })
      if (valid()) patchHistory({ historicalResult: `${result.kind === 'HEAD' ? 'Library transaction' : 'Storage transaction'}: ${result.status}${result.digest ? ` · ${result.digest}` : ''}. ${result.status === 'NONE'
        ? 'No saved storage transaction evidence was found; this does not prove that no payment occurred. ' : ''}No signature, payment or library unlock was requested.` })
    } catch (error) { if (valid()) patchHistory({ historicalResult: error instanceof Error ? error.message : 'Historical transaction query is unavailable. Retry the same request.' }) }
    finally { if (valid()) patchHistory({ historyBusy: false }); lease.requests.delete(controller); if (historyAttempt.current === controller) historyAttempt.current = null }
  }
  return { index: visible.index, selected: visible.selected, loading: visible.loading, busy: visible.busy, error: visible.error,
    notice: visible.notice ?? (canManage && uploadError ? `Library writes unavailable: ${uploadError}. Existing private loadouts can still be unlocked.` : null), approval: visible.approval, endEpoch: visible.endEpoch, pending, canManage, writesEnabled,
    privacyKey: `${key}:${session.generation}`,
    connected: Boolean(account && wallet), historicalScopes: visible.historicalScopes, historicalResult: visible.historicalResult,
    historyBusy: visible.historyBusy, queryHistory,
    unlocked: visible.index !== null, canExport: Boolean(visible.record || visible.backup),
    canSave: Boolean(canManage && snapshot.equipment && writesEnabled && !visible.busy && !pending && !visible.loading
      && visible.index && visible.index.loadouts.length < NAMED_LOADOUT_LIMIT),
    approve: (accepted: boolean) => { if (matches()) active.current?.approve?.(accepted) },
    save: (name: string) => mutate('save', name), rename: (id: string, name: string) => mutate('rename', name, id), remove: (id: string) => mutate('delete', undefined, id),
    renew: () => mutate('renew'), unlock, refresh,
    view: (id: string) => { if (matches() && !active.current!.running) patch({ selected: active.current!.controller.view(id) }) },
    retry: () => run(async controller => acceptResult(controller, await controller.resume())),
    query: () => run(async controller => acceptResult(controller, await controller.resume(true))),
    dismiss: () => run(async controller => { await controller.archive(); patch({ record: null, notice: 'Request archived with its encrypted recovery. No stored library or equipment was deleted.' }) }),
    rebase: () => run(async controller => acceptResult(controller, await controller.rebase())),
    exportRecovery: () => { check(matches() && (visible.record || visible.backup), 'No encrypted backup is available in this session.')
      return exportPrivateLoadoutRecovery((visible.record || visible.backup)!) },
    importRecovery: (encoded: string, backupOnly = false) => run(async controller => {
      check(config && active.current, 'Private library configuration unavailable.')
      if (backupOnly) {
        const { record } = parsePrivateLoadoutRecoveryExport(encoded, scope, config.target.soulidityOriginalPackageId)
        const result = await controller.unlockBackup(record)
        patch({ index: { revision: result.library.revision, loadouts: result.library.entries.map(privateLoadoutSummary) }, selected: null,
          backup: record, endEpoch: result.endEpoch, notice: 'Exact current encrypted backup unlocked. Renew to store a fresh copy.' })
      } else {
        await importPrivateLoadoutRecovery(encoded, active.current.store, scope, config.target.soulidityOriginalPackageId)
        patch({ record: await controller.inspect(), notice: 'Encrypted recovery imported. Query the original request first.' })
      }
    }),
  }
}
