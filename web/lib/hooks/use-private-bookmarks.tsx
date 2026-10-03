'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet, useSignPersonalMessage, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { Button } from '@/components/ui/button'
import { bookmarkCheck as check, type PrivateBookmarkEntry } from '@/lib/bookmarks/private-bookmark-library'
import { getBrowserPrivateBookmarkConfig, readBrowserPrivateBookmarkHead, unlockBrowserPrivateBookmarks,
  encryptBrowserPrivateBookmarks, decryptBrowserPrivateBookmarkCiphertext } from '@/lib/bookmarks/browser-private-bookmarks'
import { getBrowserPrivateBookmarkUploadConfig, uploadPrivateBookmarkCiphertext, recoverPrivateBookmarkStorage,
  type DurableWalrusBlobResult } from '@/lib/bookmarks/private-bookmark-storage'
import { browserPrivateBookmarkRecoveryStore, exportPrivateBookmarkRecovery, importPrivateBookmarkRecovery,
  parsePrivateBookmarkRecoveryExport, privateBookmarkStorageScope, type PrivateBookmarkRecovery } from '@/lib/bookmarks/private-bookmark-recovery'
import { createPrivateBookmarkController, type PrivateBookmarkControllerResult } from '@/lib/bookmarks/private-bookmark-controller'
import { createPrivateBookmarkTransactionAdapter } from '@/lib/bookmarks/private-bookmark-transaction'

type Controller = ReturnType<typeof createPrivateBookmarkController>
type Approval = { title: string; lines: string[] }
type View = { session: object; entries: PrivateBookmarkEntry[] | null; revision: string | null; loading: boolean; busy: boolean;
  error: string | null; notice: string | null; record: PrivateBookmarkRecovery | null; backup: PrivateBookmarkRecovery | null;
  approval: Approval | null; endEpoch: number | null }
const empty = { entries: null, revision: null, loading: false, busy: false, error: null, notice: null, record: null,
  backup: null, approval: null, endEpoch: null }
const units = (value: bigint) => { const digits = value.toString().padStart(10, '0'); return `${digits.slice(0, -9)}.${digits.slice(-9)}`.replace(/\.?0+$/, '') }
const message = (error: unknown) => error instanceof Error ? error.message : 'Private bookmarks are unavailable. Query the saved request before retrying.'

