// @vitest-environment jsdom
import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpaceProfilePage from '../../web/app/community/u/[spaceId]/page'
const f = vi.hoisted(() => ({ auth: {} as any, identity: {} as any, posts: {} as any, souls: {} as any, follow: {} as any,
  profileRead: vi.fn(), postsRead: vi.fn(), soulsRead: vi.fn(), followRead: vi.fn(), followMount: vi.fn(), followUnmount: vi.fn() }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-public-community-profile', () => ({
  usePublicCommunityProfile: (target: string) => { f.profileRead(target); return f.identity },
  useCommunityProfilePosts: (target: string | null) => { f.postsRead(target); return f.posts },
  useCommunityAuthoredSouls: (target: unknown) => { f.soulsRead(target); return f.souls },
}))
vi.mock('../../web/lib/hooks/use-social', () => ({ useFollowStatus: (target: unknown) => { f.followRead(target); return f.follow } }))
vi.mock('../../web/components/community/follow-button', () => ({ FollowButton: ({ targetMemberId }: any) => {
  React.useEffect(() => { f.followMount(); return () => { f.followUnmount() } }, [])
  return <div data-follow-id={targetMemberId}>Follow recovery</div>
} }))
vi.mock('../../web/components/souls/chain-soul-cover', () => ({ ChainSoulCover: ({ soulId, children }: any) => <div data-soul-id={soulId}>{children}</div> }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0'), profileId = id(1), owner = id(2)
let root: Root, host: HTMLDivElement, params: Promise<{ spaceId: string }>
const soul = (n: number, creatorAddress = owner, currentOwnerAddress = id(9)) => ({ onChainId: id(100 + n), creatorAddress,
  currentOwnerAddress, createdAtMs: String(n), name: 'Authored Soul ' + n, description: 'Created here, now sold', tags: ['art'], listingStatus: 'unlisted', listedPriceAtomic: null })
const post = (n: number) => ({ post: { id: id(200 + n), author: { id: profileId, handle: 'chain-handle' },
  createdAtMs: '1790520000000', commentCount: '18446744073709551615' }, document: { title: 'Post ' + n, content: 'Public post', tags: ['Tag', 'tag'] },
  authorMetadata: { displayName: null, avatar: '🦊' }, votes: { score: '-18446744073709551615' } })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.auth = { walletAddress: owner }; params = Promise.resolve({ spaceId: profileId })
  f.identity = { data: { profile: { id: profileId, owner, handle: 'chain-handle', createdAtMs: '1790520000000' },
    metadata: { displayName: 'Chain Creator', avatar: '🦊', bio: 'Public biography', coverImageUrl: 'https://public.example/cover.png' } },
    isLoading: false, isFetching: false, error: null, refetch: vi.fn(async () => {}) }
  f.posts = { items: [post(1)], loading: false, busy: false, error: null, status: 'PARTIAL', scanned: 30,
    observedCount: '18446744073709551615', hasNewerEntries: false, loadMore: vi.fn(async () => {}), refresh: vi.fn(async () => {}) }
  f.souls = { items: [soul(1)], loading: false, busy: false, error: null, status: 'PARTIAL', loadMore: vi.fn(async () => {}), refresh: vi.fn(async () => {}) }
  f.follow = { data: { followerCount: '18446744073709551615', followingCount: '9007199254740993' }, isLoading: false,
    isFetching: false, error: null, refetch: vi.fn(async () => {}) }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => { await params; root.render(<Suspense fallback="Loading"><SpaceProfilePage params={params} /></Suspense>) }) }
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!
async function click(text: string) { await act(async () => button(text).click()) }

