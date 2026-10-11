// @vitest-environment jsdom
// Real React hook lifecycle, with service/store/crypto boundaries doubled.
// These are not chain, wallet, encryption or paid-upload E2E tests.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSoulContentAppend, type AppendContentVersionParams } from '../../web/lib/hooks/use-soul-content-append'

const h = vi.hoisted(() => ({ account: {} as any, wallet: {} as any, client: {} as any, config: {} as any, seal: {} as any,
  upload: {} as any, market: 'market-config', exportBundle: vi.fn(), importBundle: vi.fn(),
  observed: {} as any, saved: null as any, personal: vi.fn(), sign: vi.fn(), auth: vi.fn(), read: vi.fn(), prepare: vi.fn(),
  run: vi.fn(), query: vi.fn(), list: vi.fn(), storeRead: vi.fn(), create: vi.fn(), archive: vi.fn(), exclusive: vi.fn(),
  hash: vi.fn(), success: vi.fn(), parseIntent: vi.fn(), rebasePending: vi.fn(), rebasePrepare: vi.fn(), continuation: vi.fn(),
  restore: vi.fn(), restoreRead: vi.fn(), restoreList: vi.fn(), paymentRead: vi.fn(), paymentAssert: vi.fn(),
  archivedList: vi.fn(), queryImported: vi.fn(), finish: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignPersonalMessage: () => ({ mutateAsync: h.personal }), useSignTransaction: () => ({ mutateAsync: h.sign }) }))
vi.mock('@soulidity/sdk', async importOriginal => ({ ...await importOriginal<any>(), getRequiredSoulidityEnv: () => h.market }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ getAuthHeaders: h.auth }) }))
vi.mock('../../web/lib/upload/client-seal', () => ({ sha256Hex: (...args: any[]) => h.hash(...args) }))
vi.mock('../../web/lib/animacraft/private-loadout-storage', () => ({ getBrowserPrivateLoadoutUploadConfig: () => h.upload }))
vi.mock('../../web/lib/soulidity/browser-content-open', () => ({ getBrowserContentSealConfig: () => h.seal }))
vi.mock('../../web/lib/soulidity/browser-content-write-state', () => ({ getBrowserContentWriteConfig: () => h.config,
  readBrowserContentWriteState: (...args: any[]) => h.read(...args) }))
vi.mock('../../web/lib/soulidity/content-append-preparation', () => ({ prepareContentAppend: (...args: any[]) => h.prepare(...args) }))
vi.mock('../../web/lib/soulidity/content-append-store', () => ({ CONTENT_APPEND_STORE_CHANGED: 'test-content-store-change',
  contentAppendStoreKey: (scope: any) => `${scope.originalPackageId}:${scope.author}:${scope.contentObjectId}:${scope.kind}:${scope.name}`,
  browserContentAppendStore: () => ({ list: h.list, listArchived: h.archivedList, read: h.storeRead, create: h.create, archive: h.archive, exclusive: h.exclusive }),
  exportContentAppendPreparation: vi.fn(), importContentAppendPreparation: vi.fn() }))
vi.mock('../../web/lib/soulidity/content-append-operation', () => ({ runContentAppend: (...args: any[]) => h.run(...args),
  queryContentAppend: (...args: any[]) => h.query(...args), parseContentAppendIntent: (...args: any[]) => h.parseIntent(...args),
  contentAppendWalrusIntent: (record: any) => ({ operationScope: record.scope.intentJson }),
  assertContentAppendWalrusRecord: (...args: any[]) => h.paymentAssert(...args) }))
vi.mock('../../web/lib/soulidity/content-append-completion', () => ({
  queryLocalContentAppendCompletion: (...args: any[]) => h.query(...args),
  queryContentAppendCompletion: (...args: any[]) => h.queryImported(...args),
  finishContentAppendCompletion: (...args: any[]) => h.finish(...args),
  describeContentAppendCompletion: (value: any) => value.completed ? 'Original append verified. Current state has since changed.' : 'Original completion is not proved: UNKNOWN',
}))
vi.mock('../../web/lib/upload/walrus-single-operation', () => ({ readWalrusSingleRecord: (...args: any[]) => h.paymentRead(...args),
  walrusSingleKey: (intent: any) => intent.operationScope }))
vi.mock('../../web/lib/soulidity/content-append-restore', () => ({ restoreContentAppend: (...args: any[]) => h.restore(...args) }))
vi.mock('../../web/lib/soulidity/content-append-restore-store', () => ({ browserContentAppendRestoreStore: () => ({ read: h.restoreRead, list: h.restoreList }) }))
vi.mock('../../web/lib/soulidity/content-append-rebase-store', () => ({ browserContentAppendRebaseStore: () => ({ pending: h.rebasePending }) }))
vi.mock('../../web/lib/soulidity/content-append-rebase', () => ({ prepareContentAppendRebase: (...args: any[]) => h.rebasePrepare(...args),
  contentAppendRebaseContinuation: (...args: any[]) => h.continuation(...args) }))
vi.mock('../../web/lib/soulidity/content-append-recovery', () => ({ exportContentAppendRecovery: (...args: any[]) => h.exportBundle(...args),
  importContentAppendRecovery: (...args: any[]) => h.importBundle(...args) }))

