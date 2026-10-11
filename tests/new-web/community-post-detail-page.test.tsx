// @vitest-environment jsdom
import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PostDetailPage from '../../web/app/community/posts/[id]/page'
const f = vi.hoisted(() => ({ auth: {} as any, detail: {} as any, publish: {} as any, accept: {} as any,
  release: 'release', login: vi.fn(), target: vi.fn(), voteMount: vi.fn(), voteUnmount: vi.fn() }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => f.login }))
vi.mock('../../web/lib/hooks/use-community-post-detail', () => ({ useCommunityPostDetail: (id: string) => { f.target(id); return f.detail } }))
vi.mock('../../web/lib/hooks/use-community-publish', () => ({ useCommunityPublish: (target: unknown) => { f.target(target); return f.publish } }))
vi.mock('../../web/lib/hooks/use-community-accept', () => ({ useCommunityAccept: (id: string) => { f.target(id); return f.accept } }))
vi.mock('../../web/lib/community/public-post-vote-read', () => ({ getBrowserCommunityVoteConfig: () => ({ release: f.release }) }))
vi.mock('../../web/components/community/vote-controls', () => ({ VoteControls: ({ postId }: any) => {
  React.useEffect(() => { f.voteMount(); return () => { f.voteUnmount() } }, [])
  return <div data-vote-id={postId}>Vote controls</div>
} }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }))
let root: Root, host: HTMLDivElement, params: Promise<{ id: string }>
const id = '0x' + '6'.padStart(64, '0'), commentId = '0x' + '9'.padStart(64, '0')
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  f.auth = { walletAddress: 'wallet', profile: { id: 'author' }, loading: false, profileError: null }
  f.release = 'release'; params = Promise.resolve({ id })
  const author = { id: 'author', owner: 'wallet', handle: 'author-handle' }
  const post = { id, author, postType: 'question', createdAtMs: '1790520000000', commentCount: '18446744073709551615', acceptedComment: null }
  f.detail = { isLoading: false, isFetching: false, error: null, refetch: vi.fn(async () => ({})), data: { post,
    document: { title: 'Chain question', content: 'First line\nSecond line', tags: ['Tag', 'tag'] }, authorMetadata: { displayName: 'Creator', avatar: '🦊' },
    comments: [{ post, comment: { id: commentId, author, createdAtMs: '1790520000000' }, document: { content: 'Answer text' }, authorMetadata: { displayName: null, avatar: '🤖' } }],
    commentWindow: { shown: 1, total: '18446744073709551615', partial: true } } }
  f.publish = { busy: false, pending: null, error: null, recoveryExport: null, result: null,
    publish: vi.fn(async () => ({ status: 'published' })), query: vi.fn(async () => ({ status: 'pending' })),
    resume: vi.fn(async () => ({ status: 'published' })), cancel: vi.fn(async () => ({ status: 'archived' })), archive: vi.fn(async () => ({ status: 'archived' })) }
  f.accept = { busy: false, record: null, error: null, recoveryExport: null,
    accept: vi.fn(async () => ({})), query: vi.fn(async () => ({})), resume: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})) }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
