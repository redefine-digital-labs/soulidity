// @vitest-environment jsdom
// Real React Query cache + actual hook/coordinator. Only wallet/config and the
// three lower reader transports are controlled; no mock useQuery lifecycle.
import React, { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMySouls } from '../../web/lib/hooks/use-my-souls'
import { MY_SOULS_SECTIONS } from '../../web/lib/soulidity/browser-my-souls'
import { deferred, id, mySoulsFixture } from './fixtures/my-souls'

type Fixture = ReturnType<typeof mySoulsFixture>
const h = vi.hoisted(() => ({ account: null as { address: string } | null, wallet: {} as object | null,
  client: { grpc: {} } as { grpc?: object }, config: null as any, configError: null as string | null,
  create: vi.fn(), configure: null as null | ((f: Fixture) => void), scans: [] as Array<Fixture & { params: any; reader: any }> }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }), useSuiClient: () => h.client }))
vi.mock('../../web/lib/soulidity/browser-soul-detail', async importOriginal => ({
  ...await importOriginal<typeof import('../../web/lib/soulidity/browser-soul-detail')>(),
  getBrowserSoulDetailConfig: () => { if (h.configError) throw new Error(h.configError); return h.config },
}))
vi.mock('../../web/lib/soulidity/browser-my-souls', async importOriginal => {
  const original = await importOriginal<typeof import('../../web/lib/soulidity/browser-my-souls')>()
  return { ...original, createBrowserMySouls: (...args: Parameters<typeof original.createBrowserMySouls>) => h.create(original.createBrowserMySouls, ...args) }
})

let root: Root, host: HTMLDivElement, queryClient: QueryClient, current: ReturnType<typeof useMySouls>, unmounted: boolean
const snapshots: Array<{ owner: string | null; dataOwner: string | undefined; identity: string }> = []
function Probe() {
  current = useMySouls(); snapshots.push({ owner: current.owner, dataOwner: current.data?.owner, identity: current.identityKey })
  return <div>{current.data?.collections.map(row => <p key={row.collectionId}>{current.data?.owner}:{row.name}</p>)}
    <span>{current.error?.message}</span></div>
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 12)) }) }
const render = async (strict = false) => {
  await act(async () => root.render(<QueryClientProvider client={queryClient}>{strict ? <StrictMode><Probe /></StrictMode> : <Probe />}</QueryClientProvider>))
  await settle()
}
const latest = () => h.scans.at(-1)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); h.scans.length = 0; snapshots.length = 0
  h.account = { address: id(5) }; h.wallet = {}; h.client = { grpc: {} }; h.config = mySoulsFixture().config; h.configError = null; h.configure = null
  h.create.mockImplementation((create, params, dependencies) => {
    const f = mySoulsFixture(params.owner); h.configure?.(f)
    const reader = create(params, { ...dependencies, ...f.factories }); h.scans.push({ ...f, params, reader }); return reader
  })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); unmounted = false
})
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount())
  queryClient.clear(); host.remove(); vi.unstubAllGlobals()
})

