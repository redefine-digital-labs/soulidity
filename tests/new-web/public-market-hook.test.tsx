// @vitest-environment jsdom
// Actual hooks, actual React Query and actual selectors. Most cases control the
// two scanner boundaries and creator service; the final case also runs the real
// Soul scanner and raw readers over the existing controlled RPC graph.
import React, { act, StrictMode, Suspense, startTransition } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { usePublicSoulsMarket, usePublicCollectionsMarket } from '../../web/lib/hooks/use-public-market'
import type { BrowserMarketSoulsPage, createBrowserMarketSouls } from '../../web/lib/soulidity/browser-market-souls'
import type { CollectionMarketDiscoveryResult } from '../../packages/soulidity-sdk/src/collection-market-discovery'
import type { BrowserSoulDetailConfig } from '../../web/lib/soulidity/browser-soul-detail'
import type { BrowserProfileConfig } from '../../web/lib/profile/profile-config'
import type { MarketCreatorIdentity, SoulsListParams, CollectionsListParams } from '../../web/lib/soulidity/public-market-model'
import { publicMarketFixture, deferred, id } from './fixtures/public-market'
import { marketSoulRawFixture } from './fixtures/browser-market-souls'

type SoulResult = ReturnType<typeof usePublicSoulsMarket>
type CollectionResult = ReturnType<typeof usePublicCollectionsMarket>
type Next<P> = Mock<(options: { signal?: AbortSignal }) => Promise<P>>
type Session<P> = { params: { viewerAddress: string | null; signal: AbortSignal }; next: Next<P> }
type CreatorSession = { params: { signal: AbortSignal }; read: Mock<(owners: readonly string[], options?: { signal?: AbortSignal; retryFailed?: boolean }) => Promise<Readonly<Record<string, MarketCreatorIdentity>>>> }
const h = vi.hoisted(() => ({ account: null as { address: string } | null, wallet: null as object | null,
  client: { grpc: { core: {} } } as { grpc?: object }, config: null as BrowserSoulDetailConfig | null,
  profileConfig: null as BrowserProfileConfig | null, configError: null as string | null, profileError: null as string | null,
  souls: [] as Session<BrowserMarketSoulsPage>[], collections: [] as Session<CollectionMarketDiscoveryResult>[], creators: [] as CreatorSession[],
  soulFactory: vi.fn(), collectionFactory: vi.fn(), creatorFactory: vi.fn(),
  configureSoul: null as ((session: Session<BrowserMarketSoulsPage>, index: number) => void) | null,
  configureCollection: null as ((session: Session<CollectionMarketDiscoveryResult>, index: number) => void) | null,
  configureCreator: null as ((session: CreatorSession, index: number) => void) | null,
}))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }), useSuiClient: () => h.client }))
vi.mock('../../web/lib/soulidity/browser-soul-detail', async original => ({
  ...await original<typeof import('../../web/lib/soulidity/browser-soul-detail')>(),
  getBrowserSoulDetailConfig: () => { if (h.configError) throw new Error(h.configError); return h.config },
}))
vi.mock('../../web/lib/profile/profile-config', async original => ({
  ...await original<typeof import('../../web/lib/profile/profile-config')>(),
  getBrowserProfileConfig: () => { if (h.profileError) throw new Error(h.profileError); return h.profileConfig },
}))
vi.mock('../../web/lib/soulidity/browser-market-souls', async original => {
  const real = await original<typeof import('../../web/lib/soulidity/browser-market-souls')>()
  return { ...real, createBrowserMarketSouls: (...args: Parameters<typeof real.createBrowserMarketSouls>) => h.soulFactory(real.createBrowserMarketSouls, ...args) }
})
vi.mock('@soulidity/sdk', async original => ({ ...await original<typeof import('@soulidity/sdk')>(),
  createCollectionMarketDiscovery: (...args: unknown[]) => h.collectionFactory(...args),
}))
vi.mock('../../web/lib/soulidity/market-creators', () => ({ createMarketCreatorReader: (...args: unknown[]) => h.creatorFactory(...args) }))

