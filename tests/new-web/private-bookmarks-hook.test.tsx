// @vitest-environment jsdom
// Only the provider boundary is doubled here. Real controller, crypto, storage,
// transaction and raw-chain proof paths are covered by their separate suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { PrivateBookmarksProvider, usePrivateBookmarks } from '../../web/lib/hooks/use-private-bookmarks'

const h = vi.hoisted(() => ({ account: null as any, wallet: {} as any, client: { grpc: {} } as any,
  config: {} as any, uploadConfig: { storageEpochs: 26 }, deps: [] as any[], controllers: [] as any[], record: null as any,
  library: {} as any, sign: vi.fn(), personal: vi.fn(), head: vi.fn(), unlock: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(),
  upload: vi.fn(), recover: vi.fn(), adapter: vi.fn(), exported: vi.fn(), imported: vi.fn(), parsed: vi.fn(), nextInspect: null as Promise<any> | null }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignTransaction: () => ({ mutateAsync: h.sign }), useSignPersonalMessage: () => ({ mutateAsync: h.personal }) }))
vi.mock('../../web/lib/bookmarks/browser-private-bookmarks', () => ({ getBrowserPrivateBookmarkConfig: () => h.config,
  readBrowserPrivateBookmarkHead: (...args: any[]) => h.head(...args), unlockBrowserPrivateBookmarks: (...args: any[]) => h.unlock(...args),
  encryptBrowserPrivateBookmarks: (...args: any[]) => h.encrypt(...args), decryptBrowserPrivateBookmarkCiphertext: (...args: any[]) => h.decrypt(...args) }))
vi.mock('../../web/lib/bookmarks/private-bookmark-storage', () => ({ getBrowserPrivateBookmarkUploadConfig: () => h.uploadConfig,
  uploadPrivateBookmarkCiphertext: (...args: any[]) => h.upload(...args), recoverPrivateBookmarkStorage: (...args: any[]) => h.recover(...args) }))
vi.mock('../../web/lib/bookmarks/private-bookmark-transaction', () => ({ createPrivateBookmarkTransactionAdapter: (...args: any[]) => h.adapter(...args) }))
vi.mock('../../web/lib/bookmarks/private-bookmark-recovery', () => ({ browserPrivateBookmarkRecoveryStore: () => ({ fixtureStore: true }),
  privateBookmarkStorageScope: () => 'fixture-scope', exportPrivateBookmarkRecovery: (...args: any[]) => h.exported(...args),
  importPrivateBookmarkRecovery: (...args: any[]) => h.imported(...args), parsePrivateBookmarkRecoveryExport: (...args: any[]) => h.parsed(...args) }))
vi.mock('../../web/lib/bookmarks/private-bookmark-controller', () => ({ createPrivateBookmarkController: (deps: any) => {
  h.deps.push(deps)
  let unlocked: any = null
  const c = { inspect: vi.fn(async () => h.nextInspect ?? h.record), lock: vi.fn(() => { unlocked = null }),
    unlock: vi.fn(async () => { unlocked = await deps.readers.unlock(); return unlocked }),
    unlockBackup: vi.fn(async () => { unlocked = { library: h.library, endEpoch: null }; return unlocked }),
    readUnlocked: vi.fn(() => unlocked),
    start: vi.fn(async () => { if (!deps.writesEnabled() || !deps.config.writesEnabled) throw Error('Writes disabled')
      h.record = { fixture: 'encrypted pending' }; deps.onRecord(h.record); return { status: 'PENDING', record: h.record } }),
    resume: vi.fn(async () => ({ status: 'PENDING', record: h.record })),
    rebase: vi.fn(async () => ({ status: 'PENDING', record: h.record })),
    archive: vi.fn(async () => { h.record = null; deps.onRecord(null) }), preflight: vi.fn() }
  h.controllers.push(c); return c
} }))

