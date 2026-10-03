// @vitest-environment jsdom
// Hook boundary tests. Controller/payment/crypto correctness has dedicated suites;
// these doubles expose the real hook's dependency wiring and lifecycle only.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { useNativeLoadouts } from '../../web/lib/hooks/use-native-loadouts'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import type { EquipmentSnapshot } from '../../web/lib/animacraft/equipment-operation'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'

const h = vi.hoisted(() => ({ account: null as any, wallet: {} as any, client: { grpc: {} } as any,
  config: {} as any, uploadConfig: { storageEpochs: 5 }, deps: [] as any[], controllers: [] as any[], record: null as any,
  library: {} as any, sign: vi.fn(), personal: vi.fn(), head: vi.fn(), unlock: vi.fn(), capture: vi.fn(),
  upload: vi.fn(), recover: vi.fn(), inlineRecovery: vi.fn(), adapter: vi.fn(), exported: vi.fn(), imported: vi.fn(), parsed: vi.fn(),
  listScopes: vi.fn(), readRecord: vi.fn(), recoveryKey: vi.fn(), historicalParse: vi.fn(), historicalQuery: vi.fn(), transactionQuery: vi.fn(),
  nextUnlock: null as null | Promise<any> }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignTransaction: () => ({ mutateAsync: h.sign }), useSignPersonalMessage: () => ({ mutateAsync: h.personal }) }))
vi.mock('../../web/lib/animacraft/browser-private-loadout', () => ({ getBrowserPrivateLoadoutConfig: () => h.config,
  readBrowserPrivateLoadoutHead: (...args: any[]) => h.head(...args), unlockBrowserPrivateLoadout: (...args: any[]) => h.unlock(...args),
  encryptBrowserPrivateLoadout: vi.fn(), decryptBrowserPrivateLoadoutCiphertext: vi.fn() }))
vi.mock('../../web/lib/animacraft/private-loadout-storage', () => ({ getBrowserPrivateLoadoutUploadConfig: () => { if(!h.uploadConfig)throw Error('Upload relay unavailable'); return h.uploadConfig },
  uploadPrivateLoadoutCiphertext: (...args: any[]) => h.upload(...args), recoverPrivateLoadoutStorage: (...args: any[]) => h.recover(...args),
  queryPrivateLoadoutStorageRecord: (...args: any[]) => h.inlineRecovery(...args) }))
vi.mock('../../web/lib/animacraft/private-loadout-transaction', () => ({ createPrivateLoadoutTransactionAdapter: (...args: any[]) => h.adapter(...args) }))
vi.mock('../../web/lib/animacraft/browser-native-equipment', () => ({ readBrowserNativeEquipment: (...args: any[]) => h.capture(...args) }))
vi.mock('../../web/lib/animacraft/private-loadout-recovery', () => ({ browserPrivateLoadoutRecoveryStore: () => ({ fixtureStore: true,
  listActiveScopes: h.listScopes, read: h.readRecord }),
  privateLoadoutRecoveryKey: (...args: any[]) => h.recoveryKey(...args),
  privateLoadoutStorageScope: () => 'fixture-scope', exportPrivateLoadoutRecovery: (...args: any[]) => h.exported(...args),
  importPrivateLoadoutRecovery: (...args: any[]) => h.imported(...args), parsePrivateLoadoutRecoveryExport: (...args: any[]) => h.parsed(...args) }))
