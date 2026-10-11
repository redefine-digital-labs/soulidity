// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useCommunityAuthoredSouls, useCommunityProfilePosts, usePublicCommunityProfile } from '../../web/lib/hooks/use-public-community-profile'
const f = vi.hoisted(() => ({ owner: 'viewer', profileConfig: {} as any, soulConfig: {} as any, profile: {} as any,
  client: { core: {} }, read: vi.fn(), create: vi.fn(), next: vi.fn(), feed: vi.fn(), identity: vi.fn(), sessions: [] as any[] }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<any>(), readWalletProfile: (...args: any[]) => f.read(...args) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ walletAddress: f.owner }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient: f.client }) }))
vi.mock('../../web/lib/hooks/use-community-feed', () => ({ useCommunityFeed: (...args: any[]) => f.feed(...args) }))
vi.mock('../../web/lib/community/public-profile-read', () => ({ readPublicCommunityIdentity: (...args: any[]) => f.identity(...args) }))
vi.mock('../../web/lib/profile/profile-config', () => ({ getBrowserProfileReadConfig: () => structuredClone(f.profileConfig) }))
vi.mock('../../web/lib/soulidity/browser-soul-detail', () => ({ getBrowserSoulDetailConfig: () => structuredClone(f.soulConfig) }))
vi.mock('../../web/lib/soulidity/browser-market-souls', () => ({ createBrowserMarketSouls: (...args: any[]) => f.create(...args) }))
let root: Root, host: HTMLDivElement, client: QueryClient, profile: any, space: string
let souls: ReturnType<typeof useCommunityAuthoredSouls>, posts: ReturnType<typeof useCommunityProfilePosts>, identity: ReturnType<typeof usePublicCommunityProfile>
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const page = (count = 1, candidateStatus = 'PARTIAL') => ({ candidateStatus, souls: Array.from({ length: count }, (_, n) => ({ onChainId: id(n + 20), creatorAddress: id(8), createdAtMs: String(n), currentOwnerAddress: id(99) })) })
function Harness() { souls = useCommunityAuthoredSouls(profile); posts = useCommunityProfilePosts(profile?.id ?? null); identity = usePublicCommunityProfile(space); return null }
async function render() { await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 0)) }) }
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  f.owner = id(9); f.sessions = []; space = 'author'; f.profile = profile = { id: id(7), registryId: id(3), owner: id(8), revision: '1' }
  f.profileConfig = { deployment: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, storage: {} }
  f.soulConfig = { native: { soulidityOriginalPackageId: id(1) }, chainIdentifier: '01010101' }
  f.read.mockReset().mockImplementation(async () => structuredClone(f.profile))
  f.next.mockReset().mockResolvedValue(page())
  f.create.mockReset().mockImplementation(params => { f.sessions.push(params); return { next: (...args: any[]) => f.next(...args) } })
  f.feed.mockReset().mockReturnValue({ items: Array.from({ length: 30 }, (_, n) => ({ id: n })), status: 'PARTIAL' })
  f.identity.mockReset().mockImplementation(async () => ({ profile: structuredClone(f.profile), metadata: { displayName: 'Creator' } }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals() })
it('resolves a public handle with release-scoped query and cancellation without owned API', async () => {
  await render(); expect(f.identity).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'author', client: f.client.core, config: f.profileConfig, signal: expect.any(AbortSignal) }))
  expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['community-chain-profile', f.profileConfig, 'author'])
})
it('disables dependent discovery without a verified identity and requests latest10 only for the exact author', async () => {
  profile = null; space = ''; await render(); expect(f.create).not.toHaveBeenCalled(); expect(f.feed).toHaveBeenLastCalledWith({ sort: 'latest', authorId: undefined }, false)
  expect(souls.loading).toBe(false)
  profile = f.profile; await render(); expect(f.feed).toHaveBeenLastCalledWith({ sort: 'latest', authorId: id(7) }, true); expect(posts.items).toHaveLength(10)
})
it('discovers by original creator, preserving sold Souls, latest12 and partial coverage', async () => {
  f.next.mockResolvedValue(page(20)); await render()
  expect(f.create.mock.calls[0][0]).toMatchObject({ selection: { kind: 'AUTHOR', creatorAddress: id(8) }, viewerAddress: id(9) })
  expect(souls.items).toHaveLength(12); expect(souls.items[0].createdAtMs).toBe('19'); expect(souls.items[0].currentOwnerAddress).toBe(id(99))
  expect(souls.status).toBe('PARTIAL'); expect(f.read).toHaveBeenCalledTimes(2)
})
it('does not create a reader for mismatched profile/Soul releases', async () => {
  f.soulConfig.native.soulidityOriginalPackageId = id(99); await render()
  expect(souls.error).toBe('COMMUNITY_AUTHOR_RELEASE_MISMATCH'); expect(f.create).not.toHaveBeenCalled()
})
it('rejects changed profile authority before discovery', async () => {
  f.read.mockResolvedValue({ ...profile, revision: '2' }); await render()
  expect(souls.error).toBe('COMMUNITY_AUTHOR_CHANGED_RELOAD_PROFILE'); expect(f.next).not.toHaveBeenCalled()
})
it('rejects profile drift after a page and publishes no new items', async () => {
  f.read.mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile, owner: id(99) }); await render()
  expect(souls.error).toBe('COMMUNITY_AUTHOR_CHANGED_RELOAD_PROFILE'); expect(souls.items).toEqual([])
})
it('retains prior rows and same reader on transient next-page failure', async () => {
  await render(); f.next.mockRejectedValueOnce(new Error('offline'))
  await act(async () => souls.loadMore()); expect(souls.error).toBe('offline'); expect(souls.items).toHaveLength(1)
  await act(async () => souls.loadMore()); expect(souls.error).toBeNull(); expect(f.create).toHaveBeenCalledOnce()
})
it('retains a terminal page when final identity reread fails, retrying proof without advancing an ended scanner', async () => {
  f.next.mockResolvedValue(page(2, 'COMPLETE'))
  f.read.mockResolvedValueOnce(profile).mockRejectedValueOnce(new Error('identity RPC offline'))
  await render(); expect(souls.error).toBe('identity RPC offline'); expect(souls.items).toEqual([])
  await act(async () => souls.loadMore())
  expect(f.next).toHaveBeenCalledOnce(); expect(souls.status).toBe('COMPLETE'); expect(souls.items).toHaveLength(2)
})
it.each(['COMPLETE', 'LIMIT_REACHED'])('does not advance terminal %s scan without explicit refresh', async status => {
  f.next.mockResolvedValue(page(1, status)); await render(); await act(async () => souls.loadMore()); expect(f.next).toHaveBeenCalledOnce()
  await act(async () => souls.refresh()); expect(f.create).toHaveBeenCalledTimes(2); expect(f.sessions[0].signal.aborted).toBe(true)
})
it('rejects late results and stale actions after profile ABA', async () => {
  let finish!: (value: any) => void
  f.next.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); await render()
  const old = souls; profile = { ...f.profile, id: id(77) }; await render(); profile = f.profile; await render()
  const count = f.create.mock.calls.length
  await act(async () => { finish(page(99)); await old.refresh(); await old.loadMore() })
  expect(f.create).toHaveBeenCalledTimes(count); expect(souls.items).toHaveLength(1); expect(f.sessions[0].signal.aborted).toBe(true)
})
