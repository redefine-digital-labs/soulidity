// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useCommunityFeed } from '../../web/lib/hooks/use-community-feed'
const f = vi.hoisted(() => ({ owner: 'wallet', release: 'one', create: vi.fn(), next: vi.fn(), sessions: [] as any[], configError: false, client: {} }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ walletAddress: f.owner }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient: f.client }) }))
vi.mock('../../web/lib/community/public-post-vote-read', () => ({ getBrowserCommunityVoteConfig: () => { if (f.configError) throw new Error('missing config'); return { release: f.release } } }))
vi.mock('../../web/lib/community/feed-discovery', async original => ({ ...await original<any>(), createCommunityFeedDiscovery: (...args: any[]) => f.create(...args) }))
let root: Root, host: HTMLDivElement, hook: ReturnType<typeof useCommunityFeed>, filters: any
const snapshot = (n = 0, status = 'PARTIAL') => ({ items: n ? [{ post: { index: '0', createdAtMs: '1', channel: 'general', postType: 'log', commentCount: '0' }, document: { tags: [] }, votes: { score: '1' } }] : [], scanned: n, observedCount: '2', status, hasNewerEntries: false })
function Harness() { hook = useCommunityFeed(filters); return null }
async function render() { await act(async () => root.render(<Harness />)) }
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); f.owner = 'wallet'; f.release = 'one'; f.configError = false
  filters = {}; f.sessions = []; f.next.mockReset().mockImplementation(async () => snapshot(1))
  f.create.mockReset().mockImplementation(params => {
    const session = { params, value: snapshot(), snapshot: () => session.value, next: async () => { session.value = await f.next(); return session.value } }
    f.sessions.push(session); return session
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('loads one page and reuses verified rows for filter/sort changes', async () => {
  await render(); expect(hook.items).toHaveLength(1); expect(hook.status).toBe('PARTIAL')
  filters = { sort: 'popular', channel: 'questions' }; await render()
  expect(hook.items).toEqual([]); expect(f.create).toHaveBeenCalledOnce(); expect(f.next).toHaveBeenCalledOnce()
  expect(hook.channels).toEqual({ general: '1', questions: '0' })
  expect(f.sessions[0].params).toMatchObject({ viewerAddress: 'wallet', maxPosts: 3000 })
})
it('exposes page failure while retaining prior rows and retries the same scanner', async () => {
  await render(); f.next.mockRejectedValueOnce(new Error('offline'))
  await act(async () => hook.loadMore()); expect(hook.error).toBe('offline'); expect(hook.items).toHaveLength(1)
  expect(hook.channels).toEqual({ general: '1', questions: '0' })
  await act(async () => hook.loadMore()); expect(hook.error).toBeNull(); expect(f.create).toHaveBeenCalledOnce()
})
it('explicit refresh cancels old work and builds a fresh scan', async () => {
  await render(); const old = f.sessions[0]; await act(async () => hook.refresh())
  expect(old.params.signal.aborted).toBe(true); expect(f.create).toHaveBeenCalledTimes(2)
})
it.each(['wallet', 'release', 'ABA'])('does not commit late results or invoke stale callbacks after %s', async change => {
  let finish!: (value: any) => void
  f.next.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); const old = hook, oldSession = f.sessions[0]
  if (change === 'wallet' || change === 'ABA') f.owner = 'other'; else f.release = 'two'
  await render()
  if (change === 'ABA') { f.owner = 'wallet'; await render() }
  const count = f.create.mock.calls.length
  await act(async () => { finish(snapshot(99)); await old.refresh(); await old.loadMore() })
  expect(hook.scanned).toBe(1); expect(oldSession.params.signal.aborted).toBe(true); expect(f.create).toHaveBeenCalledTimes(count)
})
it.each(['COMPLETE_WINDOW', 'LIMIT_REACHED'])('does no work after %s', async status => {
  f.next.mockResolvedValue(snapshot(1, status)); await render(); await act(async () => hook.loadMore())
  expect(f.next).toHaveBeenCalledOnce(); expect(hook.status).toBe(status)
})
it('shows configuration error without empty success or starting reads', async () => {
  f.configError = true; await render(); expect(hook.error).toBe('missing config'); expect(hook.loading).toBe(false)
  expect(f.create).not.toHaveBeenCalled(); expect(hook.status).toBe('PARTIAL')
  expect(hook.channels).toBeNull()
})
it('exposes true zero only after the captured empty directory is completely read', async () => {
  f.next.mockResolvedValue(snapshot(0, 'COMPLETE_WINDOW')); await render()
  expect(hook.channels).toEqual({ general: '0', questions: '0' })
})
it('prevents overlapping loadMore and aborts cleanup', async () => {
  await render(); let finish!: (value: any) => void
  f.next.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let pending!: Promise<void>
  await act(async () => { pending = hook.loadMore(); await hook.loadMore() }); expect(f.next).toHaveBeenCalledTimes(2)
  await act(async () => { finish(snapshot(2)); await pending }); expect(hook.busy).toBe(false)
})