vi.mock('../../web/lib/animacraft/private-loadout-history', () => ({
  parsePrivateLoadoutHistoricalExport: (...args: any[]) => h.historicalParse(...args),
  queryPrivateLoadoutHistory: (...args: any[]) => h.historicalQuery(...args),
}))
vi.mock('../../web/lib/animacraft/private-loadout-controller', () => ({ createPrivateLoadoutController: (deps: any) => {
  h.deps.push(deps)
  const c = { inspect: vi.fn(async () => h.record), lock: vi.fn(),
    unlock: vi.fn(async () => h.nextUnlock ?? deps.readers.unlock()),
    unlockBackup: vi.fn(async () => ({ library: h.library, endEpoch: 30 })),
    view: vi.fn((id: string) => h.library.entries.find((entry: any) => entry.id === id)),
    start: vi.fn(async () => { if (!deps.writesEnabled() || !deps.config.target.equipmentWritesEnabled) throw Error('Writes disabled')
      h.record = { fixture: 'encrypted pending' }; deps.onRecord(h.record); return { status: 'PENDING', record: h.record } }),
    resume: vi.fn(async () => ({ status: 'PENDING', record: h.record })),
    rebase: vi.fn(async () => ({ status: 'PENDING', record: h.record })),
    archive: vi.fn(async () => { h.record = null }), preflight: vi.fn() }
  h.controllers.push(c); return c
} }))