function usePrivateBookmarkSession() {
  const account = useCurrentAccount(), client = useSuiClient(), { currentWallet: wallet } = useCurrentWallet()
  const { mutateAsync: signTransaction } = useSignTransaction(), { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const owner = account?.address ?? null
  let config: ReturnType<typeof getBrowserPrivateBookmarkConfig> | null = null
  let uploadConfig: ReturnType<typeof getBrowserPrivateBookmarkUploadConfig> | null = null, configError: string | null = null
  try { config = getBrowserPrivateBookmarkConfig(); uploadConfig = getBrowserPrivateBookmarkUploadConfig() }
  catch (error) { configError = message(error) }
  const [lockGeneration, setLockGeneration] = useState(0)
  const key = JSON.stringify([owner, config, uploadConfig, configError, lockGeneration])
  const session = useCommittedSession(key, null, client, wallet)
  const active = useRef<{ session: object; abort: AbortController; controller: Controller; store: ReturnType<typeof browserPrivateBookmarkRecoveryStore>;
    running: boolean; recordVersion: number; approve: ((value: boolean) => void) | null; head: () => ReturnType<typeof readBrowserPrivateBookmarkHead> } | null>(null)
  const connected = Boolean(account && wallet)
  const grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
  const initialError = connected ? !config || !uploadConfig ? configError : !grpc ? 'Reconnect a wallet with the verified chain reader.' : null : null
  const [visible, setView] = useSessionState<View>(session, { session, ...empty, error: initialError })
  const matches = () => session.matches() && active.current?.session === session && !active.current.abort.signal.aborted
  const patch = (value: Partial<View>) => { if (session.matches())
    setView(old => ({ ...(old.session === session ? old : { session, ...empty }), ...value })) }

  useEffect(() => {
    const lease = session.capture()
    if (!connected || !config || !uploadConfig || !account || !owner || !grpc || !lease?.matches()) return
    const abort = new AbortController(), signal = abort.signal, store = browserPrivateBookmarkRecoveryStore()
    lease.requests.add(abort)
    const matches = () => lease.matches() && active.current?.abort === abort && !signal.aborted
    const patch = (value: Partial<View>) => { if (matches()) setView(old => ({ ...old, ...value })) }
    const frozenConfig = config, frozenUpload = uploadConfig, scope = { registryId: config.registryId, owner }
    const live = () => { signal.throwIfAborted(); check(matches(), 'WALLET_OR_RELEASE_CHANGED') }
    const getAddress = () => matches() ? owner : null
    const approve = (value: Approval) => new Promise<boolean>((resolve, reject) => {
      try { live(); check(active.current && !active.current.approve, 'APPROVAL_ALREADY_OPEN') }
      catch (error) { reject(error); return }
      const owned = active.current!
      let settled = false
      const done = (accepted: boolean) => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancelled)
        if (owned.approve === done) owned.approve = null
        if (matches()) patch({ approval: null })
        resolve(accepted && matches())
      }
      const cancelled = () => done(false)
      owned.approve = done; signal.addEventListener('abort', cancelled, { once: true }); patch({ approval: value })
    })
    const execution = { client: grpc, getAddress, sign: async (transaction: Transaction) => {
      live(); check(config.writesEnabled, 'WRITES_DISABLED')
      // A wallet may resolve after it is disconnected. Let the durable adapter
      // retain that signed packet; its own lifetime guard prevents broadcast.
      return signTransaction({ transaction, account, chain: 'sui:mainnet' })
    } }
    const readParams = { owner, config: frozenConfig, signal }, dependencies = { client: () => grpc }
    const walletParams = { ...readParams, client: grpc, sealClient: client as unknown as SealCompatibleClient, getAddress,
      signPersonalMessage: async (message: Uint8Array) => {
        live(); const result = await signPersonalMessage({ message, account }); live(); return result.signature
      } }
    const head = () => readBrowserPrivateBookmarkHead(readParams, dependencies)
    const receipt = (record: PrivateBookmarkRecovery, result: DurableWalrusBlobResult) => ({
      reference: { blobObjectId: result.blobObjectId, blobId: result.blobId, sha256: record.cipherSha256, byteLength: String(record.ciphertext.length) },
      storageTxDigest: result.storageTxDigest, certifyTxDigest: result.certifyTxDigest, recoveryKey: result.recoveryKey, quoteId: result.quoteId,
    })
    let controller!: Controller
    const transactions = createPrivateBookmarkTransactionAdapter({ ...execution, signal, preflight: (plan, signing) => controller.preflight(plan, signing) })
    controller = createPrivateBookmarkController({ scope, config: frozenConfig, uploadConfig: frozenUpload, store, signal, getAddress,
      writesEnabled: () => matches() && config.writesEnabled, transactions,
      readers: {
        head, unlock: () => unlockBrowserPrivateBookmarks(walletParams, dependencies),
        encrypt: async (library, verify) => { await verify(); live()
          const result = await encryptBrowserPrivateBookmarks({ ...walletParams, library }); await verify(); live(); return result },
        decryptRecovery: record => decryptBrowserPrivateBookmarkCiphertext({ ...walletParams, bytes: record.ciphertext, context: record.context,
          verify: async () => live() }),
      },
      payments: {
        upload: async (record, verify) => receipt(record, await uploadPrivateBookmarkCiphertext({ bytes: record.ciphertext, owner,
          operationScope: privateBookmarkStorageScope(record), config: frozenUpload, execution, verify,
          confirmQuote: quote => approve({ title: 'Approve encrypted bookmark storage', lines: [
            `Storage and write: ${units(quote.walStorageCost + quote.walWriteCost)} WAL. Relay tip: ${units(quote.relayTipMist)} SUI.`,
            `Total gas budget across both storage transactions: ${units(quote.gasBudgetMist)} SUI; unused gas is not charged.`,
            `${frozenUpload.storageEpochs} storage epochs. Two storage wallet transactions, then a separate bookmark-head transaction.`,
            'Bookmarked Soul IDs and bookmark counts remain encrypted. Paid storage is retained if the head conflicts.',
          ] }) })),
        recover: async record => {
          const result = await recoverPrivateBookmarkStorage({ owner, operationScope: privateBookmarkStorageScope(record), config: frozenUpload, execution })
          return result.status === 'CERTIFIED' ? { status: 'CERTIFIED', receipt: receipt(record, result.result) } : { status: result.status }
        },
      },
      confirmHead: (plan, packet) => approve({ title: 'Approve private bookmark update', lines: [
        `Bookmark revision ${plan.expectedRevision} → ${BigInt(plan.expectedRevision) + 1n}.`,
        `Head transaction gas budget: ${units(BigInt(Transaction.from(packet.bytes).getData().gasData.budget!))} SUI.`,
        'This updates your encrypted bookmark pointer. It does not change Soul ownership or equipment. A newer revision will not be overwritten.',
      ] }),
      onRecord: record => { if (matches()) {
        active.current!.recordVersion++; patch({ record, ...(record ? { backup: record } : {}) })
      } },
    })
    const owned = { session, abort, controller, store, head, running: false, recordVersion: 0, approve: null as ((value: boolean) => void) | null }
    active.current = owned
    void controller.inspect().then(record => { if (matches() && owned.recordVersion === 0) patch({ record, backup: record }) })
      .catch(error => { if (matches() && owned.recordVersion === 0) patch({ error: message(error) }) })
    return () => { abort.abort(); lease.requests.delete(abort); controller.lock(); owned.approve?.(false); if (active.current === owned) active.current = null }
  // The complete read/write release, wallet and client share one cancellable lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function run(work: (controller: Controller, owned: NonNullable<typeof active.current>) => Promise<void>, loading = false) {
    const owned = active.current
    try { check(connected && matches() && owned, 'SESSION_UNAVAILABLE'); check(!owned.running, 'OPERATION_IN_PROGRESS') }
    catch (error) { patch({ error: message(error) }); throw error }
    owned.running = true; patch({ busy: !loading, loading, error: null, notice: null })
    try { await work(owned.controller, owned); check(matches(), 'WALLET_OR_RELEASE_CHANGED') }
    catch (error) {
      if (matches()) {
        try { showUnlocked(owned.controller.readUnlocked()) } catch { showUnlocked(null) }
        patch({ error: message(error) })
      }
      throw error
    }
    finally { if (matches()) patch({ busy: false, loading: false }); owned.running = false }
  }
  const showUnlocked = (result: ReturnType<Controller['readUnlocked']>) => patch(result
    ? { entries: result.library.entries, revision: result.library.revision, endEpoch: result.endEpoch }
    : { entries: null, revision: null, endEpoch: null })
  async function acceptResult(controller: Controller, result: PrivateBookmarkControllerResult) {
    check(matches(), 'WALLET_OR_RELEASE_CHANGED')
    active.current!.recordVersion++
    showUnlocked(controller.readUnlocked())
    if (result.status === 'SAVED') {
      patch({ record: result.record, backup: result.record, notice: 'Private bookmarks saved and verified.' })
      await controller.archive(); check(matches(), 'WALLET_OR_RELEASE_CHANGED')
      showUnlocked(controller.readUnlocked()); patch({ record: null })
    } else patch({ record: result.record, notice: result.status === 'UNCHANGED' ? 'Bookmarks already match this request.'
      : result.status === 'FAILED' ? 'The recorded transaction failed. Review recovery before starting a new request.'
        : 'The request is not finalized. Query or resume the same saved request.' })
  }
  const unlock = () => run(async controller => showUnlocked(await controller.unlock()), true)
  const refresh = () => run(async (controller, owned) => {
    controller.lock(); showUnlocked(null); const result = await owned.head(); check(matches(), 'WALLET_OR_RELEASE_CHANGED')
    patch({ revision: result.revision, notice: 'Current bookmark head checked. Unlock to view private bookmarks.' })
  }, true)
  const mutate = (action: 'set' | 'renew', soulId?: string, bookmarked?: boolean) => run(async controller => {
    check(config?.writesEnabled, 'WRITES_DISABLED'); await acceptResult(controller, await controller.start(action, soulId, bookmarked))
  })
  const lock = () => {
    if (!session.matches()) return
    const owned = active.current
    // Invalidate synchronously, including callbacks from a still-open wallet prompt.
    session.capture()?.revoke()
    owned?.abort.abort(); owned?.controller.lock(); owned?.approve?.(false)
    setLockGeneration(value => value + 1)
  }
  return { owner, connected, deployment: config?.deployment ?? null, privacyKey: `${key}:${session.generation}`, entries: visible.entries, revision: visible.revision,
    loading: visible.loading, busy: visible.busy, locked: visible.entries === null, writesEnabled: Boolean(connected && config?.writesEnabled),
    pending: visible.record !== null, error: visible.error, notice: visible.notice, endEpoch: visible.endEpoch,
    canExport: Boolean(visible.record || visible.backup), approval: visible.approval,
    approve: (accepted: boolean) => { if (matches()) active.current?.approve?.(accepted) },
    unlock, refresh, lock, setBookmark: (soulId: string, bookmarked: boolean) => mutate('set', soulId, bookmarked), renew: () => mutate('renew'),
    query: () => run(async controller => acceptResult(controller, await controller.resume(true))),
    retry: () => run(async controller => acceptResult(controller, await controller.resume())),
    rebase: () => run(async controller => acceptResult(controller, await controller.rebase())),
    dismiss: () => run(async controller => { await controller.archive(); check(matches(), 'WALLET_OR_RELEASE_CHANGED')
      active.current!.recordVersion++
      showUnlocked(controller.readUnlocked())
      patch({ record: null, notice: 'Request archived with its encrypted recovery. No bookmark or stored ciphertext was deleted.' }) }),
    exportRecovery: () => {
      try { check(matches() && (visible.record || visible.backup), 'BACKUP_UNAVAILABLE')
        return exportPrivateBookmarkRecovery((visible.record || visible.backup)!) }
      catch (error) { patch({ error: message(error) }); throw error }
    },
    importRecovery: (encoded: string, backupOnly = false) => run(async (controller, owned) => {
      check(config && owner && matches(), 'SESSION_UNAVAILABLE')
      const scope = { registryId: config.registryId, owner }, packageId = config.deployment.originalPackageId
      const { record } = parsePrivateBookmarkRecoveryExport(encoded, scope, packageId)
      check(matches(), 'WALLET_OR_RELEASE_CHANGED')
      if (backupOnly) { const result = await controller.unlockBackup(record); check(matches(), 'WALLET_OR_RELEASE_CHANGED')
        showUnlocked(result); patch({ backup: record, notice: 'Current encrypted backup unlocked. Remote storage expiry has not been refreshed.' }) }
      else {
        await importPrivateBookmarkRecovery(encoded, owned.store, scope, packageId); check(matches(), 'WALLET_OR_RELEASE_CHANGED')
        const imported = await controller.inspect(); check(matches(), 'WALLET_OR_RELEASE_CHANGED')
        owned.recordVersion++
        patch({ record: imported, backup: imported, notice: 'Encrypted request imported. Query its transactions before resuming.' })
      }
    }),
  }
}

export type PrivateBookmarksActions = ReturnType<typeof usePrivateBookmarkSession>
const PrivateBookmarksContext = createContext<PrivateBookmarksActions | null>(null)

/** One shared coordinator and one approval surface for all cards and pages.
 * Decrypted entries never enter React Query, browser storage or a server. */
export function PrivateBookmarksProvider({ children }: { children: ReactNode }) {
  const actions = usePrivateBookmarkSession()
  return <PrivateBookmarksContext.Provider value={actions}>
    {children}
    {actions.approval && <div role="dialog" aria-modal="true" aria-label={actions.approval.title}
      className="ph-no-capture fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-lg space-y-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-5 text-sm">
        <h2 className="font-semibold">{actions.approval.title}</h2>
        {actions.approval.lines.map((line, i) => <p key={i}>{line}</p>)}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => actions.approve(true)}>Approve and continue</Button>
          <Button variant="outline" onClick={() => actions.approve(false)}>Decline</Button>
        </div>
      </div>
    </div>}
  </PrivateBookmarksContext.Provider>
}

export function usePrivateBookmarks() {
  const actions = useContext(PrivateBookmarksContext)
  if (!actions) throw new Error('PrivateBookmarksProvider is required.')
  return actions
}
