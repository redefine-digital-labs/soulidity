// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CommunityFeed from '../../web/app/community/_components/community-feed'

const f = vi.hoisted(() => ({ auth: {} as any, feed: {} as any,
  feedRead: vi.fn(), login: vi.fn(), modal: null as any }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => f.login }))
vi.mock('../../web/lib/hooks/use-community-feed', () => ({ useCommunityFeed: (input: unknown, enabled: boolean) => { f.feedRead(input, enabled); return f.feed } }))
vi.mock('../../web/components/community/vote-controls', () => ({ VoteControls: ({ postId }: any) => <div data-vote-id={postId}>Real vote control</div> }))
vi.mock('../../web/components/community/create-post-modal', () => ({ CreatePostModal: (props: any) => {
  f.modal = props
  return props.open ? <div role="dialog"><button onClick={props.onClose}>Cancel creation</button>
    <button onClick={() => { props.onPublished(); props.onClose() }}>Confirm publication</button></div> : null
} }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }))

let root: Root, host: HTMLDivElement
const id = (value: number) => '0x' + value.toString(16).padStart(64, '0')
function row(index = 1) {
  return { post: { id: id(index), author: { id: id(1000), owner: id(2000), handle: 'chain-author' },
    channel: 'general', createdAtMs: '1790520000000', commentCount: '18446744073709551615' },
  document: { title: 'Chain post ' + index, content: 'Public content\nSecond line', tags: ['Tag', 'tag', 'third', 'fourth'] },
  authorMetadata: { displayName: null, avatar: '🦊' }, votes: { score: '-18446744073709551615' } }
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.auth = { walletAddress: id(2000) }
  f.feed = { items: [row()], loading: false, busy: false, error: null, status: 'PARTIAL', scanned: 30,
    channels: { general: '18446744073709551615', questions: '9007199254740993' },
    observedCount: '18446744073709551615', hasNewerEntries: false, loadMore: vi.fn(async () => {}), refresh: vi.fn(async () => {}) }
  f.modal = null; host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(activeChannel?: string) { await act(async () => root.render(<CommunityFeed activeChannel={activeChannel} />)) }
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!
async function click(text: string) { await act(async () => button(text).click()) }

it('renders only top30 real Post IDs, certified author metadata, full-u64 comments and original tags', async () => {
  f.feed.items = Array.from({ length: 35 }, (_, index) => row(index + 1)); await render()
  expect(host.querySelectorAll('article')).toHaveLength(30)
  expect(host.querySelector('[data-vote-id]')?.getAttribute('data-vote-id')).toBe(id(1))
  expect(host.querySelector('article')?.textContent).toContain('18446744073709551615 comments')
  expect(host.querySelector('article')?.textContent).toContain('chain-author')
  expect(host.querySelector('article')?.textContent).toContain('Profile')
  expect(host.querySelector('article')?.textContent).not.toMatch(/Trainer|Soul says|fourth/)
  expect(host.querySelector('article a[href="/community/u/' + id(1000) + '"]')).not.toBeNull()
  expect(host.querySelector('article a[href="/community/posts/' + id(1) + '"]')).not.toBeNull()
})
it('preserves channel, New/Top/Discussed and rolling time-range inputs', async () => {
  await render('questions')
  expect(f.feedRead).toHaveBeenLastCalledWith({ sort: 'latest', channel: 'questions', timeRange: undefined }, true)
  await click('Top'); const select = host.querySelector('select')!
  expect([...select.options].map(item => item.value)).toEqual(['', 'past_hour', 'today', 'this_week', 'this_month'])
  await act(async () => { select.value = 'this_week'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(f.feedRead).toHaveBeenLastCalledWith({ sort: 'popular', channel: 'questions', timeRange: 'this_week' }, true)
  await click('Discussed'); expect(f.feedRead).toHaveBeenLastCalledWith({ sort: 'discussed', channel: 'questions', timeRange: 'this_week' }, true)
})
it('labels incomplete ranking and offers explicit bounded scan continuation', async () => {
  await render(); expect(host.textContent).toContain('ranking covers only scanned posts, not the global feed')
  expect(host.textContent).toContain('Scanned 30 of 18446744073709551615 posts')
  await click('Scan more posts'); expect(f.feed.loadMore).toHaveBeenCalledOnce()
  f.feed.busy = true; await render(); expect(button('Reading more posts…').disabled).toBe(true)
})
it('does not confuse partial empty results with a globally empty community', async () => {
  f.feed.items = []; await render(); expect(host.textContent).toContain('No matching posts in the scanned range')
  expect(host.textContent).not.toContain('No posts yet')
})
it.each(['loading', 'error'])('does not display an empty success state while %s', async mode => {
  f.feed.items = []; if (mode === 'loading') f.feed.loading = true; else f.feed.error = 'RPC unavailable'
  await render(); expect(host.textContent).not.toContain('No matching posts')
  expect(host.textContent).toContain(mode === 'loading' ? 'Loading community posts' : 'RPC unavailable')
})
it('distinguishes a complete captured window from newer entries and refreshes explicitly', async () => {
  f.feed.status = 'COMPLETE_WINDOW'; f.feed.items = []; f.feed.hasNewerEntries = true; await render()
  expect(host.textContent).toContain('No matching posts in this captured window')
  expect(host.textContent).toContain('Newer posts are available')
  expect(button('Scan more posts')).toBeUndefined()
  await click('Refresh posts'); expect(f.feed.refresh).toHaveBeenCalledOnce()
})
it('keeps LIMIT_REACHED visibly incomplete without pretending further scan is available', async () => {
  f.feed.status = 'LIMIT_REACHED'; await render()
  expect(host.textContent).toContain('scan limit was reached'); expect(host.textContent).toContain('Results are incomplete')
  expect(button('Scan more posts')).toBeUndefined()
})
it('defers News without querying a fake chain news feed or opening its publisher', async () => {
  await render('news'); expect(f.feedRead).toHaveBeenCalledOnce(); expect(f.feedRead).toHaveBeenLastCalledWith(expect.anything(), false)
  expect(host.textContent).toContain('News is deferred'); expect(button('+ Post')).toBeUndefined()
  expect(host.querySelector('article')).toBeNull()
})
it('keeps the +Post entry available to anonymous visitors and invokes login', async () => {
  f.auth.walletAddress = null; await render(); await click('+ Post')
  expect(f.login).toHaveBeenCalledOnce(); expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('refreshes after confirmed publication but never on modal cancellation', async () => {
  await render(); await click('+ Post'); await click('Cancel creation')
  expect(f.feed.refresh).not.toHaveBeenCalled(); await click('+ Post'); await click('Confirm publication')
  expect(f.feed.refresh).toHaveBeenCalledOnce()
})
it('keeps deferred rankings explicit without showing legacy identities or fake empty scores', async () => {
  await render(); const sidebar = host.querySelector('aside')!
  expect(sidebar.textContent).toContain('Contributor rankings are temporarily unavailable')
  expect(sidebar.textContent).not.toContain('Legacy contributor')
  expect(sidebar.querySelector('a[href="/community/leaderboard"]')).not.toBeNull()
})
it('uses one feed read for list and full-range channel counts, unaffected by top30/filter selection', async () => {
  await render('questions'); expect(f.feedRead).toHaveBeenCalledOnce()
  const channels = host.querySelector('[aria-label="Channel counts"]')!
  expect(channels.querySelector('[aria-label="General count"]')?.textContent?.trim()).toBe('18446744073709551615')
  expect(channels.querySelector('[aria-label="Questions count"]')?.textContent?.trim()).toBe('9007199254740993')
  expect(channels.querySelector('[aria-label="News count"]')?.textContent?.trim()).toBe('Deferred')
  expect(channels.textContent).toContain('in scanned range, before feed filters')
  await click('Top'); expect(channels.querySelector('[aria-label="General count"]')?.textContent?.trim()).toBe('18446744073709551615')
  expect(f.feedRead).toHaveBeenCalledTimes(2)
})
it.each(['PARTIAL', 'LIMIT_REACHED', 'COMPLETE_WINDOW'])('labels channel coverage for %s without fabricating global totals', async status => {
  f.feed.status = status; await render()
  expect(host.querySelector('[aria-label="Channel counts"]')?.textContent).toContain(status === 'COMPLETE_WINDOW' ? 'in captured window' : 'in scanned range')
})
it.each(['loading', 'first-error', 'disabled'])('does not render missing channel authority as zero during %s', async state => {
  f.feed.channels = null; f.feed.loading = state === 'loading'; f.feed.error = state === 'first-error' ? 'offline' : null
  await render(state === 'disabled' ? 'news' : undefined)
  const channels = host.querySelector('[aria-label="Channel counts"]')!
  expect(channels.querySelector('[aria-label="General count"]')?.textContent?.trim()).toBe(state === 'loading' ? 'Loading…' : 'Unavailable')
  expect(channels.querySelector('[aria-label="News count"]')?.textContent?.trim()).toBe('Deferred')
})
it('retains proven channel counts after a later-page failure and preserves static links/icons', async () => {
  f.feed.error = 'next page failed'; await render()
  const channels = host.querySelector('[aria-label="Channel counts"]')!
  expect(channels.textContent).toContain('Counts retain the verified scanned range')
  expect(channels.querySelector('[aria-label="Questions count"]')?.textContent?.trim()).toBe('9007199254740993')
  expect([...channels.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/community/general', '/community/news', '/community/questions'])
  expect(channels.textContent).toContain('💬'); expect(channels.textContent).toContain('📰'); expect(channels.textContent).toContain('❓')
})