let f: Awaited<ReturnType<typeof publicMarketFixture>>, root: Root, host: HTMLDivElement, query: QueryClient, unmounted: boolean
let souls: SoulResult, collections: CollectionResult, soulParams: SoulsListParams, collectionParams: CollectionsListParams
const renders: Array<{ viewer: string | null; rowViewers: (string | null)[] }> = []
const capturedActions: Array<{ souls: SoulResult; collections: CollectionResult }> = []
function Probe({ suspend }: { suspend?: Promise<void> }) {
  souls = usePublicSoulsMarket(soulParams); collections = usePublicCollectionsMarket(collectionParams)
  capturedActions.push({ souls, collections })
  renders.push({ viewer: souls.viewerAddress, rowViewers: souls.data?.items.map(row => row.viewerAddress) ?? [] })
  if (suspend) throw suspend
  return <div><span>{souls.progress.coverage}:{souls.error?.message}:{souls.creators.error?.message}</span>
    {souls.data?.items.map(row => <p key={row.onChainId}>{row.name}:{row.creatorIdentity?.displayName}</p>)}
    <span>{collections.progress.coverage}:{collections.error?.message}</span>
    {collections.data?.items.map(row => <p key={row.collectionId}>{row.name}</p>)}</div>
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 12)) }) }
async function render(strict = false) {
  await act(async () => root.render(<QueryClientProvider client={query}><Suspense fallback="Waiting">{strict ? <StrictMode><Probe /></StrictMode> : <Probe />}</Suspense></QueryClientProvider>))
  await settle()
}
const latestSoul = () => h.souls.at(-1)!, latestCollection = () => h.collections.at(-1)!, latestCreator = () => h.creators.at(-1)!
const identity = (address: string, status: MarketCreatorIdentity['status'] = 'VERIFIED', displayName = 'Alice', handle = 'alice'):
  MarketCreatorIdentity => ({ address, status, profileId: status === 'VERIFIED' ? id(4000) : null,
    displayName: status === 'VERIFIED' ? displayName : null, handle: status === 'VERIFIED' ? handle : null,
    error: status === 'UNAVAILABLE' ? 'metadata unavailable' : null })
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // JSDOM installs another Uint8Array realm while Node structuredClone returns
  // host byte arrays. Match the host encoder/SDK realm for actual raw fixtures.
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); unmounted = false
  f = await publicMarketFixture(); h.account = null; h.wallet = null; h.client = { grpc: { core: {} } }
  h.config = structuredClone(f.config); h.profileConfig = structuredClone(f.profileConfig); h.configError = null; h.profileError = null
  h.souls.length = 0; h.collections.length = 0; h.creators.length = 0; renders.length = 0; capturedActions.length = 0
  h.configureSoul = null; h.configureCollection = null; h.configureCreator = null
  h.soulFactory.mockReset().mockImplementation((_real, params) => {
    const session: Session<BrowserMarketSoulsPage> = { params, next: vi.fn().mockResolvedValue(f.souls([f.soul(300, { viewerAddress: params.viewerAddress })])) }
    h.configureSoul?.(session, h.souls.length); h.souls.push(session); return session
  })
  h.collectionFactory.mockReset().mockImplementation(params => {
    const session: Session<CollectionMarketDiscoveryResult> = { params, next: vi.fn().mockResolvedValue(f.collections([f.collection(500,
      { creatorAddress: id(800), currentHolderAddress: id(801), relationship: 'UNRELATED' })])) }
    h.configureCollection?.(session, h.collections.length); h.collections.push(session); return session
  })
  h.creatorFactory.mockReset().mockImplementation(params => {
    const session: CreatorSession = { params, read: vi.fn(async owners => Object.fromEntries(owners.map(owner => [owner, identity(owner, 'ABSENT')]))) }
    h.configureCreator?.(session, h.creators.length); h.creators.push(session)
    return { read: session.read, snapshot: () => ({}) }
  })
  soulParams = {}; collectionParams = {}
})
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount())
  query.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('anonymous defaults mount both independent public sources without a wallet or private identity', async () => {
  await render()
  expect(souls.viewerAddress).toBeNull(); expect(collections.viewerAddress).toBeNull()
  expect(souls.data).toMatchObject({ complete: true, total: 1, pageSize: 12, notAuthorization: true })
  expect(collections.data).toMatchObject({ complete: true, total: 1, pageSize: 12, notAuthorization: true })
  expect(latestSoul().params.viewerAddress).toBeNull(); expect(latestCollection().params.viewerAddress).toBeNull()
  expect(h.soulFactory).toHaveBeenCalledOnce(); expect(h.collectionFactory).toHaveBeenCalledOnce()
  expect(souls.error).toBeNull(); expect(collections.error).toBeNull()
  expect(query.getQueryCache().getAll().some(q => q.queryKey[0] === 'souls')).toBe(true)
  expect(query.getQueryCache().getAll().some(q => q.queryKey[0] === 'collections')).toBe(true)
})
it('an abandoned wallet render cannot revoke the committed scan or its controls', async () => {
  await render()
  const committed = souls, scan = latestSoul(), client = h.client
  const suspended = new Promise<void>(() => {})
  h.client = { grpc: { core: {} } }
  await act(async () => { startTransition(() => root.render(<QueryClientProvider client={query}><Suspense fallback="Waiting"><Probe suspend={suspended} /></Suspense></QueryClientProvider>)) })
  expect(scan.params.signal.aborted).toBe(false)
  expect(h.soulFactory).toHaveBeenCalledOnce()
  h.client = client
  await render()
  expect(souls.identityKey).toBe(committed.identityKey)
  expect(scan.params.signal.aborted).toBe(false)
  await act(async () => committed.refresh()); await settle()
  expect(h.soulFactory).toHaveBeenCalledTimes(2)
})
it.each(['souls', 'collections'] as const)('the other source completes while %s remains in flight', async kind => {
  const gate = deferred<BrowserMarketSoulsPage | CollectionMarketDiscoveryResult>()
  if (kind === 'souls') h.configureSoul = s => { s.next.mockReturnValueOnce(gate.promise as Promise<BrowserMarketSoulsPage>) }
  else h.configureCollection = s => { s.next.mockReturnValueOnce(gate.promise as Promise<CollectionMarketDiscoveryResult>) }
  await render()
  const pending = kind === 'souls' ? souls : collections, done = kind === 'souls' ? collections : souls
  expect(pending.progress).toMatchObject({ coverage: 'UNSCANNED', busy: true }); expect(pending.data?.complete).toBe(false)
  expect(done.data).toMatchObject({ complete: true, total: 1 })
  await act(async () => gate.resolve(kind === 'souls' ? f.souls() : f.collections())); await settle()
  expect((kind === 'souls' ? souls : collections).progress).toMatchObject({ coverage: 'COMPLETE', busy: false })
})
it('filters and sorts all accumulated rows before page slicing without restarting either scanner or creator reader', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => f.soul(300 + i, { name: i >= 15 ? `wanted ${i}` : `other ${i}`,
    tags: i >= 15 ? ['Target'] : ['Other'], personaKind: i >= 15 ? 'characters' : 'agents', listedPriceAtomic: String(100 + i) }))
  const cards = Array.from({ length: 20 }, (_, i) => f.collection(500 + i, { name: i >= 15 ? `wanted ${i}` : `other ${i}`,
    status: i >= 15 ? 'LISTED' : 'HELD', priceAtomic: i >= 15 ? String(100 + i) : null }))
  h.configureSoul = s => { s.next.mockResolvedValueOnce(f.souls(rows.slice(0, 10), 'PARTIAL')).mockResolvedValue(f.souls(rows)) }
  h.configureCollection = s => { s.next.mockResolvedValueOnce(f.collections(cards.slice(0, 10), 'PARTIAL')).mockResolvedValue(f.collections(cards)) }
  await render(); const creatorCount = h.creatorFactory.mock.calls.length
  soulParams = { q: 'wanted', tag: 'target', persona: 'characters', minPrice: '115', maxPrice: '119', sort: 'price_asc', page: 2, pageSize: 2 }
  collectionParams = { q: 'wanted', listed: true, page: 2, pageSize: 2 }; await render()
  expect(souls.data).toMatchObject({ total: 5, totalPages: 3, page: 2 }); expect(souls.data?.items.map(s => s.onChainId)).toEqual([id(317), id(318)])
  expect(collections.data).toMatchObject({ total: 5, totalPages: 3, page: 2 }); expect(collections.data?.items.map(c => c.collectionId)).toEqual([id(517), id(518)])
  expect(h.soulFactory).toHaveBeenCalledOnce(); expect(h.collectionFactory).toHaveBeenCalledOnce()
  expect(latestSoul().next).toHaveBeenCalledTimes(2); expect(latestCollection().next).toHaveBeenCalledTimes(2)
  expect(h.creatorFactory).toHaveBeenCalledTimes(creatorCount)
})
it.each(['souls', 'collections'] as const)('prefix %s invalidation refreshes only that completed source', async kind => {
  await render(); const oldSoul = latestSoul(), oldCollection = latestCollection(), oldIdentity = (kind === 'souls' ? souls : collections).identityKey
  await act(async () => query.invalidateQueries({ queryKey: [kind] })); await settle()
  expect(h.soulFactory).toHaveBeenCalledTimes(kind === 'souls' ? 2 : 1); expect(h.collectionFactory).toHaveBeenCalledTimes(kind === 'collections' ? 2 : 1)
  expect((kind === 'souls' ? oldSoul : oldCollection).params.signal.aborted).toBe(true)
  expect((kind === 'souls' ? souls : collections).identityKey).not.toBe(oldIdentity)
})
it.each(['souls', 'collections'] as const)('prefix %s invalidation replaces in-flight work and excludes its late results', async kind => {
  const gate = deferred<BrowserMarketSoulsPage | CollectionMarketDiscoveryResult>()
  if (kind === 'souls') h.configureSoul = (s, i) => { if (!i) s.next.mockReturnValueOnce(gate.promise as Promise<BrowserMarketSoulsPage>) }
  else h.configureCollection = (s, i) => { if (!i) s.next.mockReturnValueOnce(gate.promise as Promise<CollectionMarketDiscoveryResult>) }
  await render(); const first = kind === 'souls' ? latestSoul() : latestCollection()
  await act(async () => query.invalidateQueries({ queryKey: [kind] })); await settle()
  expect(first.params.signal.aborted).toBe(true)
  await act(async () => gate.resolve(kind === 'souls' ? f.souls([f.soul(999)]) : f.collections([f.collection(999)]))); await settle()
  expect((kind === 'souls' ? souls : collections).data?.items).toHaveLength(1)
  expect(host.textContent).not.toContain('999'); expect((kind === 'souls' ? souls : collections).progress.pages).toBe(1)
})
it('StrictMode setup/cleanup replay remains usable and aborts every retired source', async () => {
  await render(true)
  expect(souls.data?.complete).toBe(true); expect(collections.data?.complete).toBe(true)
  expect(souls.error).toBeNull(); expect(collections.error).toBeNull()
  for (const session of h.souls.slice(0, -1)) expect(session.params.signal.aborted).toBe(true)
  for (const session of h.collections.slice(0, -1)) expect(session.params.signal.aborted).toBe(true)
  expect(latestSoul().params.signal.aborted).toBe(false); expect(latestCollection().params.signal.aborted).toBe(false)
})
it.each(['address', 'account', 'wallet', 'client', 'release'] as const)('%s A→B→A cannot reactivate old pages or callbacks', async kind => {
  h.account = { address: id(5) }; h.wallet = {}
  const oldInputs = { account: h.account, wallet: h.wallet, client: h.client, config: h.config }, gate = deferred<BrowserMarketSoulsPage>()
  h.configureSoul = (s, i) => { if (!i) s.next.mockReturnValueOnce(gate.promise) }
  await render(); const first = latestSoul(), old = souls, oldCollections = collections
  if (kind === 'address') h.account = { address: id(6) }
  if (kind === 'account') h.account = { address: id(5) }
  if (kind === 'wallet') h.wallet = {}
  if (kind === 'client') h.client = { grpc: { core: {} } }
  if (kind === 'release') h.config = { ...h.config!, kindRegistryId: id(777) }
  await render(); Object.assign(h, oldInputs); await render(); const newSoul = latestSoul(), newCollection = latestCollection()
  await act(async () => { old.pause(); await old.resume(); await old.refresh(); await old.creators.retry()
    oldCollections.pause(); await oldCollections.resume(); await oldCollections.refresh(); gate.resolve(f.souls([f.soul(999, { viewerAddress: id(5) })])) })
  await settle()
  expect(latestSoul()).toBe(newSoul); expect(latestCollection()).toBe(newCollection); expect(first.params.signal.aborted).toBe(true)
  expect(h.soulFactory).toHaveBeenCalledTimes(3); expect(h.collectionFactory).toHaveBeenCalledTimes(3)
  expect(souls.identityKey).not.toBe(old.identityKey); expect(host.textContent).not.toContain('999')
  expect(renders.every(row => row.rowViewers.every(viewer => viewer === row.viewer))).toBe(true)
})
it.each(['pause', 'resume', 'refresh', 'creatorRetry'] as const)('old %s reference cannot modify a replacement pending source', async action => {
  await render(); const old = souls, gate = deferred<BrowserMarketSoulsPage>()
  h.configureSoul = s => { s.next.mockReturnValueOnce(gate.promise) }; h.client = { grpc: { core: {} } }; await render()
  const fresh = latestSoul(), creatorsBefore = h.creators.reduce((n, s) => n + s.read.mock.calls.length, 0)
  await act(async () => { if (action === 'creatorRetry') await old.creators.retry(); else await old[action]() })
  expect(latestSoul()).toBe(fresh); expect(fresh.next).toHaveBeenCalledOnce(); expect(souls.progress.busy).toBe(true)
  expect(fresh.next.mock.calls[0][0].signal?.aborted).toBe(false)
  expect(h.creators.reduce((n, s) => n + s.read.mock.calls.length, 0)).toBe(creatorsBefore)
  await act(async () => gate.resolve(f.souls())); await settle()
})
it('stale same-scope refresh and creator retry cannot affect a newer refreshed session', async () => {
  await render(); const old = souls
  await act(async () => souls.refresh()); await settle(); const second = latestSoul(), creator = latestCreator()
  await act(async () => { await old.refresh(); await old.creators.retry() }); await settle()
  expect(h.soulFactory).toHaveBeenCalledTimes(2); expect(latestSoul()).toBe(second); expect(creator.read).toHaveBeenCalledOnce()
})
it.each(['souls', 'collections'] as const)('the first-render %s refresh reference cannot restart a later same-scope session', async kind => {
  await render(); const old = capturedActions[0][kind].refresh
  await act(async () => (kind === 'souls' ? souls : collections).refresh()); await settle()
  const count = (kind === 'souls' ? h.soulFactory : h.collectionFactory).mock.calls.length
  await act(async () => old()); await settle()
  expect(kind === 'souls' ? h.soulFactory : h.collectionFactory).toHaveBeenCalledTimes(count)
})
it.each(['souls', 'collections'] as const)('pause/resume %s joins a late accepted page instead of advancing twice', async kind => {
  const gate = deferred<BrowserMarketSoulsPage | CollectionMarketDiscoveryResult>()
  if (kind === 'souls') h.configureSoul = s => { s.next.mockReturnValueOnce(gate.promise as Promise<BrowserMarketSoulsPage>) }
  else h.configureCollection = s => { s.next.mockReturnValueOnce(gate.promise as Promise<CollectionMarketDiscoveryResult>) }
  await render(); const first = kind === 'souls' ? latestSoul() : latestCollection()
  await act(async () => (kind === 'souls' ? souls : collections).pause()); await settle()
  expect((kind === 'souls' ? souls : collections).progress).toMatchObject({ busy: false, pages: 0 })
  let resumed!: Promise<void>
  await act(async () => { resumed = (kind === 'souls' ? souls : collections).resume(); await Promise.resolve() })
  expect(first.next).toHaveBeenCalledOnce()
  await act(async () => { gate.resolve(kind === 'souls' ? f.souls() : f.collections()); await resumed }); await settle()
  expect(first.next).toHaveBeenCalledOnce(); expect((kind === 'souls' ? souls : collections).data?.complete).toBe(true)
})
it('pause keeps a terminal result that settles before resume without publishing an error or rereading', async () => {
  const gate = deferred<BrowserMarketSoulsPage>(); h.configureSoul = s => { s.next.mockReturnValueOnce(gate.promise) }; await render()
  await act(async () => souls.pause()); await settle(); await act(async () => gate.resolve(f.souls())); await settle()
  await act(async () => souls.resume()); await settle()
  expect(latestSoul().next).toHaveBeenCalledOnce(); expect(souls.progress).toMatchObject({ coverage: 'COMPLETE', pages: 1, busy: false }); expect(souls.error).toBeNull()
})
it.each(['souls', 'collections'] as const)('%s error retries the same reader and retains the other source', async kind => {
  if (kind === 'souls') h.configureSoul = s => { s.next.mockRejectedValueOnce(new Error('raw offline')) }
  else h.configureCollection = s => { s.next.mockRejectedValueOnce(new Error('raw offline')) }
  await render(); expect((kind === 'souls' ? souls : collections).error?.message).toBe('raw offline')
  expect((kind === 'souls' ? souls : collections).data?.complete).toBe(false)
  await act(async () => (kind === 'souls' ? souls : collections).resume()); await settle()
  expect((kind === 'souls' ? souls : collections).error).toBeNull(); expect((kind === 'souls' ? souls : collections).data?.complete).toBe(true)
  expect(h.soulFactory).toHaveBeenCalledOnce(); expect(h.collectionFactory).toHaveBeenCalledOnce()
  expect((kind === 'souls' ? latestSoul() : latestCollection()).next).toHaveBeenCalledTimes(2)
})
it.each(['souls', 'collections'] as const)('%s LIMIT_REACHED never claims completeness or automatically resumes', async kind => {
  if (kind === 'souls') h.configureSoul = s => { s.next.mockResolvedValue(f.souls([f.soul()], 'LIMIT_REACHED')) }
  else h.configureCollection = s => { s.next.mockResolvedValue(f.collections([f.collection()], 'LIMIT_REACHED')) }
  await render(); expect((kind === 'souls' ? souls : collections).data).toMatchObject({ complete: false, total: 1, coverage: 'LIMIT_REACHED' })
  await act(async () => (kind === 'souls' ? souls : collections).resume()); expect((kind === 'souls' ? latestSoul() : latestCollection()).next).toHaveBeenCalledOnce()
})
it.each(['configuration', 'grpc', 'endpoint'] as const)('%s failure is visible and cannot become empty complete Market', async failure => {
  if (failure === 'configuration') h.configError = 'release unavailable'; if (failure === 'grpc') h.client = {}; if (failure === 'endpoint') h.config!.discoveryEndpoint = null
  await render(); expect(souls.error).toBeInstanceOf(Error); expect(collections.error).toBeInstanceOf(Error)
  expect(souls.data?.complete).not.toBe(true); expect(collections.data?.complete).not.toBe(true)
  expect(h.soulFactory).not.toHaveBeenCalled(); expect(h.collectionFactory).not.toHaveBeenCalled()
  h.configError = null; h.config = structuredClone(f.config); h.client = { grpc: { core: {} } }; await render()
  expect(souls.error).toBeNull(); expect(collections.error).toBeNull(); expect(souls.data?.complete).toBe(true)
})
it('creator enrichment starts after scanning stops, handles asynchronous name/handle search and never rescans assets', async () => {
  const address = f.soul().creatorAddress, first = deferred<BrowserMarketSoulsPage>(), metadata = deferred<Readonly<Record<string, MarketCreatorIdentity>>>()
  h.configureSoul = s => { s.next.mockReturnValueOnce(first.promise) }; h.configureCreator = s => { s.read.mockReturnValueOnce(metadata.promise) }
  soulParams = { creator: 'ALICE' }; await render(); expect(h.creatorFactory).not.toHaveBeenCalled()
  await act(async () => first.resolve(f.souls())); await settle()
  expect(souls.creators.loading).toBe(true); expect(souls.data).toMatchObject({ identityIncomplete: true, complete: false, total: 0 })
  await act(async () => metadata.resolve({ [address]: identity(address, 'VERIFIED', 'Alice Example', 'wonderland') })); await settle()
  expect(souls.data).toMatchObject({ identityIncomplete: false, complete: true, total: 1 })
  soulParams = { creator: 'WONDERLAND' }; await render(); expect(souls.data?.total).toBe(1)
  expect(h.soulFactory).toHaveBeenCalledOnce(); expect(latestSoul().next).toHaveBeenCalledOnce(); expect(latestCreator().read).toHaveBeenCalledOnce()
})
it.each(['ABSENT', 'UNAVAILABLE'] as const)('creator %s differs from a verified empty name search and does not hide asset rows', async status => {
  const address = f.soul().creatorAddress
  h.configureCreator = s => { s.read.mockResolvedValue({ [address]: identity(address, status) }) }; await render()
  expect(souls.data?.total).toBe(1); expect(souls.creators.unavailable).toBe(status === 'UNAVAILABLE' ? 1 : 0)
  soulParams = { creator: 'alice' }; await render()
  expect(souls.data).toMatchObject({ total: 0, complete: status === 'ABSENT', identityIncomplete: status === 'UNAVAILABLE' })
  soulParams = { creator: address }; await render(); expect(souls.data?.total).toBe(1)
})
it.each(['profile-config', 'wrong-release', 'metadata-RPC'] as const)('creator %s failure is explicit, not a missing Profile or empty Market', async failure => {
  if (failure === 'profile-config') h.profileError = 'profile unavailable'
  if (failure === 'wrong-release') h.profileConfig!.deployment.callablePackageId = id(777)
  if (failure === 'metadata-RPC') h.configureCreator = s => { s.read.mockRejectedValueOnce(new Error('metadata RPC unavailable')) }
  await render(); expect(souls.data?.total).toBe(1); expect(souls.error).toBeNull(); expect(souls.creators.error).toBeInstanceOf(Error)
  soulParams = { creator: 'alice' }; await render(); expect(souls.data).toMatchObject({ complete: false, identityIncomplete: true })
})
it('creator retry reuses the captured reader for unavailable identities without rescanning Soul or Collection', async () => {
  const address = f.soul().creatorAddress
  h.configureCreator = s => { s.read.mockResolvedValueOnce({ [address]: identity(address, 'UNAVAILABLE') }).mockResolvedValue({ [address]: identity(address) }) }
  await render(); expect(souls.creators.unavailable).toBe(1)
  await act(async () => souls.creators.retry()); await settle(); expect(souls.creators.unavailable).toBe(0)
  expect(h.creatorFactory).toHaveBeenCalledOnce(); expect(latestCreator().read).toHaveBeenCalledTimes(2)
  expect(latestCreator().read.mock.calls[1][1]).toMatchObject({ retryFailed: true })
  expect(h.soulFactory).toHaveBeenCalledOnce(); expect(h.collectionFactory).toHaveBeenCalledOnce()
})
it('late creator metadata from a replaced source cannot enter its new query cache', async () => {
  const address = f.soul().creatorAddress, gate = deferred<Readonly<Record<string, MarketCreatorIdentity>>>()
  h.configureCreator = (s, i) => { if (!i) s.read.mockReturnValueOnce(gate.promise) }; await render(); const first = latestCreator()
  await act(async () => souls.refresh()); await settle(); const second = latestCreator()
  expect(second).not.toBe(first); expect(first.params.signal.aborted).toBe(true)
  await act(async () => gate.resolve({ [address]: identity(address, 'VERIFIED', 'STALE CREATOR') })); await settle()
  expect(host.textContent).not.toContain('STALE CREATOR'); expect(souls.data?.items[0].creatorIdentity?.status).toBe('ABSENT')
  const creatorQueries = query.getQueryCache().getAll().filter(q => q.queryKey[0] === 'public-market-creators')
  expect(creatorQueries).toHaveLength(1)
})
it.each(['account', 'wallet', 'client', 'release'] as const)('pending creator metadata and its retry callback stay retired through %s ABA', async kind => {
  h.account = { address: id(5) }; h.wallet = {}
  const address = f.soul().creatorAddress, gate = deferred<Readonly<Record<string, MarketCreatorIdentity>>>()
  h.configureCreator = (s, i) => { if (!i) s.read.mockReturnValueOnce(gate.promise) }
  await render(); const old = souls.creators, first = latestCreator(), inputs = { account: h.account, wallet: h.wallet, client: h.client, config: h.config }
  if (kind === 'account') h.account = { address: id(6) }
  if (kind === 'wallet') h.wallet = {}
  if (kind === 'client') h.client = { grpc: { core: {} } }
  if (kind === 'release') h.config = { ...h.config!, kindRegistryId: id(778) }
  await render(); Object.assign(h, inputs); await render(); const fresh = latestCreator()
  await act(async () => { gate.resolve({ [address]: identity(address, 'VERIFIED', 'STALE ABA') }); await old.retry() }); await settle()
  expect(first.params.signal.aborted).toBe(true); expect(fresh.read).toHaveBeenCalledOnce()
  expect(host.textContent).not.toContain('STALE ABA'); expect(souls.data?.items[0].creatorIdentity?.status).toBe('ABSENT')
})
it('creator-only profile configuration ABA cannot reactivate an old retry callback', async () => {
  await render(); const old = souls.creators, original = h.profileConfig
  h.profileConfig = { ...h.profileConfig!, storage: { ...h.profileConfig!.storage, aggregatorUrl: 'https://other-aggregator.example.com/' } }
  await render(); h.profileConfig = original; await render(); const fresh = latestCreator()
  await act(async () => old.retry()); await settle()
  expect(fresh.read).toHaveBeenCalledOnce(); expect(h.soulFactory).toHaveBeenCalledOnce(); expect(h.collectionFactory).toHaveBeenCalledOnce()
})
it('partial raw failure enriches available creators and successful resume extends the same metadata session', async () => {
  const rows = [f.soul(300), f.soul(301)]
  h.configureSoul = s => { s.next.mockResolvedValueOnce(f.souls(rows.slice(0, 1), 'PARTIAL')).mockRejectedValueOnce(new Error('second raw page failed'))
    .mockResolvedValue(f.souls(rows)) }
  await render(); const creator = latestCreator()
  expect(souls.data).toMatchObject({ total: 1, complete: false, coverage: 'PARTIAL' }); expect(souls.error?.message).toBe('second raw page failed')
  expect(creator.read.mock.calls[0][0]).toEqual([rows[0].creatorAddress])
  await act(async () => souls.resume()); await settle()
  expect(souls.data).toMatchObject({ total: 2, complete: true }); expect(h.creatorFactory).toHaveBeenCalledOnce()
  expect(creator.read.mock.calls[1][0]).toEqual(rows.map(r => r.creatorAddress).sort())
})
it('disconnect starts a fresh anonymous public scope instead of disabling Market', async () => {
  h.account = { address: id(5) }; h.wallet = {}; await render(); const first = latestSoul()
  h.account = null; h.wallet = null; await render()
  expect(first.params.signal.aborted).toBe(true); expect(souls.viewerAddress).toBeNull(); expect(collections.viewerAddress).toBeNull()
  expect(souls.data).toMatchObject({ total: 1, complete: true }); expect(collections.data).toMatchObject({ total: 1, complete: true })
  expect(souls.data?.items[0].viewerAddress).toBeNull()
})
it('unmount aborts source/profile lifetime, retires query keys and makes all retained callbacks inert', async () => {
  const gate = deferred<Readonly<Record<string, MarketCreatorIdentity>>>(); h.configureCreator = s => { s.read.mockReturnValueOnce(gate.promise) }
  await render(); const old = souls, oldCollections = collections, first = latestCreator()
  await act(async () => root.unmount()); unmounted = true; const writes = vi.spyOn(query, 'setQueryData')
  await act(async () => { old.pause(); await old.resume(); await old.refresh(); await old.creators.retry()
    oldCollections.pause(); await oldCollections.resume(); await oldCollections.refresh(); gate.resolve({}) }); await settle()
  expect(latestSoul().params.signal.aborted).toBe(true); expect(latestCollection().params.signal.aborted).toBe(true); expect(first.params.signal.aborted).toBe(true)
  expect(writes).not.toHaveBeenCalled(); expect(query.getQueryCache().getAll()).toHaveLength(0)
})
it('actual hook→actual public Soul scanner→GraphQL/raw BCS readers reaches a real projected anonymous listing', async () => {
  const raw = marketSoulRawFixture(); h.config = raw.config; h.client = { grpc: raw.client }
  h.profileConfig = { ...f.profileConfig, deployment: { ...f.profileConfig.deployment,
    originalPackageId: raw.config.native.soulidityOriginalPackageId, callablePackageId: raw.config.native.soulidityCallablePackageId,
    chainIdentifier: raw.config.chainIdentifier } }
  h.soulFactory.mockImplementation((create: typeof createBrowserMarketSouls, params: Parameters<typeof createBrowserMarketSouls>[0]) => create(params, { fetch: raw.fetcher }))
  await render()
  expect(souls.error).toBeNull(); expect(souls.progress).toMatchObject({ coverage: 'COMPLETE', phase: 'SOULS', pages: 2, checkpoint: '101' })
  expect(souls.data?.items[0]).toMatchObject({ onChainId: raw.soul.id, viewerAddress: null, isOwner: false,
    chainListingStatus: 'LISTED', listedPriceAtomic: '1000000', effectiveGrantCount: '1' })
  expect(raw.fetcher).toHaveBeenCalledTimes(2); expect(raw.batch).toHaveBeenCalled(); expect(raw.list).toHaveBeenCalled()
})
