// @vitest-environment jsdom
// Actual page, headers/cards/model, hook and React Query. Controlled public
// scanner responses are not live RPC/transaction or wallet acceptance evidence.
import React, { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Page from '../../web/app/collections/[id]/page'
import { publicMarketFixture, id, deferred } from './fixtures/public-market'
import type { CollectionDetailDiscoveryResult, CollectionPublicSnapshot } from '@soulidity/sdk'
import type { BrowserMarketSoulsPage } from '../../web/lib/soulidity/browser-market-souls'
const h = vi.hoisted(() => ({ account: null as { address: string } | null, wallet: null as object | null,
  client: { grpc: {} } as { grpc?: object }, config: null as any, configError: null as string | null,
  rootFactory: vi.fn(), membersFactory: vi.fn(), buy: vi.fn(), toast: vi.fn(), modal: null as any, onBuySuccess: null as (() => void) | null,
  roots: [] as any[], members: [] as any[] }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }), useSuiClient: () => h.client }))
vi.mock('../../web/lib/soulidity/browser-soul-detail', async original => ({
  ...await original<typeof import('../../web/lib/soulidity/browser-soul-detail')>(),
  getBrowserSoulDetailConfig: () => { if (h.configError) throw Error(h.configError); return h.config },
}))
vi.mock('@soulidity/sdk', async original => ({ ...await original<typeof import('@soulidity/sdk')>(),
  createCollectionDetailDiscovery: (...args: unknown[]) => h.rootFactory(...args) }))