let root: Root, host: HTMLDivElement, current: ReturnType<typeof usePrivateBookmarks>, second: ReturnType<typeof usePrivateBookmarks>
function Probe({ other = false }: { other?: boolean }) {
  const state = usePrivateBookmarks(); if (other) second = state; else current = state
  return <p>{state.entries?.map(e => e.soulId).join(',') ?? 'LOCKED'}</p>
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
const render = async () => { await act(async () => root.render(<PrivateBookmarksProvider><Probe /><Probe other /></PrivateBookmarksProvider>)); await settle() }
const controller = () => h.controllers.at(-1)!
const deps = () => h.deps.at(-1)!
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); h.deps.length = 0; h.controllers.length = 0; h.record = null; h.nextInspect = null
  h.account = { address: `0x${'a'.repeat(64)}` }; h.wallet = {}; h.client = { grpc: {} }
  h.config = { deployment: { originalPackageId: 'package', callablePackageId: 'package', callableDigest: 'digest', chainIdentifier: '35834a8a' },
    registryId: 'registry', writesEnabled: true }
  h.library = { revision: '3', entries: [{ soulId: `0x${'b'.repeat(64)}`, createdAt: '2026-09-15T00:00:00.000Z' }] }
  h.unlock.mockReset().mockImplementation(async () => ({ library: h.library, endEpoch: 20 }))
  h.head.mockReset().mockResolvedValue({ revision: '3' }); h.sign.mockReset().mockResolvedValue({ bytes: 'signed', signature: 'signature' })
  h.personal.mockReset().mockResolvedValue({ signature: 'personal-signature' }); h.exported.mockReset().mockReturnValue('encrypted-export')
  h.imported.mockReset().mockImplementation(async () => { h.record = { fixture: 'imported ciphertext' } })
  h.parsed.mockReset().mockReturnValue({ record: { fixture: 'archived ciphertext' } })
  h.adapter.mockReset().mockReturnValue({}); h.upload.mockReset(); h.recover.mockReset()
  h.encrypt.mockReset().mockResolvedValue(new Uint8Array([1])); h.decrypt.mockReset().mockResolvedValue(h.library)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('shares one coordinator across consumers and never signs on mount or public refresh', async () => {
  await render(); expect(h.controllers).toHaveLength(1); expect(current).toBe(second); expect(current.locked).toBe(true)
  expect(controller().inspect).toHaveBeenCalledOnce(); expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  await act(async () => current.unlock()); expect(second.entries).toEqual(h.library.entries); expect(current.revision).toBe('3')
  expect(current.deployment).toEqual(h.config.deployment); expect(h.unlock).toHaveBeenCalledOnce()
  await act(async () => current.refresh()); expect(current.entries).toBeNull(); expect(second.locked).toBe(true)
  expect(h.head).toHaveBeenCalledOnce(); expect(h.unlock).toHaveBeenCalledOnce(); expect(h.personal).not.toHaveBeenCalled()
})
it('never lets a slow mount inspection overwrite a newer completed action', async () => {
  const old = deferred(); h.nextInspect = old.promise; await render()
  await act(async () => current.setBookmark('soul', true)); expect(current.pending).toBe(true)
  await act(async () => old.resolve(null)); expect(current.pending).toBe(true); expect(current.canExport).toBe(true)
})
it.each(['unlock', 'refresh'] as const)('retains a slow initial pending request after an early read-only %s', async operation => {
  const initial = deferred(); h.nextInspect = initial.promise; await render()
  await act(async () => current[operation]()); expect(current.pending).toBe(false)
  await act(async () => initial.resolve({ fixture: 'real pending recovery' }))
  expect(current.pending).toBe(true); expect(current.canExport).toBe(true)
})
it.each(['wallet', 'client', 'release', 'account', 'disconnect'])('hides private state and rejects late unlock after %s changes', async change => {
  await render(); await act(async () => current.unlock()); const old = controller(), oldDeps = deps(), key = current.privacyKey
  const pending = deferred(); h.unlock.mockReturnValueOnce(pending.promise)
  let work!: Promise<unknown>
  await act(async () => { work = current.unlock().catch(e => e); await Promise.resolve() })
  if (change === 'wallet') h.wallet = {}
  if (change === 'client') h.client = { grpc: {} }
  if (change === 'release') h.config = { ...h.config, registryId: 'another-registry' }
  if (change === 'account') h.account = { address: 'other-wallet' }
  if (change === 'disconnect') h.account = null
  await render(); expect(current.entries).toBeNull(); expect(current.privacyKey).not.toBe(key)
  expect(old.lock).toHaveBeenCalled(); expect(oldDeps.signal.aborted).toBe(true); expect(oldDeps.getAddress()).toBeNull()
  await act(async () => { pending.resolve({ library: h.library, endEpoch: 99 }); expect(await work).toBeInstanceOf(Error) })
  expect(current.entries).toBeNull(); expect(current.endEpoch).toBeNull(); expect(h.sign).not.toHaveBeenCalled()
})
it('changes the privacy key for A → B → A, even when the original wallet object is reused', async () => {
  await render(); const first = current.privacyKey, account = h.account
  await act(async () => current.unlock()); h.account = { address: 'wallet-b' }; await render()
  h.account = account; await render(); expect(current.privacyKey).not.toBe(first); expect(current.entries).toBeNull()
})
it('manual lock clears both consumers and invalidates old signatures before effects run', async () => {
  await render(); await act(async () => current.unlock()); const oldDeps = deps(), oldKey = current.privacyKey
  const signing = h.adapter.mock.calls[0][0]
  act(() => current.lock()); expect(current.entries).toBeNull(); expect(second.entries).toBeNull()
  expect(current.privacyKey).not.toBe(oldKey); expect(oldDeps.signal.aborted).toBe(true)
  await expect(signing.sign({})).rejects.toThrow(); expect(h.sign).not.toHaveBeenCalled()
  await settle(); expect(controller()).not.toBe(h.controllers[0])
})
it('does not lose an already signed packet returned after lock, leaving durable reconciliation to the adapter', async () => {
  await render(); const wait = deferred(); h.sign.mockReturnValueOnce(wait.promise)
  const signed = h.adapter.mock.calls[0][0].sign({})
  act(() => current.lock()); wait.resolve({ bytes: 'signed', signature: 'late' })
  await expect(signed).resolves.toEqual({ bytes: 'signed', signature: 'late' })
})
it('disconnected operations reject rather than pretending they succeeded', async () => {
  h.account = null; await render(); expect(h.controllers).toHaveLength(0)
  await act(async () => { await expect(current.setBookmark('soul', true)).rejects.toThrow('SESSION_UNAVAILABLE') })
  expect(current.error).toContain('SESSION_UNAVAILABLE'); expect(h.sign).not.toHaveBeenCalled()
})
it('rejects overlapping operations without starting another controller action', async () => {
  await render(); const pending = deferred(); h.unlock.mockReturnValueOnce(pending.promise)
  let first!: Promise<void>; await act(async () => { first = current.unlock(); await Promise.resolve() })
  await act(async () => { await expect(current.setBookmark('soul', true)).rejects.toThrow('OPERATION_IN_PROGRESS') })
  expect(controller().start).not.toHaveBeenCalled()
  await act(async () => { pending.resolve({ library: h.library, endEpoch: 20 }); await first })
})
it('preserves pending recovery and propagates transaction errors to all consumers', async () => {
  await render(); await act(async () => current.unlock()); await act(async () => current.setBookmark('soul', false))
  expect(controller().start).toHaveBeenCalledWith('set', 'soul', false); expect(second.pending).toBe(true)
  controller().resume.mockRejectedValueOnce(Error('response lost'))
  await act(async () => { await expect(current.query()).rejects.toThrow('response lost') })
  expect(second.error).toBe('response lost'); expect(current.pending).toBe(true); expect(controller().archive).not.toHaveBeenCalled()
  await act(async () => current.retry()); expect(controller().resume).toHaveBeenLastCalledWith()
  await act(async () => current.rebase()); expect(controller().rebase).toHaveBeenCalledOnce()
})
it('closed writes preserve explicit reads and public queries', async () => {
  h.config.writesEnabled = false; await render(); await act(async () => current.unlock())
  expect(current.locked).toBe(false); expect(current.writesEnabled).toBe(false)
  await act(async () => { await expect(current.setBookmark('soul', true)).rejects.toThrow('WRITES_DISABLED') })
  expect(controller().start).not.toHaveBeenCalled()
  await act(async () => current.query()); expect(controller().resume).toHaveBeenCalledWith(true)
})
it.each([true, false])('shows one global storage approval with costs and settles explicit decision %s', async accepted => {
  await render(); let complete = false
  h.upload.mockImplementation(async (params: any) => {
    expect(await params.confirmQuote({ walStorageCost: 2_000_000_000n, walWriteCost: 1_000_000_000n,
      relayTipMist: 1_000_000n, gasBudgetMist: 200_000_000n })).toBe(accepted)
    complete = true; return { blobObjectId: 'object', blobId: 'blob' }
  })
  let pending!: Promise<unknown>
  await act(async () => { pending = deps().payments.upload({ ciphertext: new Uint8Array([1]), cipherSha256: 'hash' }, vi.fn()); await Promise.resolve() })
  expect(complete).toBe(false); expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(host.querySelector('[role="dialog"]')?.classList.contains('ph-no-capture')).toBe(true)
  expect(host.textContent).toContain('3 WAL'); expect(host.textContent).toContain('0.2 SUI')
  await act(async () => { current.approve(accepted); await pending }); expect(current.approval).toBeNull()
})
it('cancels the previous global approval without settling a new-wallet approval', async () => {
  await render(); const tx = new Transaction(); tx.setGasBudget(100_000_000); const bytes = await tx.toJSON()
  let old!: Promise<boolean>; await act(async () => { old = deps().confirmHead({ expectedRevision: '3' }, { bytes }); await Promise.resolve() })
  expect(host.textContent).toContain('0.1 SUI'); expect(host.textContent).toContain('3 → 4')
  h.wallet = {}; await render(); expect(await old).toBe(false); expect(current.approval).toBeNull()
  let next!: Promise<boolean>; await act(async () => { next = deps().confirmHead({ expectedRevision: '4' }, { bytes }); await Promise.resolve() })
  await act(async () => { current.approve(true); expect(await next).toBe(true) })
})
it('verified save updates all consumers from memory without a second unlock and retains encrypted export', async () => {
  await render(); await act(async () => current.unlock()); const record = { fixture: 'saved ciphertext' }
  controller().start.mockResolvedValueOnce({ status: 'SAVED', record }); h.library.entries = []
  await act(async () => current.setBookmark('soul', false))
  expect(current.entries).toEqual([]); expect(second.entries).toEqual([]); expect(h.unlock).toHaveBeenCalledOnce()
  expect(controller().archive).toHaveBeenCalledOnce(); expect(current.pending).toBe(false)
  expect(current.exportRecovery()).toBe('encrypted-export'); expect(h.exported).toHaveBeenCalledWith(record)
})
it('a historical save with no current plaintext stays locked rather than empty', async () => {
  await render(); const record = { fixture: 'saved ciphertext' }
  controller().resume.mockResolvedValueOnce({ status: 'SAVED', record })
  await act(async () => current.query()); expect(current.entries).toBeNull(); expect(current.locked).toBe(true)
  expect(h.unlock).not.toHaveBeenCalled(); expect(current.notice).toContain('saved and verified')
})
it('resynchronizes memory if the archive requery detects a different current head', async () => {
  await render(); await act(async () => current.unlock()); const record = { fixture: 'saved ciphertext' }
  controller().start.mockResolvedValueOnce({ status: 'SAVED', record })
  controller().archive.mockImplementationOnce(async () => { controller().lock(); deps().onRecord(null) })
  await act(async () => current.setBookmark('soul', false)); expect(current.entries).toBeNull(); expect(second.locked).toBe(true)
})
it('does not erase the pending recovery if archiving a saved request fails', async () => {
  await render(); const record = { fixture: 'saved ciphertext' }
  controller().resume.mockResolvedValueOnce({ status: 'SAVED', record }); controller().archive.mockRejectedValueOnce(Error('archive failed'))
  await act(async () => { await expect(current.query()).rejects.toThrow('archive failed') })
  expect(current.pending).toBe(true); expect(current.canExport).toBe(true)
})
it('imports only encrypted recovery without automatically resuming, and unlocks a backup only explicitly', async () => {
  await render(); await act(async () => current.importRecovery('encrypted'))
  expect(h.imported).toHaveBeenCalledWith('encrypted', { fixtureStore: true }, deps().scope, 'package')
  expect(current.pending).toBe(true); expect(controller().resume).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  await act(async () => current.importRecovery('encrypted-backup', true))
  expect(controller().unlockBackup).toHaveBeenCalledWith({ fixture: 'archived ciphertext' }); expect(current.entries).toEqual(h.library.entries)
  expect(current.endEpoch).toBeNull(); expect(h.imported).toHaveBeenCalledOnce()
})
it('also exposes synchronous encrypted-export failures in shared state', async () => {
  await render(); act(() => { expect(() => current.exportRecovery()).toThrow('BACKUP_UNAVAILABLE') })
  expect(second.error).toContain('BACKUP_UNAVAILABLE')
})
it('encrypt wiring verifies before and after encryption and decrypt binds a live-wallet guard', async () => {
  await render(); const verify = vi.fn()
  await expect(deps().readers.encrypt(h.library, verify)).resolves.toEqual(new Uint8Array([1])); expect(verify).toHaveBeenCalledTimes(2)
  await deps().readers.decryptRecovery({ ciphertext: new Uint8Array([1]), context: {} })
  const options = h.decrypt.mock.calls[0][0]; await options.verify()
  act(() => current.lock()); await expect(options.verify()).rejects.toThrow()
})
