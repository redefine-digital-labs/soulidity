// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CreatePostModal } from '../../web/components/community/create-post-modal'
const f = vi.hoisted(() => ({ auth: {} as any, operation: {} as any, login: vi.fn(), close: vi.fn(), published: vi.fn() }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-community-publish', () => ({ useCommunityPublish: () => f.operation }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => f.login }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  f.auth = { walletAddress: 'wallet', profile: { id: 'author' }, loading: false, profileError: null }
  f.operation = { busy: false, pending: null, error: null, recoveryExport: null, result: null,
    publish: vi.fn(async () => ({ status: 'published' })), query: vi.fn(async () => ({ status: 'pending' })),
    resume: vi.fn(async () => ({ status: 'published' })), cancel: vi.fn(async () => ({ status: 'archived' })), archive: vi.fn(async () => ({ status: 'archived' })) }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
async function render() { await act(async () => root.render(<CreatePostModal open onClose={f.close} onPublished={f.published} channel="questions" />)) }
async function input(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('preserves form fields and maps the original post type/channel to the chain publish hook', async () => {
  await render(); await input('input[placeholder="Post title"]', ' Title '); await input('textarea', ' Body ')
  await input('input[placeholder^="Tags"]', 'A, a')
  await act(async () => button('Question').click()); await act(async () => button('Publish').click())
  expect(f.operation.publish).toHaveBeenCalledWith({ title: 'Title', content: 'Body', postType: 1, channel: 1, tags: ['A', 'a'] })
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.published).toHaveBeenCalledOnce()
})
it('does not clear the form or close on an unknown publication result', async () => {
  f.operation.publish.mockResolvedValue({ status: 'pending' }); await render()
  await input('input[placeholder="Post title"]', 'Keep'); await input('textarea', 'Body')
  await act(async () => button('Publish').click())
  expect(f.close).not.toHaveBeenCalled(); expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Body')
  expect(f.published).not.toHaveBeenCalled()
})
it('retains login/profile guidance and prevents unregistered publication', async () => {
  f.auth.walletAddress = null; f.auth.profile = null; await render()
  await act(async () => button('Connect your profile wallet to publish').click())
  expect(f.login).toHaveBeenCalledOnce(); expect(button('Publish').disabled).toBe(true)
  f.auth.walletAddress = 'wallet'; await render(); expect(host.querySelector('a')!.getAttribute('href')).toBe('/profile')
})
it('freezes editing and routes recovery to the saved operation', async () => {
  f.operation.pending = { intent: { document: { schema: 'soulidity.public-post.v1', title: 'Saved title' } } }; await render()
  expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true)
  expect(button('Publish').disabled).toBe(true); expect(host.textContent).toContain('Saved title')
  await act(async () => button('Check result').click()); expect(f.operation.query).toHaveBeenCalledOnce(); expect(f.close).not.toHaveBeenCalled()
  await act(async () => button('Resume saved publication').click()); expect(f.operation.resume).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce()
  expect(f.published).toHaveBeenCalledOnce()
})
it('does not allow closing the active dialog mid-signing or submitting twice', async () => {
  f.operation.busy = true; await render()
  expect(button('Cancel').disabled).toBe(true); expect(button('Publishing…').disabled).toBe(true)
})
it('shows hook errors without claiming success', async () => {
  f.operation.error = 'Query the saved transaction'; await render()
  expect(host.textContent).toContain('Query the saved transaction'); expect(f.close).not.toHaveBeenCalled()
})
it('closing without publishing does not trigger a feed refresh', async () => {
  await render(); await act(async () => button('Cancel').click())
  expect(f.close).toHaveBeenCalledOnce(); expect(f.published).not.toHaveBeenCalled()
})