it('automatically progresses all three actual coordinator channels through every cumulative page', async () => {
  h.configure = f => {
    f.reads.owned.mockResolvedValueOnce(f.owned('PARTIAL'))
    f.reads.collections.mockResolvedValueOnce(f.collections('PARTIAL', 1)).mockResolvedValue(f.collections('COMPLETE', 2))
    f.reads.activity.mockResolvedValueOnce(f.activity('PARTIAL', 1)).mockResolvedValue(f.activity('COMPLETE', 2))
  }
  await render()
  expect(current.data?.coverage).toEqual({ owned: 'COMPLETE', collections: 'COMPLETE', activity: 'COMPLETE' })
  expect(current.data?.collections).toHaveLength(2); expect(current.data?.grants).toHaveLength(2); expect(current.data?.purchases).toHaveLength(2)
  for (const section of MY_SOULS_SECTIONS) { expect(latest().reads[section]).toHaveBeenCalledTimes(2); expect(current.progress?.[section].pages).toBe(2) }
  expect(current.isLoading).toBe(false); expect(current.isFetching).toBe(false)
  expect(h.create.mock.calls[0][1]).toMatchObject({ owner: id(5), config: h.config })
  expect(h.create.mock.calls[0][2].client()).toBe(h.client.grpc)
  expect(queryClient.getQueryCache().getAll()[0].queryKey[0]).toBe('my-souls')
})
it('publishes independent completed channels while Owned remains in flight, not an empty portfolio', async () => {
  const late = deferred<ReturnType<Fixture['owned']>>()
  h.configure = f => { f.reads.owned.mockReturnValueOnce(late.promise) }; await render()
  expect(current.data?.owned).toEqual([]); expect(current.progress?.owned).toMatchObject({ status: 'UNSCANNED', busy: true })
  expect(current.data?.collections).toHaveLength(1); expect(current.data?.grants).toHaveLength(1); expect(current.isFetching).toBe(true)
  await act(async () => late.resolve(latest().owned())); await settle()
  expect(current.progress?.owned.status).toBe('COMPLETE')
})
it('pauses one channel, retains other data, and resumes the same late flight without duplicate advancement', async () => {
  const late = deferred<ReturnType<Fixture['owned']>>()
  h.configure = f => { f.reads.owned.mockReturnValueOnce(late.promise) }; await render(); const first = latest()
  await act(async () => current.pause('owned')); await settle()
  expect(current.progress?.owned).toMatchObject({ busy: false, error: null, pages: 0 })
  expect(current.isFetching).toBe(false); expect(current.data?.collections).toHaveLength(1)
  let resumed!: Promise<void>
  await act(async () => { resumed = current.resume('owned'); await Promise.resolve() })
  expect(first.reads.owned).toHaveBeenCalledOnce()
  await act(async () => { late.resolve(first.owned('PARTIAL')); await resumed }); await settle()
  expect(first.reads.owned).toHaveBeenCalledTimes(2); expect(first.reads.collections).toHaveBeenCalledOnce(); expect(first.reads.activity).toHaveBeenCalledOnce()
  expect(h.create).toHaveBeenCalledOnce(); expect(current.progress?.owned).toMatchObject({ pages: 2, status: 'COMPLETE' })
})
it.each(MY_SOULS_SECTIONS)('stops an errored %s channel and resumes it without discarding other completed scans', async section => {
  h.configure = f => { f.reads[section].mockRejectedValueOnce(new Error('reader offline')) }; await render(); const first = latest()
  expect(current.progress?.[section]).toMatchObject({ pages: 0, error: 'reader offline', status: 'UNSCANNED' })
  await act(async () => current.resume(section)); await settle()
  expect(current.progress?.[section]).toMatchObject({ pages: 1, error: null, status: 'COMPLETE' })
  expect(h.create).toHaveBeenCalledOnce(); expect(first.reads[section]).toHaveBeenCalledTimes(2)
  for (const other of MY_SOULS_SECTIONS.filter(name => name !== section)) expect(first.reads[other]).toHaveBeenCalledOnce()
})
it('terminal limits stop automatic progress and manual resume without silently marking complete', async () => {
  h.configure = f => { f.reads.collections.mockResolvedValue(f.collections('LIMIT_REACHED')) }; await render()
  expect(current.progress?.collections.status).toBe('LIMIT_REACHED'); expect(current.data?.totals.listedComplete).toBe(false)
  await act(async () => current.resume('collections')); expect(latest().reads.collections).toHaveBeenCalledOnce()
})
it.each(['prefix', 'refresh'] as const)('%s invalidation replaces all completed scans in the real QueryClient', async action => {
  await render(); const first = latest(), identity = current.identityKey
  await act(async () => action === 'prefix' ? queryClient.invalidateQueries({ queryKey: ['my-souls'] }) : current.refresh()); await settle()
  expect(h.create).toHaveBeenCalledTimes(2); expect(first.params.signal.aborted).toBe(true); expect(current.identityKey).not.toBe(identity)
  for (const section of MY_SOULS_SECTIONS) expect(latest().reads[section]).toHaveBeenCalledOnce()
  expect(current.data?.coverage).toEqual({ owned: 'COMPLETE', collections: 'COMPLETE', activity: 'COMPLETE' })
})
it('prefix invalidation replaces pending scans and excludes their late result from the new cache', async () => {
  const late = deferred<ReturnType<Fixture['collections']>>()
  h.configure = f => { if (h.scans.length === 0) f.reads.collections.mockReturnValueOnce(late.promise) }; await render(); const first = latest()
  expect(current.isFetching).toBe(true)
  await act(async () => queryClient.invalidateQueries({ queryKey: ['my-souls'] })); await settle()
  expect(h.create).toHaveBeenCalledTimes(2); expect(first.params.signal.aborted).toBe(true)
  await act(async () => late.resolve(first.collections('COMPLETE', 8))); await settle()
  expect(current.data?.collections).toHaveLength(1); expect(current.progress?.collections.pages).toBe(1)
})
it('keeps StrictMode setup/cleanup replay usable and cancels every retired reader', async () => {
  const pending: Array<{ f: Fixture; gate: ReturnType<typeof deferred<ReturnType<Fixture['owned']>>> }> = []
  h.configure = f => { const gate = deferred<ReturnType<Fixture['owned']>>(); f.reads.owned.mockReturnValueOnce(gate.promise); pending.push({ f, gate }) }
  await render(true)
  await act(async () => { for (const row of pending) row.gate.resolve(row.f.owned()) }); await settle()
  expect(current.progress?.owned.status).toBe('COMPLETE'); expect(current.error).toBeNull()
  expect(latest().params.signal.aborted).toBe(false)
  for (const retired of h.scans.slice(0, -1)) expect(retired.params.signal.aborted).toBe(true)
})
it('masks A→B→A data synchronously and ignores the first As late flight', async () => {
  const late = deferred<ReturnType<Fixture['collections']>>(), originalAccount = h.account
  h.configure = f => { if (h.scans.length === 0) f.reads.collections.mockReturnValueOnce(late.promise) }; await render(); const first = latest(), oldKey = current.identityKey
  h.account = { address: id(6) }; await render(); expect(current.data?.owner).toBe(id(6))
  h.account = originalAccount; await render(); expect(current.data?.owner).toBe(id(5)); expect(current.identityKey).not.toBe(oldKey)
  await act(async () => late.resolve(first.collections('COMPLETE', 9))); await settle()
  expect(current.data?.collections).toHaveLength(1); expect(first.params.signal.aborted).toBe(true)
  expect(snapshots.every(snapshot => snapshot.dataOwner === undefined || snapshot.owner === snapshot.dataOwner)).toBe(true)
})
it.each(['account', 'wallet', 'client', 'config'] as const)('replaces a same-address scope when its %s identity changes', async changed => {
  await render(); const first = latest(), oldKey = current.identityKey
  if (changed === 'account') h.account = { address: id(5) }
  else if (changed === 'wallet') h.wallet = {}
  else if (changed === 'client') h.client = { grpc: {} }
  else h.config = { ...h.config, kindRegistryId: id(777) }
  await render()
  expect(h.create).toHaveBeenCalledTimes(2); expect(first.params.signal.aborted).toBe(true); expect(current.identityKey).not.toBe(oldKey)
  expect(current.data?.owner).toBe(id(5))
})
it.each(['pause', 'resume', 'refresh'] as const)('stale %s actions cannot modify a new pending scope', async action => {
  await render(); const stale = current[action]
  const late = deferred<ReturnType<Fixture['owned']>>()
  h.configure = f => { f.reads.owned.mockReturnValueOnce(late.promise) }; h.account = { address: id(6) }; await render(); const fresh = latest()
  await act(async () => { if (action === 'refresh') await (stale as typeof current.refresh)(); else await (stale as typeof current.resume)('owned') })
  expect(h.create).toHaveBeenCalledTimes(2); expect(fresh.reads.owned).toHaveBeenCalledOnce(); expect(current.progress?.owned.busy).toBe(true)
  expect(fresh.reads.owned.mock.calls[0][0]?.signal?.aborted).toBe(false)
  await act(async () => late.resolve(fresh.owned())); await settle(); expect(current.progress?.owned.status).toBe('COMPLETE')
})
it('stale same-scope refresh actions cannot restart a newer refresh generation', async () => {
  await render(); const stale = current.refresh
  await act(async () => current.refresh()); await settle(); const second = latest()
  await act(async () => stale()); await settle()
  expect(h.create).toHaveBeenCalledTimes(2); expect(latest()).toBe(second)
})
it.each(['account', 'wallet'] as const)('disconnecting %s clears rows and cancels pending work', async disconnected => {
  const late = deferred<ReturnType<Fixture['owned']>>()
  h.configure = f => { f.reads.owned.mockReturnValueOnce(late.promise) }; await render(); const first = latest(), stale = current.refresh
  if (disconnected === 'account') h.account = null; else h.wallet = null
  await render()
  expect(current.connected).toBe(false); expect(current.data).toBeUndefined(); expect(current.snapshot).toBeUndefined(); expect(current.error).toBeNull()
  expect(host.textContent).not.toContain('Sold Collection'); expect(first.params.signal.aborted).toBe(true)
  await act(async () => { late.resolve(first.owned()); await stale() }); await settle()
  expect(current.data).toBeUndefined(); expect(h.create).toHaveBeenCalledOnce()
})
it('unmount aborts active readers and makes late publication and stale actions inert', async () => {
  const late = deferred<ReturnType<Fixture['owned']>>()
  h.configure = f => { f.reads.owned.mockReturnValueOnce(late.promise) }; await render(); const first = latest(), stale = current
  await act(async () => root.unmount()); unmounted = true
  const writes = vi.spyOn(queryClient, 'setQueryData')
  await act(async () => { late.resolve(first.owned()); await stale.refresh(); await stale.resume('owned'); stale.pause('owned') }); await settle()
  expect(first.params.signal.aborted).toBe(true); expect(writes).not.toHaveBeenCalled(); expect(h.create).toHaveBeenCalledOnce()
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
})
it.each(['config', 'grpc'] as const)('shows a %s setup error and can recover after its actual dependency changes', async broken => {
  if (broken === 'config') h.configError = 'release tuple unavailable'; else h.client = {}
  await render()
  expect(current.error?.message).toContain(broken === 'config' ? 'release tuple unavailable' : 'Reconnect')
  expect(current.data).toBeUndefined(); expect(h.create).not.toHaveBeenCalled()
  h.configError = null; h.client = { grpc: {} }; await render()
  expect(current.error).toBeNull(); expect(current.data?.collections).toHaveLength(1)
})
it('missing discovery remains an explicit per-channel error, not an empty complete portfolio', async () => {
  h.config.discoveryEndpoint = null; await render()
  expect(current.progress?.owned.status).toBe('COMPLETE')
  expect(current.progress?.collections).toMatchObject({ status: 'UNSCANNED', error: 'MY_SOULS_DISCOVERY_UNAVAILABLE' })
  expect(current.progress?.activity).toMatchObject({ status: 'UNSCANNED', error: 'MY_SOULS_DISCOVERY_UNAVAILABLE' })
  expect(current.data?.totals.listedValueAtomic).toBeNull()
})
