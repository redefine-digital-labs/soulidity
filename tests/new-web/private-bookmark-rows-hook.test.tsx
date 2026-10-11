// @vitest-environment jsdom
// React lifetime/pagination wiring only; the reader's canonical raw composition
// and bounded hydration are covered in browser-private-bookmark-rows.test.ts.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useBookmarkRows } from '../../web/lib/hooks/use-bookmark-rows'

const h = vi.hoisted(() => ({ bookmarks: {} as any, client: { grpc: {} } as any, config: {} as any, configError: null as string | null,
  scans: [] as any[], nextLoad: null as Promise<any> | null, factory: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useSuiClient: () => h.client }))
vi.mock('../../web/lib/hooks/use-private-bookmarks', () => ({ usePrivateBookmarks: () => h.bookmarks }))
vi.mock('../../web/lib/soulidity/browser-soul-detail', () => ({ getBrowserSoulDetailConfig: () => {
  if (h.configError) throw new Error(h.configError); return h.config
} }))
vi.mock('../../web/lib/bookmarks/browser-private-bookmark-rows', () => ({ PRIVATE_BOOKMARK_PAGE_SIZE: 20,
  createBrowserPrivateBookmarkRows: (...args: any[]) => h.factory(...args) }))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const entries = (count: number) => Array.from({ length: count }, (_, i) => ({ soulId: id(i + 100), createdAt: '2026-09-15T00:00:00.000Z' }))
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(done => { resolve = done }); return { promise, resolve } }
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useBookmarkRows>
function Probe({ enabled = true }: { enabled?: boolean }) {
  current = useBookmarkRows(enabled)
  return <div>{current.page?.rows.map(row => <p key={row.soulId}>{row.soulId}</p>)}<span>{current.error}</span></div>
}
const render = async (enabled = true) => { await act(async () => root.render(<Probe enabled={enabled} />)) }
const scan = () => h.scans.at(-1)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); h.scans.length = 0; h.nextLoad = null
  h.configError = null; h.config = { native: { original: 'current-release' } }; h.client = { grpc: {} }
  h.bookmarks = { privacyKey: 'wallet-a:1', owner: id(1), deployment: { originalPackageId: id(40) }, entries: entries(3) }
  h.factory.mockImplementation((params, dependencies) => {
    const waiting = h.nextLoad; h.nextLoad = null
    const page = (index = 0) => ({ page: index, pageCount: Math.max(1, Math.ceil(params.entries.length / 20)), total: params.entries.length,
      rows: params.entries.slice(index * 20, (index + 1) * 20).map((entry: any) => ({ ...entry, status: 'UNAVAILABLE', detail: null, error: 'offline' })),
      hasPrevious: index > 0, hasNext: (index + 1) * 20 < params.entries.length, partial: true })
    const load = vi.fn(async (index = 0) => page(index)), retryFailed = vi.fn(async () => ({ ...page(), partial: false }))
    if (waiting) load.mockImplementationOnce(async () => waiting)
    const value = { params, dependencies, load, retryFailed, page }; h.scans.push(value); return value
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('uses the captured wallet/client/release and exposes all private entries independently of availability', async () => {
  await render()
  expect(current.total).toBe(3); expect(current.page?.rows).toHaveLength(3)
  expect(scan().params).toMatchObject({ owner: id(1), entries: h.bookmarks.entries, deployment: h.bookmarks.deployment })
  expect(scan().dependencies.client()).toBe(h.client.grpc)
})
it('does not discover private IDs or call readers before explicit unlock', async () => {
  h.bookmarks.entries = null; await render()
  expect(current.total).toBeNull(); expect(current.page).toBeNull(); expect(h.factory).not.toHaveBeenCalled()
})
it('does not hydrate bookmarks on other My Souls tabs', async () => {
  await render(false); expect(h.factory).not.toHaveBeenCalled(); expect(current.total).toBe(3)
  await render(true); expect(h.factory).toHaveBeenCalledOnce()
})
it('paginates and retries a partial page through the same bounded reader', async () => {
  h.bookmarks.entries = entries(41); await render()
  await act(async () => current.next()); expect(current.page?.page).toBe(1); expect(current.page?.rows).toHaveLength(20)
  await act(async () => current.previous()); expect(current.page?.page).toBe(0)
  await act(async () => current.retryFailed()); expect(scan().retryFailed).toHaveBeenCalledOnce()
  expect(h.factory).toHaveBeenCalledOnce()
})
it('a failed full-page read retains selectable private IDs and retries the requested page', async () => {
  h.bookmarks.entries = entries(41); await render(); scan().load.mockRejectedValueOnce(new Error('deadline'))
  await act(async () => current.next())
  expect(current.error).toBe('deadline'); expect(current.page?.page).toBe(1); expect(current.page?.rows[0].soulId).toBe(id(120))
  expect(current.page?.total).toBe(41)
  await act(async () => current.retryFailed())
  expect(scan().load).toHaveBeenLastCalledWith(1); expect(scan().retryFailed).not.toHaveBeenCalled()
})
it('invalid public-detail configuration retains paginated IDs for removal and offers a real recheck', async () => {
  h.bookmarks.entries = entries(41); h.configError = 'missing public detail config'; await render()
  expect(current.error).toBe('missing public detail config'); expect(current.page?.rows).toHaveLength(20)
  await act(async () => current.next()); expect(current.page?.rows[0].soulId).toBe(id(120))
  await act(async () => current.next()); expect(current.page?.rows).toHaveLength(1)
  expect(current.total).toBe(41); expect(h.factory).not.toHaveBeenCalled()
  h.configError = null; await act(async () => current.refresh())
  expect(h.factory).toHaveBeenCalledOnce(); expect(current.error).toBeNull()
})
it('retries creation rather than offering a no-op retry when no public reader could be created', async () => {
  h.client = {}; await render(); expect(current.error).toContain('Reconnect')
  h.client.grpc = {}; await act(async () => current.retryFailed())
  expect(h.factory).toHaveBeenCalledOnce(); expect(current.error).toBeNull()
})
it('a wallet A→B→A replacement clears the old private page and ignores its late result', async () => {
  const old = deferred(); h.nextLoad = old.promise; await render(); const first = scan()
  h.bookmarks = { ...h.bookmarks, privacyKey: 'wallet-b:2', owner: id(2), entries: entries(1) }; await render()
  h.bookmarks = { ...h.bookmarks, privacyKey: 'wallet-a:3', owner: id(1), entries: entries(2) }; await render()
  expect(first.params.signal.aborted).toBe(true)
  await act(async () => old.resolve(first.page()))
  expect(current.total).toBe(2); expect(current.page?.rows).toHaveLength(2)
})
it.each(['client', 'release', 'entries'] as const)('replaces and cancels the private detail reader on %s changes', async change => {
  await render(); const first = scan()
  if (change === 'client') h.client = { grpc: {} }
  else if (change === 'release') h.bookmarks.deployment = { originalPackageId: id(99) }
  else h.bookmarks.entries = entries(2)
  await render(); expect(first.params.signal.aborted).toBe(true); expect(h.factory).toHaveBeenCalledTimes(2)
})
it('manual lock clears private detail state while a late load is still in flight', async () => {
  const old = deferred(); h.nextLoad = old.promise; await render(); const first = scan()
  h.bookmarks = { ...h.bookmarks, privacyKey: 'wallet-a:locked', entries: null }; await render()
  expect(current.page).toBeNull(); expect(current.total).toBeNull()
  await act(async () => old.resolve(first.page()))
  expect(current.page).toBeNull(); expect(host.textContent).not.toContain(id(100))
})

it.each(['refresh', 'retryFailed'] as const)('a stale %s callback cannot reset the new A→B→A page', async operation => {
  h.bookmarks.entries = entries(41); await render()
  const stale = current[operation]
  h.bookmarks = { ...h.bookmarks, privacyKey: 'wallet-b:2', owner: id(2) }; await render()
  h.bookmarks = { ...h.bookmarks, privacyKey: 'wallet-a:3', owner: id(1) }; await render()
  await act(async () => current.next())
  const active = scan(), reads = active.load.mock.calls.length
  expect(current.page?.page).toBe(1)
  await act(async () => stale())
  expect(h.factory).toHaveBeenCalledTimes(3); expect(scan()).toBe(active)
  expect(active.load).toHaveBeenCalledTimes(reads); expect(current.page?.page).toBe(1)
})