async function render() { await act(async () => { await params; root.render(<Suspense fallback="Loading"><PostDetailPage params={params} /></Suspense>) }) }
async function input(value: string) {
  const el = host.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
it('maps real chain fields, full-u64 counters, earliest window, identity links and vote target', async () => {
  await render()
  expect(host.querySelector('h1')?.textContent).toBe('Chain question'); expect(host.textContent).toContain('18446744073709551615 comments')
  expect(host.textContent).toContain('not the full discussion'); expect(host.textContent).toContain('author-handle')
  expect(host.querySelector('[data-vote-id]')?.getAttribute('data-vote-id')).toBe(id)
  expect(f.target).toHaveBeenCalledWith({ kind: 'comment', postId: id })
  expect(host.textContent).not.toContain('Trainer'); expect(host.querySelector('textarea')?.maxLength).toBe(10000)
})
it('publishes trimmed text and clears only after verified publication', async () => {
  f.publish.publish.mockResolvedValueOnce({ status: 'pending' }); await render(); await input(' Keep me ')
  await act(async () => button('Comment').click()); expect(f.publish.publish).toHaveBeenCalledWith({ content: 'Keep me' })
  expect(host.querySelector('textarea')?.value).toBe(' Keep me '); expect(f.detail.refetch).not.toHaveBeenCalled()
  await act(async () => button('Comment').click()); expect(host.querySelector('textarea')?.value).toBe(''); expect(f.detail.refetch).toHaveBeenCalledOnce()
})
it('self-accept calls frozen question/comment without optimistic badge', async () => {
  await render(); await act(async () => button('Accept as Answer').click())
  expect(f.accept.accept).toHaveBeenCalledWith(f.detail.data.post, commentId)
  expect(host.textContent).not.toContain('Accepted')
  f.detail.data.post.acceptedComment = { id: commentId }; await render()
  expect(host.textContent).toContain('Accepted'); expect(button('Accept as Answer')).toBeUndefined()
})
it.each(['otherAuthor', 'log', 'profileError', 'pending'])('prevents unauthorized/new acceptance for %s', async kind => {
  if (kind === 'otherAuthor') f.auth.walletAddress = 'other'
  if (kind === 'log') f.detail.data.post.postType = 'log'
  if (kind === 'profileError') f.auth.profileError = 'profile unavailable'
  if (kind === 'pending') f.accept.record = { phase: 'SIGNED', intent: { commentId } }
  await render(); const action = button('Accept as Answer')
  expect(!action || action.disabled).toBe(true); expect(f.accept.accept).not.toHaveBeenCalled()
})
it('retains both recoveries during content failure and never reports network errors as missing post', async () => {
  f.detail.data = undefined; f.detail.error = new Error('storage expired')
  f.publish.pending = { intent: { document: { content: 'Frozen comment' } } }
  f.accept.record = { phase: 'PREPARED', intent: { commentId } }; await render()
  expect(host.textContent).toContain('storage expired'); expect(host.textContent).not.toContain('Post not found')
  await act(async () => button('Check comment result').click()); await act(async () => button('Resume same acceptance').click())
  expect(f.publish.query).toHaveBeenCalledOnce(); expect(f.accept.resume).toHaveBeenCalledOnce()
  await act(async () => button('Retry post read').click()); expect(f.detail.refetch).toHaveBeenCalledOnce()
})
it('freezes pending comment and exposes only unsigned acceptance cancellation', async () => {
  f.publish.pending = { intent: { document: { content: 'Frozen comment' } } }; f.accept.record = { phase: 'SIGNED', intent: { commentId } }
  await render(); expect(host.querySelector('textarea')?.disabled).toBe(true); expect(button('Comment').disabled).toBe(true)
  expect(button('Cancel unsigned acceptance')).toBeUndefined(); expect(host.textContent).toContain('Frozen comment')
})
it('preserves anonymous login and unregistered profile guidance', async () => {
  f.auth.walletAddress = null; f.auth.profile = null; await render()
  await act(async () => button('Connect your profile wallet to comment').click()); expect(f.login).toHaveBeenCalledOnce()
  f.auth.walletAddress = 'wallet'; await render(); expect(button('Comment').disabled).toBe(true)
  expect(host.textContent).toContain('Create or reload your chain profile')
})
it('report entry never sends private details to a public document or obsolete API', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); f.auth.walletAddress = 'other'; await render()
  await act(async () => button('⚑ Report').click()); expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Nothing has been submitted')
  expect(host.querySelector('#report-notes')).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  await act(async () => button('Close report').click()); expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it.each(['wallet', 'post', 'release', 'ABA'])('isolates draft and late publication callback after %s change', async change => {
  let finish!: (value: any) => void
  f.publish.publish.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); await input('Old draft'); await act(async () => button('Comment').click())
  if (change === 'wallet' || change === 'ABA') f.auth.walletAddress = 'other'
  if (change === 'release') f.release = 'next'
  if (change === 'post') params = Promise.resolve({ id: 'next-post' })
  await render()
  if (change === 'ABA') { f.auth.walletAddress = 'wallet'; await render() }
  await input('New draft')
  await act(async () => finish({ status: 'published' }))
  expect(host.querySelector('textarea')?.value).toBe('New draft'); expect(f.detail.refetch).not.toHaveBeenCalled()
  expect(f.voteUnmount).not.toHaveBeenCalled()
})
it('keeps vote recovery mounted through loading, content failures and successful retry', async () => {
  await render(); expect(f.voteMount).toHaveBeenCalledOnce()
  f.detail.isLoading = true; await render()
  f.detail.isLoading = false; f.detail.error = new Error('expired'); await render()
  expect(host.querySelector('[data-vote-id]')).not.toBeNull()
  f.detail.error = null; await render()
  expect(f.voteMount).toHaveBeenCalledOnce(); expect(f.voteUnmount).not.toHaveBeenCalled()
  await act(async () => button('Reload post').click()); expect(f.detail.refetch).toHaveBeenCalledOnce()
})