it('maps genuine identity, hero, owner editing and lossless following counts without fabricated growth', async () => {
  await render(); expect(host.querySelector('h1')?.textContent).toBe('Chain Creator')
  expect(host.textContent).toContain('Public biography'); expect(host.textContent).toContain('JOINED SEP 2026')
  expect(host.textContent).toContain('Followers: 18446744073709551615'); expect(host.textContent).toContain('Following: 9007199254740993')
  expect(host.querySelector('[href="/profile#cover"]')).not.toBeNull(); expect(host.querySelector('[href="/profile#profile"]')).not.toBeNull()
  expect(host.textContent).toContain('Wallet ·'); expect(host.textContent).toContain('level, EXP and achievements are not yet available')
  expect(host.textContent).not.toMatch(/Trainer|Level 1|EXP 0/)
  expect(host.querySelector('[style*="cover.png"]')).not.toBeNull()
  expect(f.profileRead).toHaveBeenCalledWith(profileId); expect(f.postsRead).toHaveBeenCalledWith(profileId)
  expect(f.soulsRead).toHaveBeenCalledWith(f.identity.data.profile)
})
it('keeps wallets owner-only in hero and About, using actual wallet equality instead of a Member id', async () => {
  f.auth = { walletAddress: id(99), user: { id: profileId } }; await render(); await click('About')
  expect(host.textContent).not.toContain('Wallet ·'); expect(host.textContent).not.toContain('Primary wallet')
  expect(host.querySelector('[href="/profile#profile"]')).toBeNull(); expect(host.querySelector('[href="/profile#cover"]')).toBeNull()
  expect(host.textContent).toContain(profileId); expect(host.querySelector('[data-follow-id]')?.getAttribute('data-follow-id')).toBe(profileId)
})
it('shows newest12 created Souls including sold assets and excludes purchased inventory', async () => {
  f.souls.items = [...Array.from({ length: 14 }, (_, n) => soul(n + 1)), soul(999, id(99), owner)]; await render()
  const covers = [...host.querySelectorAll('[data-soul-id]')]
  expect(covers).toHaveLength(12); expect(covers[0].getAttribute('data-soul-id')).toBe(id(114))
  expect(host.textContent).not.toContain('Authored Soul 999'); expect(host.textContent).toContain('Authored Soul 14')
  expect(host.textContent).toContain('not a total inventory count'); expect(host.textContent).toContain('Partial discovery')
  await click('Find more authored Souls'); expect(f.souls.loadMore).toHaveBeenCalledOnce()
})
it('keeps latest10 posts linked to chain IDs with full signed score/comment count', async () => {
  f.posts.items = Array.from({ length: 12 }, (_, n) => post(n + 1)); await render(); await click('Posts')
  const section = host.querySelector('[aria-label="Profile posts"]')!
  expect(section.querySelectorAll('a')).toHaveLength(10)
  expect(section.textContent).toContain('-18446744073709551615'); expect(section.textContent).toContain('18446744073709551615')
  expect(section.querySelector('a')?.getAttribute('href')).toBe('/community/posts/' + id(201))
  expect(section.textContent).toContain('not a complete profile history')
  await click('Scan more profile posts'); expect(f.posts.loadMore).toHaveBeenCalledOnce()
})
it('preserves FollowButton instance and cached profile through identity/follow read errors', async () => {
  await render(); f.identity.error = new Error('metadata expired'); f.follow.error = new Error('RPC offline'); await render()
  expect(host.querySelector('h1')?.textContent).toBe('Chain Creator'); expect(host.textContent).toContain('metadata expired')
  expect(host.textContent).toContain('Followers: Unavailable'); expect(host.textContent).not.toContain('Profile not found')
  expect(f.followMount).toHaveBeenCalledOnce(); expect(f.followUnmount).not.toHaveBeenCalled()
  await click('Retry profile read'); await click('Retry follow counts')
  expect(f.identity.refetch).toHaveBeenCalledOnce(); expect(f.follow.refetch).toHaveBeenCalledOnce()
})
it('keeps canonical-target follow recovery mounted even if identity data disappears on reload', async () => {
  await render(); f.identity.data = undefined; f.identity.isLoading = true; await render()
  f.identity.isLoading = false; f.identity.error = new Error('read failed'); await render()
  expect(f.followMount).toHaveBeenCalledOnce(); expect(f.followUnmount).not.toHaveBeenCalled()
  expect(f.postsRead).toHaveBeenLastCalledWith(null); expect(f.soulsRead).toHaveBeenLastCalledWith(null)
  expect(host.textContent).not.toContain('Profile not found'); expect(host.textContent).toContain('read failed')
})
it.each(['Souls', 'Posts'] as const)('makes %s errors independently retryable without an invented empty success', async tab => {
  const source = tab === 'Souls' ? f.souls : f.posts; source.error = 'unavailable'; source.items = []
  await render(); await click(tab); expect(host.querySelector('h1')?.textContent).toBe('Chain Creator')
  expect(host.textContent).toContain('unavailable'); expect(host.textContent).not.toMatch(/No authored Souls found|No posts found/)
  await click(tab === 'Souls' ? 'Retry / refresh Souls' : 'Retry / refresh posts'); expect(source.refresh).toHaveBeenCalledOnce()
})
it('does not call unavailable achievement data an empty earned collection', async () => {
  await render(); await click('About')
  expect(host.textContent).toContain('Verified public achievements are not available yet')
  expect(host.textContent).not.toContain('No achievements yet')
})
it('differentiates complete windows from partial and capped discoveries', async () => {
  f.posts.status = 'COMPLETE_WINDOW'; f.posts.items = []; f.souls.status = 'LIMIT_REACHED'; await render()
  expect(host.textContent).toContain('discovery limit was reached'); expect(button('Find more authored Souls')).toBeUndefined()
  await click('Posts'); expect(host.textContent).toContain('No posts found in this completed window')
  expect(button('Scan more profile posts')).toBeUndefined()
})
it('shares the actual page URL and visibly reports clipboard failure', async () => {
  const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { clipboard: { writeText } }); await render()
  await click('Share'); expect(writeText).toHaveBeenCalledWith(window.location.href); expect(host.textContent).toContain('Profile link copied')
  writeText.mockRejectedValueOnce(new Error('denied')); await click('Share'); expect(host.textContent).toContain('Unable to copy the link')
})