let root: Root, host: HTMLDivElement, soul: any, role: 'owner' | 'grantee' | 'visitor', current: ReturnType<typeof useSoulContentAppend>
const owner = `0x${'a'.repeat(64)}`, other = `0x${'b'.repeat(64)}`
function Probe({ blocked = false }: { blocked?: boolean }) { current = useSoulContentAppend(soul, role, blocked, h.success); return null }
async function render(blocked = false) { await act(async () => root.render(<Probe blocked={blocked} />)); await flush() }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
function input(extra: Partial<AppendContentVersionParams> = {}) {
  const bytes = new Uint8Array(64).fill(65), file = new File([bytes], 'memory.txt', { type: 'text/plain' })
  const arrayBuffer = vi.fn(async () => bytes.buffer)
  Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: arrayBuffer })
  return { bytes, arrayBuffer, params: { kind: 1, name: 'default', file, uploadType: 'encrypted' as const,
    slotReadModeMask: 9, downloadPolicy: 'owner_only' as const, ...extra } }
}
function savedStage() { return { ciphertext: new Uint8Array(16), scope: { originalPackageId: 'pkg', callablePackageId: 'callable', author: owner,
  contentObjectId: 'content', kind: 1, name: 'default', versionIndex: '1', intentJson: '{"frozen":true}' }, fixture: 'signed encrypted stage' } }
function rebasedStage() { const record = savedStage(); return { ...record, fixture: 'activated rebased encrypted stage',
  scope: { ...record.scope, versionIndex: '2', intentJson: JSON.stringify({ frozen: true, rebase: { certifyGasBudgetMist: '50000000' } }) } } }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); h.saved = null
  h.account = { address: owner }; h.wallet = {}; h.client = { grpc: {} }; h.config = { kindRegistryId: 'registry' }; h.seal = { threshold: 1 }
  h.upload = { network: 'mainnet', storageEpochs: 3 }; h.market = 'market-config'
  soul = { originalPackageId: 'pkg', onChainId: 'soul', stateOnChainId: 'state', contentOnChainId: 'content', currentOwnershipEpoch: '2' }; role = 'owner'
  h.observed = { originalPackageId: 'pkg', callablePackageId: 'callable', snapshot: { currentOwner: owner, ownershipEpoch: '2',
    contentVersions: [{ kind: 1, name: 'default', versionIndex: '0' }], activeBindings: [], grants: [], activeGrantCount: '0', grantCapacity: '4',
    kindDescriptors: [1, 2, 3].map(kind => ({ kind, deprecated: false, op_mask: '1', default_grant_scope_mask: '3' })) } }
  h.read.mockReset().mockImplementation(async () => h.observed)
  h.prepare.mockReset().mockImplementation(async p => ({ ciphertext: new Uint8Array(16), scope: structuredClone(p.scope), fixture: 'signed encrypted stage' }))
  h.run.mockReset().mockResolvedValue({ version: { versionIndex: '1' } }); h.query.mockReset().mockResolvedValue({ completed: null, attempts: [] })
  h.queryImported.mockReset().mockResolvedValue({ completed: null, attempts: [] }); h.archivedList.mockReset().mockResolvedValue([])
  h.finish.mockReset().mockResolvedValue({ completed: { fixture: 'proved' }, attempts: [] })
  h.parseIntent.mockReset().mockImplementation(record => ({ rebase: null, ...JSON.parse(record.scope.intentJson) }))
  h.rebasePending.mockReset().mockResolvedValue(null); h.rebasePrepare.mockReset().mockResolvedValue(null)
  h.restoreRead.mockReset().mockResolvedValue(null); h.restoreList.mockReset().mockResolvedValue([])
  h.restore.mockReset().mockImplementation(async ({ bundle }) => { h.saved = bundle.record; return bundle.record })
  h.paymentRead.mockReset().mockReturnValue(null); h.paymentAssert.mockReset().mockImplementation((_record, payment) => payment)
  h.continuation.mockReset().mockResolvedValue({ payment: { fixture: 'original paid register' }, verify: vi.fn(async () => {}) })
  h.list.mockReset().mockImplementation(async () => h.saved ? [h.saved] : [])
  h.storeRead.mockReset().mockImplementation(async () => h.saved)
  h.create.mockReset().mockImplementation(async (_key, record) => { h.saved = record })
  h.archive.mockReset().mockImplementation(async () => { h.saved = null })
  h.exclusive.mockReset().mockImplementation(async (_key, work) => work())
  h.hash.mockReset().mockResolvedValue('c'.repeat(64)); h.personal.mockReset().mockResolvedValue({ signature: 'personal' })
  h.sign.mockReset().mockResolvedValue({ bytes: 'signed', signature: 'signature' }); h.auth.mockReset().mockResolvedValue({})
  h.exportBundle.mockReset().mockResolvedValue('encrypted signed recovery bundle'); h.importBundle.mockReset().mockResolvedValue({ record: savedStage(), payment: null })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }))); vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'prompt').mockReturnValue('50000000')
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:encrypted-recovery'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('mount only discovers signed recovery stages; explicit append persists before running and wipes plaintext', async () => {
  await render(); expect(h.list).toHaveBeenCalledWith({ originalPackageId: 'pkg', author: owner, contentObjectId: 'content' })
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  const f = input(); await act(async () => current.append(f.params))
  expect(h.prepare.mock.calls[0][0].scope).toMatchObject({ author: owner, versionIndex: '1', contentObjectId: 'content' })
  expect(h.create.mock.invocationCallOrder[0]).toBeLessThan(h.run.mock.invocationCallOrder[0])
  expect(h.run.mock.invocationCallOrder[0]).toBeLessThan(h.archive.mock.invocationCallOrder[0])
  expect(h.archive.mock.invocationCallOrder[0]).toBeLessThan(h.success.mock.invocationCallOrder[0])
  expect(f.bytes.every(v => v === 0)).toBe(true); expect(current.pending).toBe(false); expect(h.success).toHaveBeenCalledOnce()
})
it.each(['wallet', 'same-address-account', 'client'])('aborts a pending operation on %s identity replacement even with the same address', async mode => {
  await render(); const f = input(); let release!: (value: any) => void, pending!: Promise<any>
  h.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.append(f.params).catch(error => error); await new Promise(resolve => setTimeout(resolve, 0)) })
  const p = h.run.mock.calls[0][0]; expect(current.pending).toBe(true)
  if (mode === 'wallet') h.wallet = {}
  if (mode === 'same-address-account') h.account = { address: owner }
  if (mode === 'client') h.client = { grpc: {} }
  await render(); expect(p.signal.aborted).toBe(true); expect(p.execution.getAddress()).toBeNull(); expect(current.pending).toBe(false)
  await expect(p.execution.sign({})).rejects.toThrow()
  await act(async () => { release({ version: { versionIndex: '1' } }); expect(await pending).toBeInstanceOf(Error) })
  expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  expect(f.bytes.every(v => v === 0)).toBe(true)
})
it('wipes a delayed File.arrayBuffer after wallet switch before preparation, state read or payment', async () => {
  await render(); const f = input(); let release!: (value: ArrayBuffer) => void, pending!: Promise<any>
  f.arrayBuffer.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.append(f.params).catch(error => error) })
  h.wallet = {}; await render()
  await act(async () => { release(f.bytes.buffer); expect(await pending).toBeInstanceOf(Error) })
  expect(f.bytes.every(v => v === 0)).toBe(true); expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled()
  expect(h.read).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
})
it('returns no version when initial preparation is cancelled, without signing or saving', async () => {
  await render(); const f = input(); vi.mocked(window.confirm).mockReturnValueOnce(false)
  await act(async () => { expect(await current.append(f.params)).toBeUndefined() })
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  expect(h.create).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled()
  expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
  expect(f.bytes.every(v => v === 0)).toBe(true)
})
it('never runs after signed-stage persistence/create readback fails', async () => {
  await render(); const f = input(); h.create.mockRejectedValueOnce(Error('durable readback failed'))
  await act(async () => { await expect(current.append(f.params)).rejects.toThrow('durable readback failed') })
  expect(h.prepare).toHaveBeenCalledOnce(); expect(h.run).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
  expect(h.success).not.toHaveBeenCalled(); expect(f.bytes.every(v => v === 0)).toBe(true); expect(current.error).toBe('durable readback failed')
})
it('does not resume without the original persisted stage', async () => {
  await render(); await act(async () => { await expect(current.resume(savedStage() as any)).rejects.toThrow('recovery is missing') })
  expect(h.run).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})
