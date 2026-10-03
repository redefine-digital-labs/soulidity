// @vitest-environment jsdom
// Real React lifecycle and plan/authority logic; RPC/transaction/storage runner
// boundaries are controlled here, with real byte/Storage tests in adjacent suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SoulContentSlotPublicBcs } from '@soulidity/sdk'
import { useSoulContentMutations } from '../../web/lib/hooks/use-soul-content-mutations'

const h = vi.hoisted(() => ({ account: null as any, wallet: null as any, client: null as any, config: null as any, proof: null as any,
  market: '', records: [] as any[], history: [] as any[], saved: null as any, adapter: null as any,
  read: vi.fn(), sign: vi.fn(), run: vi.fn(), query: vi.fn(), success: vi.fn(), discover: vi.fn(), historyRead: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignTransaction: () => ({ mutateAsync: h.sign }) }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<any>(), getRequiredSoulidityEnv: () => h.market }))
vi.mock('../../web/lib/soulidity/browser-content-write-state', () => ({ getBrowserContentWriteConfig: () => {
  if (!h.config) throw Error('config unavailable'); return h.config
}, readBrowserContentWriteState: (...args: any[]) => h.read(...args) }))
vi.mock('../../web/lib/soulidity/content-mutation-transaction', async original => ({ ...await original<any>(),
  parseContentMutationRecord: (r: unknown) => structuredClone(r),
  createContentMutationAdapter: (params: any) => {
    h.adapter = params; return { query: h.query, preflight: (r: any) => params.preflight(r.plan, true), sign: params.sign }
  } }))
vi.mock('../../web/lib/soulidity/content-mutation-store', () => ({ CONTENT_MUTATION_STORE_CHANGED: 'test-mutations-change',
  browserContentMutationStore: () => ({ discover: h.discover, history: h.historyRead, read: () => h.saved }) }))