let root: Root, host: HTMLDivElement, snapshot: EquipmentSnapshot, current: ReturnType<typeof useNativeLoadouts>
function Probe({ blocked = false }: { blocked?: boolean }) { current = useNativeLoadouts({ snapshot, blocked }); return null }
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
const render = async (blocked = false) => { await act(async () => root.render(<Probe blocked={blocked} />)); await settle() }
const controller = () => h.controllers.at(-1)!
const deps = () => h.deps.at(-1)!
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); h.deps.length = 0; h.controllers.length = 0; h.record = null; h.nextUnlock = null
  snapshot = await nativeEquipmentSourceFixture().readBase(); snapshot.release.writesEnabled = true
  h.account = { address: snapshot.owner }; h.wallet = {}; h.client = { grpc: {} }
  h.config = { target: { equipmentWritesEnabled: true, soulidityOriginalPackageId: 'fixture-package' }, version: 1 }
  h.uploadConfig = { storageEpochs:5 }
  h.library = { revision: '3', entries: [{ id: '12345678-1234-1234-1234-123456789abc', name: 'Private look', version: 1,
    selectionCount: 1, slotCount: 1, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', content: captureNamedLoadout(snapshot) }] }
  h.unlock.mockImplementation(async () => ({ library: h.library, endEpoch: 20 }))
  h.head.mockResolvedValue(null); h.capture.mockResolvedValue(snapshot); h.sign.mockResolvedValue({ bytes: 'signed', signature: 'signature' })
  h.personal.mockResolvedValue({ signature: 'personal-signature' }); h.exported.mockReturnValue('encrypted-export')
  h.imported.mockImplementation(async () => { h.record = { fixture: 'imported ciphertext' } })
  h.parsed.mockReturnValue({ record: { fixture: 'archived ciphertext' } })
  h.listScopes.mockReset().mockResolvedValue([]); h.readRecord.mockReset().mockResolvedValue(null)
  h.recoveryKey.mockReset().mockImplementation((scope: any, pkg: string) => `${pkg}:${scope.soulId}:${scope.stateId}:${scope.owner}:${scope.ownershipEpoch}`)
  h.historicalParse.mockReset(); h.historicalQuery.mockReset().mockImplementation(async ({ record, transactions }: any) => {
    const result = await transactions.query(record.transaction.plan, record.transaction.packet)
    return { kind: 'HEAD', status: result, digest: record.transaction.packet.digest }
  })
  h.transactionQuery.mockReset().mockResolvedValue('SUCCEEDED')
  h.adapter.mockReset().mockImplementation(() => ({ query: h.transactionQuery }))
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('keeps private library reads available without upload configuration while all writes stay disabled', async () => {
  h.uploadConfig=null as any
  await render();await act(async()=>current.unlock())
  expect(current.unlocked).toBe(true);expect(current.writesEnabled).toBe(false);expect(current.canSave).toBe(false)
  expect(current.notice).toContain('Upload relay unavailable')
  await act(async()=>current.save('Do not charge'))
  expect(h.upload).not.toHaveBeenCalled();expect(h.sign).not.toHaveBeenCalled()
})
it('mount and refresh only inspect public/recovery state; explicit unlock reveals private summaries', async () => {
  await render(); expect(controller().inspect).toHaveBeenCalledOnce(); expect(current.unlocked).toBe(false)
  expect(h.unlock).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  await act(async () => current.unlock()); expect(current.index).toMatchObject({ revision: '3', loadouts: [{ name: 'Private look' }] })
  expect(current.index!.loadouts[0]).not.toHaveProperty('content'); expect(current.canSave).toBe(true)
  act(() => current.view(h.library.entries[0].id)); expect(current.selected).toEqual(h.library.entries[0])
  expect(h.sign).not.toHaveBeenCalled(); expect(controller().start).not.toHaveBeenCalled()
  await act(async () => current.refresh()); expect(current.index).toBeNull(); expect(current.selected).toBeNull()
  expect(controller().lock).toHaveBeenCalled(); expect(h.head).toHaveBeenCalledOnce(); expect(h.unlock).toHaveBeenCalledOnce()
})
it.each(['wallet', 'client', 'epoch', 'release', 'account'])('clears private state and rejects late results after %s changes', async change => {
  await render(); await act(async () => current.unlock()); act(() => current.view(h.library.entries[0].id))
  const old = controller(), oldDeps = deps(); let release!: (v: any) => void
  h.nextUnlock = new Promise(resolve => { release = resolve }); let pending!: Promise<void>
  await act(async () => { pending = current.unlock(); await Promise.resolve() })
  if (change === 'wallet') h.wallet = {}
  if (change === 'client') h.client = { grpc: {} }
  if (change === 'epoch') snapshot = { ...snapshot, ownershipEpoch: '2' }
  if (change === 'release') h.config = { ...h.config, version: 2 }
  if (change === 'account') h.account = { address: `0x${'f'.repeat(64)}` }
  await render(); expect(current.index).toBeNull(); expect(current.selected).toBeNull(); expect(old.lock).toHaveBeenCalledOnce()
  expect(oldDeps.signal.aborted).toBe(true); expect(oldDeps.getAddress()).toBeNull()
  await act(async () => { release({ library: h.library, endEpoch: 99 }); await pending })
  expect(current.index).toBeNull(); expect(current.endEpoch).toBeNull(); expect(h.sign).not.toHaveBeenCalled()
})
it('does not initialize an owner controller or invoke operations for a nonowner', async () => {
  h.account = { address: 'other-wallet' }; await render(); expect(current.canManage).toBe(false)
  await act(async () => { await current.unlock(); await current.save('No'); await current.query() })
  expect(h.controllers).toHaveLength(0); expect(h.unlock).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it.each(['equipment-pending', 'release-closed', 'config-closed'])('allows unlock/query but prevents writes while %s', async gate => {
  if (gate === 'release-closed') snapshot.release.writesEnabled = false
  if (gate === 'config-closed') h.config.target.equipmentWritesEnabled = false
  await render(gate === 'equipment-pending'); await act(async () => current.unlock())
  expect(current.unlocked).toBe(true); expect(current.canSave).toBe(false)
  await act(async () => current.save('No')); expect(current.error).toBeTruthy(); expect(h.sign).not.toHaveBeenCalled()
  await act(async () => current.query()); expect(controller().resume).toHaveBeenCalledWith(true)
})
it('retains unknown pending work and uses explicit query/resume/rebase without another save', async () => {
  await render(); await act(async () => current.unlock()); await act(async () => current.save('Original'))
  const record = h.record; expect(current.pending).toBe(true); expect(current.canSave).toBe(false)
  controller().resume.mockRejectedValueOnce(Error('response lost'))
  await act(async () => current.query()); expect(current.error).toBe('response lost'); expect(h.record).toBe(record)
  await act(async () => current.retry()); expect(controller().resume).toHaveBeenLastCalledWith()
  await act(async () => current.rebase()); expect(controller().rebase).toHaveBeenCalledOnce(); expect(controller().start).toHaveBeenCalledOnce()
  expect(current.pending).toBe(true); expect(controller().archive).not.toHaveBeenCalled()
})
it('passes save/rename/delete/renew to the private controller without invoking equipment Apply', async () => {
  await render(); await act(async () => current.unlock())
  for (const action of [() => current.save('New'), () => current.rename('id', 'Renamed'), () => current.remove('id'), () => current.renew()])
    await act(async () => action())
  expect(controller().start.mock.calls).toEqual([['save', 'New', undefined], ['rename', 'Renamed', 'id'], ['delete', undefined, 'id'], ['renew', undefined, undefined]])
  expect(h.capture).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('exports ciphertext, imports without auto-resume, and unlocks archived backups explicitly', async () => {
  h.record = { fixture: 'ciphertext' }; await render(); expect(current.exportRecovery()).toBe('encrypted-export')
  expect(h.exported).toHaveBeenCalledWith(h.record)
  await act(async () => current.importRecovery('backup')); expect(h.imported).toHaveBeenCalledWith('backup', expect.objectContaining({ fixtureStore: true, listActiveScopes: h.listScopes, read: h.readRecord }), deps().scope, 'fixture-package')
  expect(current.pending).toBe(true); expect(controller().resume).not.toHaveBeenCalled(); expect(controller().unlock).not.toHaveBeenCalled()
  await act(async () => current.importRecovery('archived', true)); expect(h.parsed).toHaveBeenCalledWith('archived', deps().scope, 'fixture-package')
  expect(controller().unlockBackup).toHaveBeenCalledWith({ fixture: 'archived ciphertext' }); expect(current.unlocked).toBe(true)
})
it('retains recovery when archive fails and clears it only after explicit successful archive', async () => {
  h.record = { fixture: 'ciphertext' }; await render(); controller().archive.mockRejectedValueOnce(Error('archive unavailable'))
  await act(async () => current.dismiss()); expect(current.pending).toBe(true); expect(current.error).toBe('archive unavailable')
  await act(async () => current.dismiss()); expect(current.pending).toBe(false); expect(controller().resume).not.toHaveBeenCalled()
})
it('binds personal and transaction signing to the live wallet, and refuses stale or blocked transaction signatures', async () => {
  await render(); await deps().readers.unlock(); const params = h.unlock.mock.calls[0][0]
  await params.signPersonalMessage(new Uint8Array([1])); expect(h.personal).toHaveBeenCalledWith({ message: new Uint8Array([1]), account: h.account })
  const execution = h.adapter.mock.calls[0][0], tx = {} as any
  await execution.sign(tx); expect(h.sign).toHaveBeenCalledWith({ transaction: tx, account: h.account, chain: 'sui:mainnet' })
  await render(true); await expect(execution.sign(tx)).rejects.toThrow('disabled')
  h.wallet = {}; await render(); await expect(execution.sign(tx)).rejects.toThrow(); expect(h.sign).toHaveBeenCalledOnce()
})
it.each([true, false])('requires explicit storage quote approval (%s) before its promise resolves', async accepted => {
  await render(); let resolved = false
  h.upload.mockImplementation(async (params: any) => {
    const approved = await params.confirmQuote({ walStorageCost: 2_000_000_000n, walWriteCost: 1_000_000_000n,
      relayTipMist: 1_000_000n, gasBudgetMist: 200_000_000n })
    resolved = true; expect(approved).toBe(accepted)
    return { blobObjectId: 'object', blobId: 'blob' }
  })
  let upload!: Promise<unknown>
  await act(async () => { upload = deps().payments.upload({ ciphertext: new Uint8Array([1]), cipherSha256: 'hash' }, vi.fn()); await Promise.resolve() })
  expect(resolved).toBe(false); expect(current.approval?.title).toBe('Approve encrypted library storage')
  expect(current.approval?.lines.join(' ')).toContain('3 WAL'); expect(h.sign).not.toHaveBeenCalled()
  await act(async () => { current.approve(accepted); await upload }); expect(resolved).toBe(true); expect(current.approval).toBeNull()
})
it('separately confirms the head gas budget and cancels unresolved approval on wallet switch', async () => {
  await render(); const tx = new Transaction(); tx.setGasBudget(100_000_000)
  const bytes = await tx.toJSON(); let confirmed!: Promise<boolean>, resolved = false
  await act(async () => { confirmed = deps().confirmHead({ expectedRevision: '3' }, { bytes }).then((value: boolean) => { resolved = true; return value }); await Promise.resolve() })
  expect(resolved).toBe(false); expect(current.approval?.title).toBe('Approve private library update')
  expect(current.approval?.lines.join(' ')).toContain('0.1 SUI'); expect(current.approval?.lines.join(' ')).toContain('not Soul equipment')
  h.wallet = {}; await render(); expect(await confirmed).toBe(false); expect(current.approval).toBeNull(); expect(h.sign).not.toHaveBeenCalled()
})
it('clears plaintext after verified save, archives the active request, and keeps an encrypted export', async () => {
  await render(); await act(async () => current.unlock()); const record = { fixture: 'verified ciphertext' }
  controller().start.mockResolvedValueOnce({ status: 'SAVED', record })
  await act(async () => current.save('Saved')); expect(controller().archive).toHaveBeenCalledOnce()
  expect(current.unlocked).toBe(false); expect(current.pending).toBe(false); expect(current.canExport).toBe(true)
  expect(current.exportRecovery()).toBe('encrypted-export'); expect(h.exported).toHaveBeenLastCalledWith(record)
})

function historicalRecord() {
  const scope = { soulId: snapshot.soulId, stateId: snapshot.stateId, owner: h.account.address, ownershipEpoch: '0' }
  return { context: { scope, originalPackageId: 'fixture-package' }, uploadConfig: h.uploadConfig,
    transaction: { plan: { fixture: 'original public plan' }, packet: { bytes: 'original bytes', digest: 'original-digest' } } }
}
function transferAway() { snapshot = { ...snapshot, owner: `0x${'f'.repeat(64)}`, ownershipEpoch: '2' } }
function expectNoHistoryWrites() {
  expect(h.sign).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled(); expect(h.upload).not.toHaveBeenCalled()
  expect(h.unlock).not.toHaveBeenCalled(); expect(h.imported).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled()
}

it('lets a former owner discover and query the exact original local request while all write gates are closed', async () => {
  const record = historicalRecord(); transferAway(); snapshot.release.writesEnabled = false; h.config.target.equipmentWritesEnabled = false
  h.listScopes.mockResolvedValue([record.context.scope]); h.readRecord.mockResolvedValue(record)
  await render(true); expect(current.canManage).toBe(false); expect(current.historicalScopes).toEqual([record.context.scope])
  expect(h.listScopes).toHaveBeenCalledWith('fixture-package', snapshot.soulId, snapshot.stateId, h.account.address)
  expect(h.controllers).toHaveLength(0); expect(h.transactionQuery).not.toHaveBeenCalled()
  await act(async () => current.queryHistory(record.context.scope))
  expect(h.recoveryKey).toHaveBeenCalledWith(record.context.scope, 'fixture-package')
  expect(h.readRecord).toHaveBeenCalledWith(h.recoveryKey.mock.results[0].value)
  expect(h.historicalQuery).toHaveBeenCalledWith(expect.objectContaining({ record, config: h.config }))
  expect(h.transactionQuery).toHaveBeenCalledWith(record.transaction.plan, record.transaction.packet)
  expect(current.historicalResult).toContain('Library transaction: SUCCEEDED · original-digest')
  expect(current.unlocked).toBe(false); expect(current.pending).toBe(false); expectNoHistoryWrites()
  const execution = h.adapter.mock.calls[0][0]
  expect(execution.getAddress()).toBeNull(); await expect(execution.sign()).rejects.toThrow('query-only')
  await expect(execution.preflight()).rejects.toThrow('query-only')
})
it('queries an encrypted historical export using connected-wallet/Soul/State/package expectations, without importing it', async () => {
  const record = historicalRecord(); transferAway(); h.historicalParse.mockReturnValue({ record, walrus: { fixture: 'paid WAL' } }); await render()
  await act(async () => { await current.unlock(); await current.importRecovery('active-import'); await current.importRecovery('backup-unlock', true) })
  expect(h.controllers).toHaveLength(0); expect(h.parsed).not.toHaveBeenCalled(); expectNoHistoryWrites()
  await act(async () => current.queryHistory('encrypted historical export'))
  expect(h.historicalParse).toHaveBeenCalledWith('encrypted historical export', { originalPackageId: 'fixture-package',
    soulId: snapshot.soulId, stateId: snapshot.stateId, owner: h.account.address })
  expect(h.readRecord).not.toHaveBeenCalled(); expect(h.transactionQuery).toHaveBeenCalledOnce(); expectNoHistoryWrites()
})
it('filters the current epoch from historical choices when the same address owns the Soul again', async () => {
  const record = historicalRecord(); snapshot = { ...snapshot, ownershipEpoch: '2' }
  h.listScopes.mockResolvedValue([record.context.scope, { ...record.context.scope, ownershipEpoch: '2' }])
  await render(); expect(current.canManage).toBe(true); expect(current.historicalScopes).toEqual([record.context.scope])
  expect(h.transactionQuery).not.toHaveBeenCalled(); expectNoHistoryWrites()
})
it.each(['owner', 'soulId', 'stateId'])('rejects a local history record with another %s before constructing a query adapter', async field => {
  const record = historicalRecord(); transferAway(); record.context.scope[field as 'owner' | 'soulId' | 'stateId'] = `0x${'e'.repeat(64)}`
  h.readRecord.mockResolvedValue(record); await render()
  await act(async () => current.queryHistory(record.context.scope))
  expect(current.historicalResult).toContain('another Soul or wallet'); expect(h.adapter).not.toHaveBeenCalled()
  expect(h.historicalQuery).not.toHaveBeenCalled(); expectNoHistoryWrites()
})
it('surfaces historical export validation failure without query, import, signing, or unlock', async () => {
  transferAway(); h.historicalParse.mockImplementation(() => { throw Error('Wrong historical package') }); await render()
  await act(async () => current.queryHistory('wrong-package-export'))
  expect(current.historicalResult).toBe('Wrong historical package'); expect(h.transactionQuery).not.toHaveBeenCalled(); expectNoHistoryWrites()
})
it.each(['wallet', 'client', 'account'])('drops an in-flight historical query result after %s changes', async change => {
  const record = historicalRecord(); transferAway(); h.readRecord.mockResolvedValue(record); await render()
  let release!: (value: any) => void, pending!: Promise<void>
  h.transactionQuery.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.queryHistory(record.context.scope); await Promise.resolve(); await Promise.resolve() })
  expect(current.historyBusy).toBe(true)
  if (change === 'wallet') h.wallet = {}
  if (change === 'client') h.client = { grpc: {} }
  if (change === 'account') h.account = { address: `0x${'e'.repeat(64)}` }
  await render(); expect(current.historyBusy).toBe(false); expect(current.historicalResult).toBeNull()
  await act(async () => { release('SUCCEEDED'); await pending })
  expect(current.historicalResult).toBeNull(); expect(current.index).toBeNull(); expectNoHistoryWrites()
})
it('drops late historical discovery results from a previous wallet', async () => {
  const record = historicalRecord(); transferAway(); let release!: (value: any) => void
  h.listScopes.mockImplementationOnce(() => new Promise(resolve => { release = resolve })); await render()
  h.wallet = {}; await render(); await act(async () => release([record.context.scope]))
  expect(current.historicalScopes).toEqual([]); expect(h.transactionQuery).not.toHaveBeenCalled(); expectNoHistoryWrites()
})
it('serializes explicit history queries and keeps failed queries retryable', async () => {
  const record = historicalRecord(); transferAway(); h.readRecord.mockResolvedValue(record); await render()
  let release!: (value: any) => void, pending!: Promise<void>
  h.transactionQuery.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.queryHistory(record.context.scope); await Promise.resolve(); await Promise.resolve() })
  await act(async () => current.queryHistory(record.context.scope)); expect(h.transactionQuery).toHaveBeenCalledOnce()
  await act(async () => { release('PENDING'); await pending }); expect(current.historyBusy).toBe(false)
  h.transactionQuery.mockRejectedValueOnce(Error('reader unavailable'))
  await act(async () => current.queryHistory(record.context.scope)); expect(current.historicalResult).toBe('reader unavailable')
  await act(async () => current.queryHistory(record.context.scope)); expect(current.historicalResult).toContain('SUCCEEDED')
  expectNoHistoryWrites()
})
it('queries historical storage evidence using the original upload configuration and a non-signing execution', async () => {
  const record = { ...historicalRecord(), transaction: null, uploadConfig: { ...h.uploadConfig, original: true } }
  transferAway(); h.readRecord.mockResolvedValue(record); h.recover.mockResolvedValue({ status: 'UNKNOWN' })
  h.historicalQuery.mockImplementationOnce(async ({ record, recoverStorage }: any) => ({ kind: 'STORAGE',
    status: (await recoverStorage(record)).status, digest: null }))
  await render(); await act(async () => current.queryHistory(record.context.scope))
  expect(current.historicalResult).toContain('Storage transaction: UNKNOWN')
  expect(h.recover).toHaveBeenCalledWith(expect.objectContaining({ owner: h.account.address, operationScope: 'fixture-scope', config: record.uploadConfig }))
  const execution = h.recover.mock.calls[0][0].execution
  expect(execution.getAddress()).toBeNull(); await expect(execution.sign()).rejects.toThrow('query-only')
  expect(h.transactionQuery).not.toHaveBeenCalled(); expectNoHistoryWrites()
})
it('queries the paid packets from an encrypted historical export without adopting or looking up a local WAL', async () => {
  const record = { ...historicalRecord(), transaction: null }, walrus = { fixture: 'exported register and certify packets' }
  transferAway(); h.historicalParse.mockReturnValue({ record, walrus }); h.inlineRecovery.mockResolvedValue({ status: 'CERTIFIED' })
  h.historicalQuery.mockImplementationOnce(async ({ record, walrus, recoverStorage }: any) => ({ kind: 'STORAGE',
    status: (await recoverStorage(record, walrus)).status, digest: 'certify digest' }))
  await render(); await act(async () => current.queryHistory('encrypted paid history'))
  expect(h.inlineRecovery).toHaveBeenCalledWith(expect.objectContaining({ record: walrus, owner: h.account.address, config: record.uploadConfig }))
  expect(h.recover).not.toHaveBeenCalled(); expect(h.readRecord).not.toHaveBeenCalled(); expect(h.imported).not.toHaveBeenCalled()
  expect(current.historicalResult).toContain('Storage transaction: CERTIFIED'); expectNoHistoryWrites()
})
it('does not fall back to local payment state when an imported file explicitly contains no WAL', async () => {
  const record = { ...historicalRecord(), transaction: null }
  transferAway(); h.historicalParse.mockReturnValue({ record, walrus: null })
  h.historicalQuery.mockImplementationOnce(async ({ record, walrus, recoverStorage }: any) => ({ kind: 'STORAGE',
    status: (await recoverStorage(record, walrus)).status, digest: null }))
  await render(); await act(async () => current.queryHistory('encrypted unpaid history'))
  expect(h.recover).not.toHaveBeenCalled(); expect(h.inlineRecovery).not.toHaveBeenCalled()
  expect(current.historicalResult).toContain('does not prove that no payment occurred'); expectNoHistoryWrites()
})