it('cold-resumes the stored exact stage without reading a File, preparing new content, or changing its intent', async () => {
  h.saved = savedStage(); const saved = h.saved; await render()
  expect(current.recoveries).toEqual([saved]); await act(async () => current.resume({ ...saved, fixture: 'caller copy' }))
  expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ record: saved })); expect(h.prepare).not.toHaveBeenCalled()
  expect(h.read).not.toHaveBeenCalled(); expect(h.hash).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled(); expect(h.success).toHaveBeenCalledOnce()
})
it.each(['visitor', 'owner-changed', 'grant-missing', 'grant-expired', 'kind-disabled'])('retains the original %s authority gate before preparation/payment', async mode => {
  if (mode === 'visitor') role = 'visitor'
  if (mode === 'owner-changed') h.observed.snapshot.currentOwner = other
  if (mode === 'grant-missing' || mode === 'grant-expired') role = 'grantee'
  if (mode === 'grant-expired') h.observed.snapshot.grants = [{ slot: { grantee: owner, scope_mask: '3', grant_id: 'grant' },
    currentEpoch: true, unexpiredAtObservation: false, grant: {} }]
  if (mode === 'kind-disabled') h.observed.snapshot.kindDescriptors[0].op_mask = '0'
  await render(); const f = input(); await act(async () => { await expect(current.append(f.params)).rejects.toThrow() })
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})
it.each([false, true])('preserves first-Sprite activation semantics (existing binding=%s)', async existing => {
  if (existing) h.observed.snapshot.activeBindings = [{ kind: 3, name: 'old', versionIndex: '0' }]
  await render(); const f = input({ kind: 3, name: 'sprite', setActive: false, spriteConfigJson: '{"fps":12}' })
  await act(async () => current.append(f.params))
  const intent = JSON.parse(h.prepare.mock.calls[0][0].scope.intentJson)
  expect(intent.setActive).toBe(!existing); expect(intent.spriteConfigJson).toBe('{"fps":12}')
})
it.each(['live', 'expired', 'stale'])('private discovery uses descriptor scopeMask and merges only live scopes (%s)', async status => {
  h.observed.snapshot.grants = [{ slot: { grantee: other, scope_mask: '8', grant_id: 'grant' },
    currentEpoch: status !== 'stale', unexpiredAtObservation: status !== 'expired', grant: {} }]
  h.observed.snapshot.activeGrantCount = status === 'stale' ? '0' : '1'
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ targets: [
    { address: other, desiredScopeMask: 15, isNewGrantee: true },
  ], currentCapacity: 9999, activeGrantCount: 9999 }) }))
  vi.stubGlobal('fetch', fetcher)
  await render(); const f = input({ kind: 1, slotReadModeMask: 3 })
  await act(async () => current.append(f.params))
  expect(fetcher).toHaveBeenCalledWith('/api/souls/soul/auto-grant-targets?scopeMask=3', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  const intent = JSON.parse(h.prepare.mock.calls[0][0].scope.intentJson)
  expect(intent.autoGrantPlan).toEqual({ capacityBefore: '4', capacityAfter: '4',
    targets: [{ address: other, scopeMask: status === 'live' ? 11 : 3 }] })
})
it('keeps grantee append permissions but never gives a grantee owner-only Sprite active/config actions', async () => {
  role = 'grantee'; h.observed.snapshot.currentOwner = other
  h.observed.snapshot.grants = [{ slot: { grantee: owner, scope_mask: '3', grant_id: 'grant' }, currentEpoch: true, unexpiredAtObservation: true, grant: {} }]
  await render(); const f = input({ kind: 3, name: 'sprite', setActive: true, spriteConfigJson: '{"fps":12}' })
  await act(async () => current.append(f.params)); const intent = JSON.parse(h.prepare.mock.calls[0][0].scope.intentJson)
  expect(intent.grantId).toBe('grant'); expect(intent.setActive).toBe(false); expect(intent.spriteConfigJson).toBeNull()
})
it.each(['readback', 'archive'])('does not report success when %s fails after preparation', async stage => {
  await render(); const f = input()
  if (stage === 'readback') h.run.mockRejectedValueOnce(Error('chain readback unavailable'))
  else h.archive.mockRejectedValueOnce(Error('archive unavailable'))
  await act(async () => { await expect(current.append(f.params)).rejects.toThrow('unavailable') })
  expect(h.success).not.toHaveBeenCalled(); expect(h.saved).not.toBeNull(); expect(f.bytes.every(v => v === 0)).toBe(true)
  if (stage === 'readback') expect(h.archive).not.toHaveBeenCalled()
})
it.each(['scope', 'wallet', 'account', 'client'])('isolates a delayed old append after %s A→B→A without clearing a new pending operation or showing its stale error', async identity => {
  await render(); const a = { ...soul }, prior = { wallet: h.wallet, account: h.account, client: h.client }, old = input()
  let releaseOld!: (value: ArrayBuffer) => void, oldPending!: Promise<any>
  old.arrayBuffer.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve }))
  await act(async () => { oldPending = current.append(old.params).catch(error => error) })
  if (identity === 'scope') soul = { ...soul, currentOwnershipEpoch: '3' }
  if (identity === 'wallet') h.wallet = {}
  if (identity === 'account') h.account = { address: other }
  if (identity === 'client') h.client = { grpc: {} }
  await render(); soul = a; Object.assign(h, prior); await render()
  const fresh = input(); let releaseFresh!: (value: any) => void, freshPending!: Promise<any>
  h.run.mockImplementationOnce(() => new Promise(resolve => { releaseFresh = resolve }))
  await act(async () => { freshPending = current.append(fresh.params).catch(error => error); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(current.pending).toBe(true)
  await act(async () => { releaseOld(old.bytes.buffer); expect(await oldPending).toBeInstanceOf(Error) })
  const state = { pending: current.pending, error: current.error }
  await act(async () => { releaseFresh({ version: { versionIndex: '1' } }); await freshPending })
  expect(state).toEqual({ pending: true, error: null }); expect(old.bytes.every(v => v === 0)).toBe(true)
  expect(h.prepare).toHaveBeenCalledOnce(); expect(h.run).toHaveBeenCalledOnce(); expect(h.success).toHaveBeenCalledOnce()
})
it('isolates stale recovery-list reads across scope A→B→A', async () => {
  let release!: (value: any) => void; const old = savedStage()
  h.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve })); await render()
  const a = { ...soul }; soul = { ...soul, currentOwnershipEpoch: '3' }; await render(); soul = a; await render()
  await act(async () => release([old])); expect(current.recoveries).toEqual([])
})
it('keeps a preparation personal-message callback bound to its original live account and rejects a late signature', async () => {
  await render(); const f = input(); let release!: (value: any) => void, pending!: Promise<any>
  h.personal.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  h.prepare.mockImplementationOnce(async p => {
    await p.wallet.signPersonalMessage(new Uint8Array([8])); return { scope: p.scope, fixture: 'signed stage' }
  })
  await act(async () => { pending = current.append(f.params).catch(error => error); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(h.personal).toHaveBeenCalledWith({ message: new Uint8Array([8]), account: h.account })
  const wallet = h.prepare.mock.calls[0][0].wallet; h.account = { address: owner }; await render()
  expect(wallet.signal.aborted).toBe(true); expect(wallet.getAddress()).toBeNull()
  await act(async () => { release({ signature: 'late' }); expect(await pending).toBeInstanceOf(Error) })
  expect(h.create).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(f.bytes.every(v => v === 0)).toBe(true)
})
it('does not start append or resume while the parent content-action gate is blocked', async () => {
  await render(true); const f = input()
  await act(async () => {
    await expect(current.append(f.params)).rejects.toThrow('pending')
    await expect(current.resume(savedStage() as any)).rejects.toThrow('pending')
  })
  expect(f.arrayBuffer).not.toHaveBeenCalled(); expect(h.storeRead).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled()
})
it('queries recorded outcomes read-only without archive, preparing another payload, signing or success notification', async () => {
  await render(); await act(async () => current.query(savedStage() as any))
  expect(h.query).toHaveBeenCalledWith({ record: savedStage(), client: h.client.grpc, signal: expect.any(AbortSignal) })
  expect(h.query.mock.calls[0][0]).not.toHaveProperty('execution')
  expect(current.queryStatus).toContain('UNKNOWN'); expect(h.archive).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled()
  expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})
it.each(['resume', 'rebase'] as const)('reports proved historical success before %s without unlock, gas approval or a replacement', async action => {
  h.saved = savedStage(); h.query.mockResolvedValue({ completed: { fixture: 'historical success' }, attempts: [] }); await render()
  await act(async () => current[action](h.saved))
  expect(current.queryStatus).toContain('Use Finish completed upload'); expect(h.run).not.toHaveBeenCalled()
  expect(h.rebasePrepare).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  expect(window.prompt).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
})
it('explicit finish uses author-bound local service and retains archived query/export controls', async () => {
  const record = savedStage(); h.saved = record; await render()
  h.finish.mockImplementationOnce(async p => {
    expect(p.getAddress()).toBe(owner); expect(p.record).toBe(record); expect(p.signal.aborted).toBe(false)
    h.saved = null; h.archivedList.mockResolvedValue([record]); return { completed: {}, attempts: [] }
  })
  await act(async () => current.finish(record as any)); await flush()
  expect(current.archivedRecoveries).toEqual([record]); expect(current.recoveries).toEqual([])
  expect(current.queryStatus).toContain('Local recovery archived'); expect(h.success).toHaveBeenCalledOnce()
  expect(h.run).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('a slow pre-archive refresh cannot replace a newer archive listing in the same wallet session', async () => {
  const record = savedStage(); await render(); let release!: (rows: any[]) => void, older!: Promise<void>
  h.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { older = current.refresh(); await Promise.resolve() })
  h.archivedList.mockResolvedValue([record]); await act(async () => current.refresh())
  expect(current.archivedRecoveries).toEqual([record])
  await act(async () => { release([record]); await older })
  expect(current.recoveries).toEqual([]); expect(current.archivedRecoveries).toEqual([record])
})
it('a stale author session cannot complete a late local finish', async () => {
  const record = savedStage(); await render(); let release!: (value: any) => void, pending!: Promise<any>, request: any
  h.finish.mockImplementationOnce(p => { request = p; return new Promise(resolve => { release = resolve }) })
  await act(async () => { pending = current.finish(record as any).catch(e => e); await Promise.resolve() })
  h.account = { address: other }; await render(); expect(request.getAddress()).toBeNull(); expect(request.signal.aborted).toBe(true)
  await act(async () => { release({ completed: {}, attempts: [] }); expect(await pending).toBeInstanceOf(Error) })
  expect(h.success).not.toHaveBeenCalled(); expect(current.queryStatus).toBeNull()
})
it('a late failed pre-archive refresh cannot surface an error after a newer successful listing', async () => {
  await render(); let reject!: (error: Error) => void, older!: Promise<void>
  h.list.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  await act(async () => { older = current.refresh(); await Promise.resolve() })
  await act(async () => current.refresh())
  await act(async () => { reject(Error('obsolete list failure')); await expect(older).resolves.toBeUndefined() })
  expect(current.error).toBeNull()
})
it.each(['release', 'Seal', 'upload', 'market'].flatMap(kind => [{ kind, renderChange: true }, { kind, renderChange: false }]))(
  'rejects late results after $kind config changes (render=$renderChange)', async ({ kind, renderChange }) => {
    await render(); const f = input(); let release!: (value: any) => void, pending!: Promise<any>
    h.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await act(async () => { pending = current.append(f.params).catch(error => error); await new Promise(resolve => setTimeout(resolve, 0)) })
    const p = h.run.mock.calls[0][0]
    if (kind === 'release') h.config = { kindRegistryId: 'changed' }
    if (kind === 'Seal') h.seal = { threshold: 2 }
    if (kind === 'upload') h.upload = { ...h.upload, storageEpochs: 4 }
    if (kind === 'market') h.market = 'changed-market'
    if (renderChange) await render()
    expect(p.execution.getAddress()).toBeNull(); await expect(p.execution.sign({})).rejects.toThrow()
    await act(async () => { release({ version: { versionIndex: '1' } }); expect(await pending).toBeInstanceOf(Error) })
    expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
    expect(f.bytes.every(v => v === 0)).toBe(true)
    await render(); expect(current.pending).toBe(false)
  },
)
it('does not surface a late list error from an earlier scope A after A→B→A', async () => {
  let reject!: (reason: Error) => void
  h.list.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail })); await render()
  const a = { ...soul }; soul = { ...soul, currentOwnershipEpoch: '3' }; await render(); soul = a; await render()
  await act(async () => reject(Error('old scope list unavailable')))
  expect(current.error).toBeNull(); expect(current.recoveries).toEqual([])
})
it('exports only the verified encrypted recovery bundle and releases its download URL', async () => {
  await render(); vi.useFakeTimers(); const record = savedStage()
  await act(async () => current.exportRecovery(record as any))
  expect(h.exportBundle).toHaveBeenCalledWith(record, h.client.grpc); expect(URL.createObjectURL).toHaveBeenCalledOnce()
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce(); expect(h.run).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1000); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:encrypted-recovery')
  expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
})
it('does not download an export resolved after a same-address wallet session change', async () => {
  await render(); let release!: (text: string) => void, pending!: Promise<any>
  h.exportBundle.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.exportRecovery(savedStage() as any).catch(error => error) })
  h.wallet = {}; await render()
  await act(async () => { release('late encrypted export'); expect(await pending).toBeInstanceOf(Error) })
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
})
it.each([null, { fixture: 'original public payment WAL' }])('imports recovery read-only and forwards explicit payment %j on query without local fallback', async payment => {
  const local = savedStage(); h.saved = local; const imported = { ...savedStage(), fixture: 'imported signed stage' }
  const bundle = { record: imported, payment, history: [{ fixture: 'verified ancestor' }], pending: { fixture: 'verified pending attempt' },
    additionalPayments: [{ fixture: 'verified extra ancestor packet' }] }
  h.importBundle.mockResolvedValueOnce(bundle); await render()
  const file = new File(['encrypted'], 'recovery.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: vi.fn(async () => 'encrypted bundle') })
  await act(async () => current.importRecovery(file))
  expect(h.importBundle).toHaveBeenCalledWith('encrypted bundle', h.client.grpc); expect(current.importedRecovery).toEqual(bundle)
  expect(h.saved).toBe(local); expect(h.create).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled()
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  await act(async () => current.queryImported(current.importedRecovery!))
  expect(h.queryImported.mock.calls[0][0].bundle).toEqual(bundle)
  expect(h.query).not.toHaveBeenCalled()
  expect(h.storeRead).not.toHaveBeenCalled(); expect(h.saved).toBe(local)
})
it.each(['Soul', 'release'])('rejects imported recovery for another %s without adopting or querying it', async field => {
  const record = savedStage(); record.scope[field === 'Soul' ? 'contentObjectId' : 'originalPackageId'] = 'different'
  h.importBundle.mockResolvedValueOnce({ record, payment: null }); await render()
  const file = new File(['encrypted'], 'recovery.json'); Object.defineProperty(file, 'text', { value: async () => 'encrypted bundle' })
  await act(async () => { await expect(current.importRecovery(file)).rejects.toThrow('different Soul or release') })
  expect(current.importedRecovery).toBeNull(); expect(h.create).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled()
})
it('ignores an imported bundle resolved after a wallet switch and clears prior imported state on switch', async () => {
  await render(); const file = new File(['encrypted'], 'recovery.json'); Object.defineProperty(file, 'text', { value: async () => 'bundle' })
  await act(async () => current.importRecovery(file)); expect(current.importedRecovery).not.toBeNull()
  let release!: (bundle: any) => void, pending!: Promise<any>
  h.importBundle.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.importRecovery(file).catch(error => error); await Promise.resolve() })
  h.wallet = {}; await render(); expect(current.importedRecovery).toBeNull()
  await act(async () => { release({ record: savedStage(), payment: null }); expect(await pending).toBeInstanceOf(Error) })
  expect(current.importedRecovery).toBeNull(); expect(h.create).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled()
})
it.each(['query', 'import', 'export'])('allows no-wallet read-only %s while append/resume remain blocked', async action => {
  h.account = null; h.wallet = null; await render(); const record = savedStage()
  if (action === 'query') {
    const bundle = { record, payment: null, history: [], pending: null } as any
    await act(async () => current.queryImported(bundle))
    expect(h.queryImported).toHaveBeenCalledWith(expect.objectContaining({ bundle }))
    expect(h.query).not.toHaveBeenCalled()
  } else if (action === 'import') {
    const file = new File(['encrypted'], 'recovery.json'); Object.defineProperty(file, 'text', { value: async () => 'signed encrypted recovery' })
    await act(async () => current.importRecovery(file))
    expect(h.importBundle).toHaveBeenCalledWith('signed encrypted recovery', h.client.grpc)
    expect(current.importedRecovery).toEqual({ record, payment: null }); expect(h.query).not.toHaveBeenCalled()
  } else {
    vi.useFakeTimers(); await act(async () => current.exportRecovery(record as any))
    expect(h.exportBundle).toHaveBeenCalledWith(record, h.client.grpc)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce(); vi.advanceTimersByTime(1000); vi.useRealTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:encrypted-recovery')
  }
  const f = input()
  await act(async () => {
    await expect(current.append(f.params)).rejects.toThrow()
    await expect(current.resume(record as any)).rejects.toThrow()
  })
  expect(f.arrayBuffer).not.toHaveBeenCalled(); expect(h.auth).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  expect(h.sign).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled()
  expect(h.run).not.toHaveBeenCalled(); expect(h.storeRead).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
  expect(h.success).not.toHaveBeenCalled()
})
it('cold-resumes an activated rebase only through its verified registered-Blob continuation', async () => {
  h.saved = rebasedStage(); const record = h.saved; await render()
  await act(async () => current.resume(record))
  expect(h.continuation).toHaveBeenCalledOnce()
  expect(h.continuation.mock.calls[0][0]).toBe(record)
  expect(h.continuation.mock.calls[0][1]).toMatchObject({ client: h.client.grpc, getAddress: expect.any(Function), sign: expect.any(Function) })
  expect(h.continuation.mock.calls[0][2]).toBeInstanceOf(AbortSignal)
  expect(h.run).toHaveBeenCalledOnce(); expect(h.run.mock.calls[0][0].record).toBe(record)
  expect(h.run.mock.calls[0][0].rebase).toEqual(await h.continuation.mock.results[0].value)
  expect(h.rebasePrepare).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled()
  expect(h.archive).toHaveBeenCalledWith(expect.any(String), record); expect(h.success).toHaveBeenCalledOnce()
})
it('refuses to run a predecessor with a pending rebase instead of falling back to its old attempt', async () => {
  h.saved = savedStage(); h.rebasePending.mockResolvedValue({ fixture: 'durable pending rebase' }); await render()
  await act(async () => { await expect(current.resume(h.saved)).rejects.toThrow(/rebase/i) })
  expect(h.rebasePending).toHaveBeenCalledWith(h.saved)
  expect(h.run).not.toHaveBeenCalled(); expect(h.continuation).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled()
  expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.saved).not.toBeNull()
})
it('retains the activated rebase when its ancestry/continuation verification fails', async () => {
  h.saved = rebasedStage(); h.continuation.mockRejectedValueOnce(Error('ancestry unavailable')); await render()
  await act(async () => { await expect(current.resume(h.saved)).rejects.toThrow('ancestry unavailable') })
  expect(h.run).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
  expect(h.saved).not.toBeNull(); expect(current.pending).toBe(false); expect(current.error).toBe('ancestry unavailable')
})
it.each([false, true])('explicit rebase presents exact gas approval context and runs only the activated next stage (prepared=%s)', async alreadyPrepared => {
  h.saved = savedStage(); const previous = h.saved, next = rebasedStage(); let approved: string | null = null
  h.rebasePrepare.mockImplementationOnce(async p => {
    approved = await p.approveGas({ previousVersion: '1', nextVersion: '2', blobObjectId: 'paid-blob-id', remainingWalrusEpochs: 7,
      suggestedGasBudgetMist: '50000000', alreadyPrepared })
    h.saved = next; return next
  })
  vi.mocked(window.prompt).mockReturnValueOnce('60000000'); await render()
  await act(async () => current.rebase({ ...previous, fixture: 'untrusted caller copy' }))
  const args = h.rebasePrepare.mock.calls[0][0]
  expect(args.record).toBe(previous); expect(args.config).toBe(h.config); expect(args.signal).toBeInstanceOf(AbortSignal)
  expect(args.execution.client).toBe(h.client.grpc); expect(args.wallet.client).toBe(h.client.grpc); expect(args.wallet.sealClient).toBe(h.client)
  await expect(args.execution.sign()).rejects.toThrow('cannot sign a chain transaction')
  expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining('from v1 to v2'), '50000000')
  const prompt = vi.mocked(window.prompt).mock.calls[0][0]!
  expect(prompt).toContain('paid-blob-id'); expect(prompt).toContain('7 storage epoch(s)'); expect(prompt).toContain('No new storage registration or storage charge')
  expect(prompt).toContain(alreadyPrepared ? 'Keep the previously approved gas budget' : 'sign a new preparation')
  expect(approved).toBe('60000000'); expect(h.continuation.mock.calls[0][0]).toBe(next)
  expect(h.run).toHaveBeenCalledOnce(); expect(h.run.mock.calls[0][0].record).toBe(next)
  expect(h.archive).toHaveBeenCalledWith(expect.any(String), next); expect(h.success).toHaveBeenCalledOnce()
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('cancels gas approval without running or archiving the paid predecessor', async () => {
  h.saved = savedStage(); const previous = h.saved; vi.mocked(window.prompt).mockReturnValueOnce(null)
  h.rebasePrepare.mockImplementationOnce(async p => {
    expect(await p.approveGas({ previousVersion: '1', nextVersion: '2', blobObjectId: 'paid', remainingWalrusEpochs: 1,
      suggestedGasBudgetMist: '50000000', alreadyPrepared: false })).toBeNull()
    return null
  })
  await render(); await act(async () => current.rebase(previous))
  expect(h.saved).toBe(previous); expect(current.pending).toBe(false); expect(current.error).toBeNull()
  expect(h.run).not.toHaveBeenCalled(); expect(h.continuation).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
  expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})
it('does not rebase a missing durable stage', async () => {
  await render(); await act(async () => { await expect(current.rebase(savedStage() as any)).rejects.toThrow('recovery is missing') })
  expect(h.rebasePrepare).not.toHaveBeenCalled(); expect(window.prompt).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled()
})
it.each(['wallet', 'account', 'client', 'scope'])('invalidates delayed rebase preparation on %s identity replacement', async identity => {
  h.saved = savedStage(); let release!: (record: any) => void, pending!: Promise<any>
  h.rebasePrepare.mockImplementationOnce(() => new Promise(resolve => { release = resolve })); await render()
  await act(async () => { pending = current.rebase(h.saved).catch(error => error); await Promise.resolve() })
  const args = h.rebasePrepare.mock.calls[0][0]
  expect(args.wallet.getAddress()).toBe(owner); expect(args.execution.getAddress()).toBe(owner)
  if (identity === 'wallet') h.wallet = {}
  if (identity === 'account') h.account = { address: owner }
  if (identity === 'client') h.client = { grpc: {} }
  if (identity === 'scope') soul = { ...soul, currentOwnershipEpoch: '3' }
  await render(); expect(args.signal.aborted).toBe(true); expect(args.wallet.getAddress()).toBeNull(); expect(args.execution.getAddress()).toBeNull()
  await expect(args.wallet.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow()
  await expect(args.approveGas({})).rejects.toThrow()
  await act(async () => { release(rebasedStage()); expect(await pending).toBeInstanceOf(Error) })
  expect(h.run).not.toHaveBeenCalled(); expect(h.continuation).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
  expect(h.personal).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(current.pending).toBe(false)
})
it('rejects a personal signature returned after the rebase wallet session changes', async () => {
  h.saved = savedStage(); let release!: (value: any) => void, pending!: Promise<any>
  h.personal.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  h.rebasePrepare.mockImplementationOnce(async p => { await p.wallet.signPersonalMessage(new Uint8Array([9])); return rebasedStage() })
  await render(); const originalAccount = h.account
  await act(async () => { pending = current.rebase(h.saved).catch(error => error); await Promise.resolve() })
  expect(h.personal).toHaveBeenCalledWith({ message: new Uint8Array([9]), account: originalAccount })
  h.wallet = {}; await render()
  await act(async () => { release({ signature: 'late' }); expect(await pending).toBeInstanceOf(Error) })
  expect(h.run).not.toHaveBeenCalled(); expect(h.continuation).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})
it.each(['prepare', 'run'])('retains recovery and reports no success after rebase %s failure', async stage => {
  h.saved = savedStage(); const previous = h.saved, next = rebasedStage()
  if (stage === 'prepare') h.rebasePrepare.mockRejectedValueOnce(Error('rebase preparation unavailable'))
  else {
    h.rebasePrepare.mockImplementationOnce(async () => { h.saved = next; return next })
    h.run.mockRejectedValueOnce(Error('rebase certify unavailable'))
  }
  await render(); await act(async () => { await expect(current.rebase(previous)).rejects.toThrow('unavailable') })
  expect(h.saved).toBe(stage === 'prepare' ? previous : next); expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
  expect(current.pending).toBe(false); expect(current.error).toContain('unavailable'); expect(h.prepare).not.toHaveBeenCalled()
  if (stage === 'prepare') expect(h.run).not.toHaveBeenCalled()
  else expect(h.run.mock.calls[0][0].record).toBe(next)
})
it.each(['parent-blocked', 'no-wallet'])('does not enter rebase while %s', async reason => {
  h.saved = savedStage(); if (reason === 'no-wallet') { h.account = null; h.wallet = null }
  await render(reason === 'parent-blocked')
  await act(async () => { await expect(current.rebase(h.saved)).rejects.toThrow() })
  expect(h.storeRead).not.toHaveBeenCalled(); expect(h.rebasePrepare).not.toHaveBeenCalled(); expect(window.prompt).not.toHaveBeenCalled()
  expect(h.run).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})

function restoreBundle() { return { record: savedStage(), payment: { fixture: 'paid registration' }, history: [], pending: null } as any }
it('discovers unfinished local restores on mount but restores only after its own explicit confirmation', async () => {
  const bundle = restoreBundle(); h.restoreList.mockResolvedValue([bundle]); await render()
  expect(current.pendingRestores).toEqual([bundle]); expect(h.restore).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled()
  await act(async () => current.restore(bundle))
  expect(h.restore).toHaveBeenCalledOnce()
  expect(JSON.stringify(h.restore.mock.calls[0][0].bundle)).toEqual(JSON.stringify(bundle))
  expect(h.restore.mock.calls[0][0].bundle).not.toBe(bundle)
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('No unlock, signature, upload or payment'))
  expect(current.queryStatus).toContain('restored to this device')
  expect(h.run).not.toHaveBeenCalled(); expect(h.rebasePrepare).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  expect(h.sign).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(h.archive).not.toHaveBeenCalled()
})
it.each(['cancel', 'other-author', 'other-release', 'other-soul', 'no-wallet', 'blocked'])('does not restore on %s', async reason => {
  const bundle = restoreBundle()
  if (reason === 'cancel') vi.mocked(window.confirm).mockReturnValue(false)
  if (reason === 'other-author') bundle.record.scope.author = other
  if (reason === 'other-release') bundle.record.scope.originalPackageId = 'elsewhere'
  if (reason === 'other-soul') bundle.record.scope.contentObjectId = 'elsewhere'
  if (reason === 'no-wallet') { h.account = null; h.wallet = null }
  await render(reason === 'blocked')
  await act(async () => { if (reason === 'cancel') await current.restore(bundle); else await expect(current.restore(bundle)).rejects.toThrow() })
  expect(h.restore).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it.each(['wallet', 'account', 'client', 'scope', 'config'])('invalidates a pending restore on %s identity replacement', async identity => {
  let release!: (value: any) => void, pending!: Promise<any>
  h.restore.mockImplementationOnce(() => new Promise(resolve => { release = resolve })); await render()
  const bundle = restoreBundle()
  await act(async () => { pending = current.restore(bundle).catch(error => error); await Promise.resolve() })
  const args = h.restore.mock.calls[0][0]; expect(args.getAddress()).toBe(owner)
  if (identity === 'wallet') h.wallet = {}
  if (identity === 'account') h.account = { address: owner }
  if (identity === 'client') h.client = { grpc: {} }
  if (identity === 'scope') soul = { ...soul, currentOwnershipEpoch: '3' }
  if (identity === 'config') h.seal = { threshold: 2 }
  await render(); expect(args.signal.aborted).toBe(true); expect(args.getAddress()).toBeNull()
  await act(async () => { release(bundle.record); expect(await pending).toBeInstanceOf(Error) })
  expect(current.queryStatus).toBeNull(); expect(current.pending).toBe(false); expect(h.run).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled()
})
it.each(['append', 'resume', 'rebase'])('blocks %s while a durable restore marker remains', async action => {
  h.saved = savedStage(); h.restoreRead.mockResolvedValue(restoreBundle()); await render()
  await act(async () => { await expect(action === 'append' ? current.append(input().params) : current[action](h.saved)).rejects.toThrow('Finish restoring') })
  expect(h.run).not.toHaveBeenCalled(); expect(h.rebasePrepare).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled()
  expect(h.personal).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('reviews recorded certify gas again and rejects a changed durable approval before a resumed write', async () => {
  h.saved = savedStage(); const payment = { approved: { gasBudget: '80000000', quoteId: 'original' } }
  h.paymentRead.mockReturnValue(payment)
  h.run.mockImplementationOnce(async p => {
    await p.execution.beforeWrite()
    h.paymentRead.mockReturnValue({ approved: { ...payment.approved, gasBudget: '90000000' } })
    await expect(p.execution.beforeWrite()).rejects.toThrow('gas approval changed')
    throw new Error('changed approval')
  })
  await render(); await act(async () => { await expect(current.resume(h.saved)).rejects.toThrow('changed approval') })
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Recorded certify gas budget: 40000000 MIST'))
  expect(h.paymentAssert).toHaveBeenCalledWith(h.saved, payment); expect(h.archive).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('does not publish an old pending-restore list after switching away and back to the same wallet', async () => {
  let release!: (rows: any[]) => void
  const original = h.wallet; h.restoreList.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await render(); h.wallet = {}; await render(); h.wallet = original; await render()
  await act(async () => { release([restoreBundle()]); await Promise.resolve() })
  expect(current.pendingRestores).toEqual([])
})
