// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSoulDetail } from '../../web/lib/hooks/use-souls'
import { browserSoulDetailFixture, detailId } from './fixtures/browser-soul-detail-fixture'
import type { BrowserSoulDetailConfig } from '../../web/lib/soulidity/browser-soul-detail'

const f = vi.hoisted(() => ({ address: null as string | null, config: null as BrowserSoulDetailConfig | null, read: vi.fn(), error: null as Error | null }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => f.address ? { address: f.address } : null }))
vi.mock('../../web/lib/soulidity/browser-soul-detail', () => ({
  getBrowserSoulDetailConfig: () => { if (f.error) throw f.error; return structuredClone(f.config) },
  readBrowserSoulDetail: (...args: unknown[]) => f.read(...args),
}))
let host: HTMLDivElement, root: Root, query: QueryClient, mounted: boolean
function View() {
  const result = useSoulDetail(detailId(3))
  return <div>{result.error ? result.error.message : result.data?.name ?? 'Loading'}<button onClick={() => void result.refetch()}>Retry</button></div>
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function render() { await act(async () => root.render(<QueryClientProvider client={query}><View /></QueryClientProvider>)); await flush() }
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.address = detailId(5); f.config = browserSoulDetailFixture(false).config; f.error = null
  f.read.mockReset().mockImplementation(async (params: { viewerAddress: string | null }) => ({ name: `Soul for ${params.viewerAddress}` }))
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Owned HTTP must not be used') }))
})
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); query.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('actual query calls the browser service directly with full release/wallet scope and no auth HTTP', async () => {
  await render()
  const args = f.read.mock.calls[0][0]
  expect(args).toMatchObject({ soulId: detailId(3), viewerAddress: detailId(5), config: f.config })
  expect(args.getViewerAddress()).toBe(detailId(5)); expect(args.signal).toBeInstanceOf(AbortSignal)
  expect(query.getQueryCache().getAll()[0].queryKey).toEqual(['soul', detailId(3), detailId(5), 'chain-detail-v1', f.config, 1])
  expect(host.textContent).toContain(detailId(5)); expect(globalThis.fetch).not.toHaveBeenCalled()
})
it('wallet switch cancels old requests and ignores their late results even with cached new data', async () => {
  let finish!: (value: unknown) => void
  f.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); const old = f.read.mock.calls[0][0]
  f.address = detailId(9); await render()
  expect(old.signal.aborted).toBe(true); expect(old.getViewerAddress()).toBeNull()
  await act(async () => finish({ name: 'OLD PRIVATE VIEW' })); await flush()
  expect(host.textContent).not.toContain('OLD PRIVATE VIEW'); expect(host.textContent).toContain(detailId(9))
})
it('release changes re-key the query and abort a stale release read', async () => {
  let finish!: (value: unknown) => void
  f.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); const old = f.read.mock.calls[0][0]
  f.config = { ...f.config!, marketConfigId: detailId(88) }; await render()
  expect(old.signal.aborted).toBe(true); expect(f.read).toHaveBeenCalledTimes(2)
  expect(f.read.mock.calls[1][0].config.marketConfigId).toBe(detailId(88))
  await act(async () => finish({ name: 'OLD RELEASE' })); await flush(); expect(host.textContent).not.toContain('OLD RELEASE')
})
it('disconnect uses a separate public query and unmount propagates cancellation', async () => {
  await render(); f.address = null
  f.read.mockImplementationOnce(() => new Promise(() => {})); await render()
  const pending = f.read.mock.calls[1][0]
  expect(pending.viewerAddress).toBeNull(); expect(pending.getViewerAddress()).toBeNull()
  await act(async () => root.unmount()); mounted = false; expect(pending.signal.aborted).toBe(true)
})
it('missing exact configuration is an observable query error, never a legacy manifest fallback', async () => {
  f.error = new Error('Exact release configuration missing'); await render()
  expect(host.textContent).toContain('Exact release configuration missing'); expect(f.read).not.toHaveBeenCalled()
  f.error = null; await render(); expect(f.read).toHaveBeenCalledOnce()
})