vi.mock('../../web/lib/soulidity/browser-market-souls', () => ({ createBrowserMarketSouls: (...args: unknown[]) => h.membersFactory(...args) }))
vi.mock('../../web/lib/hooks/use-collection-buy', () => ({ useCollectionBuy: (_subject: unknown, onSuccess: () => void) => {
  h.onBuySuccess = onSuccess
  return { records: [], history: [], pending: false, error: null, status: null, currentObservation: null,
    currentAddress: h.account?.address ?? null, targetKey: '{}', identityKey: `buy:${h.account?.address ?? ''}`,
    prepare: h.buy, run: vi.fn(), importRecord: vi.fn(), exportRecord: vi.fn() }
} }))
vi.mock('../../web/components/ui/toast', () => ({ useToast: () => ({ showToast: h.toast }) }))
vi.mock('../../web/components/collections/collection-listing-modals', () => {
  const modal = (props: any) => { h.modal = props; return <div role="dialog"><button onClick={props.onClose}>Close modal</button></div> }
  return { ListCollectionModal: modal, EditCollectionPriceModal: modal, DelistCollectionModal: modal }
})
vi.mock('../../web/components/souls/soul-cover-image', () => ({ SoulCoverImage: ({ children, className }: any) => <div className={className}>{children}</div> }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }))
let f: Awaited<ReturnType<typeof publicMarketFixture>>, root: Root, host: HTMLDivElement, query: QueryClient,
  snapshot: CollectionPublicSnapshot, rows: BrowserMarketSoulsPage, params: Promise<{ id: string }>, unmounted: boolean
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) }) }
async function render(strict = false) {
  await act(async () => root.render(<QueryClientProvider client={query}>{strict ? <StrictMode><Page params={params} /></StrictMode> : <Page params={params} />}</QueryClientProvider>)); await settle()
}
const find = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
const click = async (text: string) => { expect(find(text), text).toBeTruthy(); await act(async () => find(text).click()); await settle() }
function rootPage(c = snapshot): CollectionDetailDiscoveryResult {
  return { collection: c, phase: 'COLLECTION', candidateStatus: 'COMPLETE', listingSource: f.source('market::CollectionListing'),
    verifiedListingCandidates: 1, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true }
}
function setViewer(viewer: string | null) {
  h.account = viewer === null ? null : { address: viewer }; h.wallet = viewer === null ? null : {}
  snapshot.relationship = viewer === snapshot.creatorAddress ? viewer === snapshot.currentHolderAddress ? 'CREATED_HELD' : 'CREATED_SOLD'
    : viewer === snapshot.currentHolderAddress ? 'ACQUIRED' : 'UNRELATED'
  rows = { ...rows, souls: rows.souls.map(s => ({ ...s, viewerAddress: viewer })) }
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  vi.clearAllMocks(); f = await publicMarketFixture(); h.account = null; h.wallet = null; h.client = { grpc: {} }
  h.config = structuredClone(f.config); h.configError = null; h.roots = []; h.members = []; h.modal = null
  snapshot = f.collection(500, { currentSupply: '25', maxSupply: null, creatorAddress: id(700), currentHolderAddress: id(701) })
  rows = f.souls(Array.from({ length: 25 }, (_, n) => f.soul(300 + n, { collectionOnChainId: snapshot.collectionId })))
  h.rootFactory.mockReset().mockImplementation(options => { const s = { options, next: vi.fn(async () => rootPage()) }; h.roots.push(s); return s })
  h.membersFactory.mockReset().mockImplementation(options => { const s = { options, next: vi.fn(async () => rows) }; h.members.push(s); return s })
  h.buy.mockReset().mockResolvedValue({}); params = Promise.resolve({ id: snapshot.collectionId }); unmounted = false
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); query.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('anonymous deep link connects exact known-root reader and COLLECTION member selection without auth', async () => {
  await render()
  expect(h.roots[0].options).toMatchObject({ collectionId: snapshot.collectionId, viewerAddress: null })
  expect(h.members[0].options).toMatchObject({ viewerAddress: null, selection: { kind: 'COLLECTION', collectionId: snapshot.collectionId } })
  expect(host.querySelector('h1')?.textContent).toBe(snapshot.name)
  expect(host.textContent).toContain('Launch date unavailable'); expect(host.textContent).toContain('25 verified members')
  expect(host.querySelectorAll('a[href^="/souls/"]')).toHaveLength(12)
  expect(host.textContent).not.toContain('mirrored'); expect(host.querySelector('a[href^="/create?"]')).toBeNull()
})
it('member page changes reuse both scans and render all25 rows across3 pages', async () => {
  await render(); await click('Next members'); expect(host.textContent).toContain('page 2 of 3')
  expect(host.querySelector(`a[href="/souls/${id(312)}"]`)).toBeTruthy()
  await click('Next members'); expect(host.querySelectorAll('a[href^="/souls/"]')).toHaveLength(1)
  expect(h.rootFactory).toHaveBeenCalledOnce(); expect(h.membersFactory).toHaveBeenCalledOnce()
  await click('Previous members'); expect(host.textContent).toContain('page 2 of 3')
})
it('sold creator keeps Add Soul but cannot list the holder Right', async () => {
  setViewer(snapshot.creatorAddress); await render()
  expect(host.textContent).toContain('You created this'); expect(host.querySelector('a[href^="/create?"]')).toBeTruthy()
  expect(find('List Soul Collection')).toBeUndefined()
})
it('acquired holder can list/reprice/delist, never gains Add Soul', async () => {
  setViewer(snapshot.currentHolderAddress); await render(); await click('List Soul Collection')
  expect(h.modal.collection.onChainId).toBe(snapshot.collectionId); expect(host.querySelector('a[href^="/create?"]')).toBeNull()
  await click('Close modal'); expect(h.rootFactory.mock.calls.length).toBeGreaterThan(1)
})
it('creator-held and nontradeable retain original control variants and exact Add Soul capacity', async () => {
  snapshot.currentHolderAddress = snapshot.creatorAddress; setViewer(snapshot.creatorAddress)
  snapshot.currentSupply = '9007199254740992'; snapshot.maxSupply = '9007199254740993'
  await render(); expect(find('List Soul Collection')).toBeTruthy(); expect(host.querySelector('a[href^="/create?"]')).toBeTruthy()
  expect(host.textContent).toContain('9007199254740992 / 9007199254740993')
  snapshot.rightTradeable = false; snapshot.currentSupply = snapshot.maxSupply
  await click('Refresh Collection'); expect(host.textContent).toContain('Non-tradeable'); expect(host.textContent).toContain('Supply reached')
  expect(host.querySelector('a[href^="/create?"]')).toBeNull()
})
function listed() {
  snapshot.status = 'LISTED'; snapshot.listingId = id(999); snapshot.priceAtomic = '1000000'
  snapshot.quote = { model: 'BASE_PLUS_FEES', priceAtomic: '1000000', platformFeeAtomic: '25000', totalPaymentAtomic: '1025000', available: true }
}
it('listed sold creator retains buy-back plus Add Soul and additive platform quote', async () => {
  listed(); setViewer(snapshot.creatorAddress); await render()
  expect(find('Buy Collection Cap')).toBeTruthy(); expect(host.textContent).toContain('1.025')
  expect(host.textContent).toContain('SUI gas'); expect(host.querySelector('a[href^="/create?"]')).toBeTruthy()
  await click('Buy Collection Cap'); expect(h.buy).not.toHaveBeenCalled()
  await click('Review purchase transaction'); expect(h.buy).toHaveBeenCalledOnce()
})
it('listed owner retains original edit and delist controls without self-purchase', async () => {
  listed(); setViewer(snapshot.currentHolderAddress); await render()
  expect(find('Buy Collection Cap')).toBeUndefined(); await click('Edit Price'); expect(h.modal).toBeTruthy()
  await click('Close modal'); await click('Delist'); expect(h.modal).toBeTruthy()
})
it('verified unavailable reservation and disabled market never offer a usable Buy', async () => {
  snapshot.status = 'UNAVAILABLE'; snapshot.unavailableReason = 'RESERVATION_UNMATCHED'; await render()
  expect(host.textContent).toContain('Listing state unavailable'); expect(find('Buy Collection Cap')).toBeUndefined()
  listed(); snapshot.quote!.available = false; await click('Refresh Collection'); expect(find('Buy Collection Cap').disabled).toBe(true)
})
it('member transient failure keeps completed root and retries the same reader before permitting empty counts', async () => {
  h.membersFactory.mockImplementation(options => { const s = { options, next: vi.fn().mockRejectedValueOnce(Error('member RPC offline')).mockResolvedValue(f.souls([])) }; h.members.push(s); return s })
  snapshot.currentSupply = '0'; await render()
  expect(host.querySelector('h1')).toBeTruthy(); expect(host.textContent).toContain('member RPC offline')
  expect(host.textContent).toContain('No member Souls verified yet'); expect(host.textContent).toContain('Unavailable')
  await click('Continue Member Souls'); expect(h.membersFactory).toHaveBeenCalledOnce(); expect(host.textContent).toContain('No Souls yet')
})
it('known root read failure is visible/retryable, never a fake not-found projection', async () => {
  h.rootFactory.mockImplementation(options => { const s = { options, next: vi.fn().mockRejectedValueOnce(Error('raw root unavailable')).mockResolvedValue(rootPage()) }; h.roots.push(s); return s })
  await render(); expect(host.textContent).toContain('Collection read unavailable'); expect(host.textContent).not.toContain('not found')
  await click('Continue Collection'); expect(h.roots[0].next).toHaveBeenCalledTimes(2); expect(host.querySelector('h1')).toBeTruthy()
})
it('healthy progressive Listing pages keep the root loading state rather than reporting unavailable', async () => {
  const gate = deferred<CollectionDetailDiscoveryResult>()
  h.rootFactory.mockImplementation(options => { const s = { options, next: vi.fn()
    .mockResolvedValueOnce({ ...rootPage(), collection: null, phase: 'LISTINGS', candidateStatus: 'PARTIAL' })
    .mockReturnValueOnce(gate.promise) }; h.roots.push(s); return s })
  await render(); expect(host.textContent).toContain('Reading chain…'); expect(host.textContent).not.toContain('Collection read unavailable')
  expect(host.querySelector('h1')).toBeNull()
  await act(async () => gate.resolve(rootPage())); await settle(); expect(host.querySelector('h1')).toBeTruthy()
})
it('prefix invalidation restarts both current root and members, with no rescan for another Collection ID', async () => {
  await render(); await act(async () => { await query.invalidateQueries({ queryKey: ['collection', id(123)] }) }); await settle()
  expect(h.rootFactory).toHaveBeenCalledOnce()
  await act(async () => { await query.invalidateQueries({ queryKey: ['collection', snapshot.collectionId] }) }); await settle()
  expect(h.rootFactory).toHaveBeenCalledTimes(2); expect(h.membersFactory).toHaveBeenCalledTimes(2)
})
it('wallet ABA drops late member/root results and callbacks from the prior detail/modal identity', async () => {
  setViewer(snapshot.currentHolderAddress); await render(); await click('List Soul Collection')
  const close = h.modal.onClose, oldRoots = h.roots.slice(), oldMembers = h.members.slice()
  setViewer(null); await render(); setViewer(snapshot.currentHolderAddress); await render()
  const before = h.rootFactory.mock.calls.length
  await act(async () => close()); await settle(); expect(h.rootFactory).toHaveBeenCalledTimes(before)
  expect(oldRoots.every(s => s.options.signal.aborted)).toBe(true); expect(oldMembers.every(s => s.options.signal.aborted)).toBe(true)
})
it('late purchase success callback after wallet switch cannot toast/invalidate a replacement page', async () => {
  listed(); await render(); const oldSuccess = h.onBuySuccess!
  setViewer(id(333)); await render(); const before = h.rootFactory.mock.calls.length
  await act(async () => oldSuccess()); await settle(); expect(h.toast).not.toHaveBeenCalled(); expect(h.rootFactory).toHaveBeenCalledTimes(before)
})
it('StrictMode replay completes both replacement readers without retaining cancelled results', async () => {
  await render(true); expect(host.querySelector('h1')).toBeTruthy(); expect(host.textContent).toContain('25 verified members')
  expect(h.roots.at(-1).options.signal.aborted).toBe(false); expect(h.members.at(-1).options.signal.aborted).toBe(false)
})
it('invalid config has visible retry and performs no chain scan', async () => {
  h.configError = 'Release not configured'; await render()
  expect(host.textContent).toContain('Release not configured'); expect(h.rootFactory).not.toHaveBeenCalled()
  h.configError = null; await render(); expect(host.querySelector('h1')).toBeTruthy()
})
