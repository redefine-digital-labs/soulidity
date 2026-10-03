// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CreateCollectionProvider, useCreateCollection } from '../../web/components/providers/create-collection-provider'
import CollectionInfo from '../../web/app/collections/create/page'
vi.mock('../../web/components/souls/authoring-recovery-import', () => ({ AuthoringRecoveryImport: () => null }))
const m = vi.hoisted(() => ({ address: 'wallet-a', read: vi.fn(), write: vi.fn() }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ user: null, walletAddress: m.address }) }))
vi.mock('../../web/lib/collections/collection-draft-store', () => ({ collectionDraftStore: { read: m.read, write: m.write } }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('../../web/lib/hooks/use-collection-publish', () => ({ useCollectionPublish: () => ({
  recovery: { manifest: { request: { collection: { name: 'Already saved launch' }, mints: [] } } }, loadingRecovery: false,
}) }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, ctx: ReturnType<typeof useCreateCollection>
function Probe() { ctx = useCreateCollection(); return ctx.draftReady ? <span>Editor:{ctx.name}</span> : null }
async function render() { await act(async () => root.render(<CreateCollectionProvider><Probe /></CreateCollectionProvider>)) }
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.address = 'wallet-a'; m.read.mockReset().mockResolvedValue({ revision: 0, draft: null })
  m.write.mockReset().mockImplementation(async (_scope, revision) => revision + 1)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear() })
it('does not write an unchanged opened draft and isolates later edits after wallet switch', async () => {
  expect(m.write).not.toHaveBeenCalled()
  await act(async () => ctx.setName('A private draft'))
  expect(m.write.mock.calls[0][0]).toBe('collection-edit:wallet-a')
  m.address = 'wallet-b'; await render()
  expect(ctx.name).toBe('')
  await act(async () => ctx.setName('B private draft'))
  expect(m.write.mock.calls.at(-1)?.[0]).toBe('collection-edit:wallet-b')
})
it('read failure keeps the editor hidden and never overwrites the existing record', async () => {
  m.read.mockRejectedValueOnce(Error('unreadable ciphertext')); m.address = 'wallet-b'; await render()
  expect(host.textContent).toContain('Existing data was not replaced')
  expect(host.textContent).not.toContain('Editor:')
  expect(m.write).not.toHaveBeenCalled()
})
it('failed save retains fields, shows the actual cause and retries the same revision', async () => {
  m.write.mockRejectedValueOnce(Error('quota exhausted'))
  await act(async () => ctx.setName('Keep this work'))
  expect(ctx.name).toBe('Keep this work'); expect(host.textContent).toContain('quota exhausted')
  const beforeUnload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(beforeUnload); expect(beforeUnload.defaultPrevented).toBe(true)
  await act(async () => host.querySelector('button')!.click())
  expect(m.write.mock.calls.map(call => call[1])).toEqual([0, 0])
  expect(host.textContent).toContain('Draft saved')
})
it('failed reset preserves the editor and a pending old-scope reset cannot clear the new success cache', async () => {
  await act(async () => ctx.setName('Retained result'))
  m.write.mockRejectedValueOnce(Error('quota exhausted'))
  await act(async () => { await expect(ctx.reset()).rejects.toThrow('quota exhausted') })
  expect(ctx.name).toBe('Retained result')
  await act(async () => host.querySelector('button')!.click())
  let finish!: (revision: number) => void
  m.write.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve }))
  let reset!: Promise<unknown>
  await act(async () => { reset = ctx.reset().catch(error => error) })
  m.address = 'wallet-b'; await render()
  sessionStorage.setItem('collection-publish-result', 'new-wallet-result')
  await act(async () => { finish(3); expect(await reset).toBeInstanceOf(Error) })
  expect(sessionStorage.getItem('collection-publish-result')).toBe('new-wallet-result')
  expect(ctx.name).toBe('')
})
it('editing-draft read failure does not hide the original saved-launch recovery entry', async () => {
  m.read.mockRejectedValueOnce(Error('unreadable ciphertext')); m.address = 'wallet-b'
  await act(async () => root.render(<CreateCollectionProvider><CollectionInfo /></CreateCollectionProvider>))
  expect(host.textContent).toContain('Existing data was not replaced')
  const link = host.querySelector('a[href="/collections/create/preview"]')
  expect(link?.textContent).toBe('Open Saved Creation')
  expect(host.querySelector('input')).toBeNull()
  expect(m.write).not.toHaveBeenCalled()
})