vi.mock('../../web/lib/soulidity/content-mutation-runner', () => ({ runContentMutation: (...args: any[]) => h.run(...args) }))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
let host: HTMLDivElement, root: Root, soul: any, current: ReturnType<typeof useSoulContentMutations>, blocked = false
function Probe() { current = useSoulContentMutations(soul, h.success, () => blocked); return null }
const render = () => act(async () => { root.render(<Probe />) })
const invoke = async (fn: () => Promise<unknown>) => act(async () => { await fn() })
function record(plan?: any) {
  return { schema: 'soulidity.content-mutation.v1', plan: plan ?? {
    deployment: { chainIdentifier: '35834a8a', originalPackageId: id(10), callablePackageId: id(11), marketConfigId: id(12), kindRegistryId: id(13) },
    soulId: id(1), stateId: id(2), contentId: id(3), author: id(4), ownershipEpoch: '2', kind: 3, action: 'delete',
    target: { name: 'sprite', versionIndex: '0' }, expectedActive: null, grantId: null,
    expectedSlot: SoulContentSlotPublicBcs.serialize(h.proof.snapshot.contentVersions[0].slot).toBase64(),
  }, packet: { bytes: 'same packet', digest: 'same-digest', phase: 'PREPARED', expirationEpoch: '12', signature: null } }
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); blocked = false
  h.account = { address: id(4) }; h.wallet = {}; h.client = { grpc: {} }; h.market = id(12)
  h.config = { target: { soulidityOriginalPackageId: id(10), soulidityCallablePackageId: id(11) }, kindRegistryId: id(13) }
  soul = { originalPackageId: id(10), onChainId: id(1), stateOnChainId: id(2), contentOnChainId: id(3) }
  h.proof = { soulId: id(1), stateId: id(2), contentId: id(3), originalPackageId: id(10), callablePackageId: id(11), kindRegistryId: id(13), snapshot: {
    currentOwner: id(4), ownershipEpoch: '2', activeBindings: [], grants: [],
    kindDescriptors: [{ kind: 3, has_active_binding: true, op_mask: '15', deprecated: true }], contentVersions: [{ kind: 3, name: 'sprite', versionIndex: '0',
      slot: { version: '1', kind: 3, blob_object_id: id(21), is_public: false, deleted: false, purged: false, download_policy: 1,
        grant_scope_mask: '8', read_mode_mask: '3', op_mask: '15', seal_encrypted: true, created_at_ms: '1' } }] } }
  h.records = []; h.history = []; h.saved = null; h.adapter = null
  h.discover.mockReset().mockImplementation(() => h.records); h.historyRead.mockReset().mockImplementation(() => h.history)
  h.read.mockReset().mockImplementation(async () => structuredClone(h.proof)); h.sign.mockReset().mockResolvedValue({ bytes: 'same', signature: 'sig' })
  h.run.mockReset().mockImplementation(async ({ plan }) => ({ record: record(plan), status: 'SUCCEEDED', checkpoint: '9', contentVersion: '10' }))
  h.query.mockReset().mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '9', contentVersion: '10' })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No owned HTTP API') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['wallet', 'busy'])('early %s rejection is exposed to the original page without starting a transaction', async reason => {
  if (reason === 'wallet') h.account = null
  else blocked = true
  await render()
  const message = reason === 'wallet' ? 'Connect the preparing Sui wallet' : 'Another content action is pending'
  await act(async () => { await expect(current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' })).rejects.toThrow(message) })
  expect(current.error).toBe(message)
  expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('mount/disconnect discovers captured deployment records without wallet, current config or signing', async () => {
  h.records = [record()]; h.history = [record()]; h.account = null; h.wallet = null; h.config = null
  await render()
  expect(h.discover).toHaveBeenCalledWith({ soulId: id(1), originalPackageId: id(10) }); expect(current.records).toHaveLength(1)
  expect(current.history).toHaveLength(1); expect(h.read).not.toHaveBeenCalled(); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  await invoke(() => current.query(h.records[0]))
  expect(current.status).toContain('confirmed at checkpoint 9'); expect(h.query).toHaveBeenCalledOnce(); expect(h.read).not.toHaveBeenCalled()
})
it.each(['applied', 'changed', 'epoch', 'unavailable'])('keeps original confirmation while current observation is %s', async mode => {
  const original = record()
  if (mode === 'applied') h.proof.snapshot.contentVersions[0].slot.deleted = true
  if (mode === 'epoch') h.proof.snapshot.ownershipEpoch = '3'
  if (mode === 'unavailable') h.read.mockRejectedValue(Error('offline'))
  await render(); await invoke(() => current.query(original))
  expect(current.status).toContain('confirmed at checkpoint 9')
  expect(current.currentObservation).toContain(mode === 'applied' ? 'STILL_APPLIED' : mode === 'changed' ? 'LATER_CONTENT_CHANGED'
    : mode === 'epoch' ? 'OWNER_EPOCH_CHANGED' : 'UNAVAILABLE')
  expect(current.error).toBeNull(); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('freezes raw owner epoch/slot/active into an explicit new action and preserves deprecated-slot management', async () => {
  await render(); await invoke(() => current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' }))
  const input = h.run.mock.calls[0][0]
  expect(input.startNew).toBe(true); expect(input.plan).toMatchObject({ author: id(4), ownershipEpoch: '2', grantId: null, expectedActive: null,
    expectedSlot: SoulContentSlotPublicBcs.serialize(h.proof.snapshot.contentVersions[0].slot).toBase64() })
  expect(current.pending).toBe(false); expect(h.success).toHaveBeenCalledOnce(); expect(globalThis.fetch).not.toHaveBeenCalled()
})
it('selects the current scoped grantee from raw state, not a stale role or account-member list', async () => {
  h.proof.snapshot.currentOwner = id(9); h.proof.snapshot.grants = [{ slot: { grant_id: id(22), grantee: id(4), scope_mask: '8' },
    currentEpoch: true, unexpiredAtObservation: true, grant: {} }]
  await render(); await invoke(() => current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' }))
  expect(h.run.mock.calls[0][0].plan.grantId).toBe(id(22))
})
it.each(['visitor', 'expired', 'old-epoch', 'wrong-scope', 'purge-grantee', 'active-grantee'])('rejects %s before transaction preparation', async mode => {
  h.proof.snapshot.currentOwner = id(9)
  if (mode !== 'visitor') h.proof.snapshot.grants = [{ slot: { grant_id: id(22), grantee: id(4), scope_mask: mode === 'wrong-scope' ? '1' : '8' },
    currentEpoch: mode !== 'old-epoch', unexpiredAtObservation: mode !== 'expired', grant: {} }]
  await render()
  await invoke(async () => { await expect(current.mutate(mode === 'purge-grantee' ? 'purge' : mode === 'active-grantee' ? 'set-active' : 'delete',
    3, { name: 'sprite', versionIndex: '0' })).rejects.toThrow() })
  expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it.each(['active-delete', 'not-deleted-purge', 'deleted-activate', 'already-active', 'empty-clear'])('rejects %s without a new packet', async mode => {
  if (mode === 'active-delete' || mode === 'already-active') h.proof.snapshot.activeBindings = [{ kind: 3, name: 'sprite', version_index: '0' }]
  if (mode === 'deleted-activate') h.proof.snapshot.contentVersions[0].slot.deleted = true
  await render()
  await invoke(async () => { await expect(current.mutate(mode === 'not-deleted-purge' ? 'purge' : mode === 'active-delete' ? 'delete'
    : mode === 'empty-clear' ? 'clear-active' : 'set-active', 3, mode === 'empty-clear' ? null : { name: 'sprite', versionIndex: '0' })).rejects.toThrow() })
  expect(h.run).not.toHaveBeenCalled()
})
it.each(['FAILED', 'PENDING', 'MISSING'])('keeps purge modal failure/retry behavior for %s instead of closing on uncertainty', async status => {
  h.proof.snapshot.contentVersions[0].slot.deleted = true
  h.run.mockImplementation(async ({ plan }) => ({ record: record(plan), status }))
  await render(); await invoke(async () => { await expect(current.mutate('purge', 3, { name: 'sprite', versionIndex: '0' })).rejects.toThrow('use its recovery controls') })
  expect(h.success).not.toHaveBeenCalled(); expect(current.error).toContain('use its recovery controls'); expect(current.pending).toBe(false)
})
it('rechecks current raw state and rejects changed frozen epoch before signing', async () => {
  h.run.mockImplementation(async input => { h.proof.snapshot.ownershipEpoch = '4'; await input.adapter.preflight(record(input.plan)); throw Error('unreachable') })
  await render(); await invoke(async () => { await expect(current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' })).rejects.toThrow('SCOPE_CHANGED') })
  expect(h.read).toHaveBeenCalledTimes(2); expect(h.sign).not.toHaveBeenCalled()
})
it.each(['wallet', 'account', 'client', 'away-and-back', 'deployment'])('a pending raw read cannot resume after %s identity changes', async mode => {
  await render(); let release!: (v: any) => void, pending!: Promise<unknown>
  h.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' }).catch(e => e) })
  const requested = h.read.mock.calls[0][0]
  if (mode === 'wallet') h.wallet = {}
  else if (mode === 'account') h.account = { address: id(4) }
  else if (mode === 'client') h.client = { grpc: {} }
  else if (mode === 'deployment') h.market = id(40)
  else { h.account = { address: id(5) }; await render(); h.account = { address: id(4) } }
  await render(); expect(requested.signal.aborted).toBe(true)
  await act(async () => { release(h.proof); expect(await pending).toBeInstanceOf(Error) })
  expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled(); expect(current.error).toBeNull()
})
it('rejects same-tick repeated clicks and another pending content action', async () => {
  await render(); let release!: (v: any) => void, pending!: Promise<unknown>
  h.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => { pending = current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' }) })
  await expect(current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' })).rejects.toThrow('Another content action')
  await act(async () => { release(h.proof); await pending })
  blocked = true; await expect(current.mutate('delete', 3, { name: 'sprite', versionIndex: '0' })).rejects.toThrow('Another content action')
  expect(h.run).toHaveBeenCalledOnce()
})
it.each(['resume', 'cancel'])('%s refuses a stale selected recovery head before runner writes', async action => {
  const r = record(); h.saved = { ...r, packet: { ...r.packet, digest: 'new-digest' } }
  await render(); await invoke(async () => { await expect(current[action](r as any)).rejects.toThrow('Recovery head changed') })
  expect(h.run).not.toHaveBeenCalled()
})
it.each(['resume', 'cancel'])('%s uses the existing frozen plan without startNew', async action => {
  const r = record(); h.saved = r
  await render(); await invoke(() => current[action](r as any))
  expect(h.run.mock.calls[0][0]).toMatchObject({ plan: r.plan, ...(action === 'cancel' ? { cancelUnsigned: true } : {}) })
  expect(h.run.mock.calls[0][0].startNew).toBeUndefined(); expect(h.read).not.toHaveBeenCalled()
  expect(h.run.mock.calls[0][0].expectedPacket).toEqual({ bytes: r.packet.bytes, digest: r.packet.digest })
})
it('storage events discover a new packet without starting execution', async () => {
  await render(); h.records = [record()]
  await act(async () => { window.dispatchEvent(new Event('storage')) })
  expect(current.records).toHaveLength(1); expect(h.run).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('copies the selected version before an asynchronous raw read', async () => {
  await render(); let release!: (v: any) => void, pending!: Promise<unknown>
  h.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const target = { name: 'sprite', versionIndex: '0' }
  await act(async () => { pending = current.mutate('delete', 3, target) })
  target.name = 'mutated-by-caller'
  await act(async () => { release(h.proof); await pending })
  expect(h.run.mock.calls[0][0].plan.target).toEqual({ name: 'sprite', versionIndex: '0' })
})
it('manual refresh failure is visible without deleting the previously discovered records', async () => {
  h.records = [record()]; await render()
  h.discover.mockImplementationOnce(() => { throw Error('storage unavailable') })
  await invoke(async () => { await expect(current.refresh()).rejects.toThrow('storage unavailable') })
  expect(current.error).toBe('storage unavailable'); expect(current.records).toHaveLength(1)
})
