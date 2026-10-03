// @vitest-environment jsdom
// Real original page/cards/controls and real selection model. Scanners and
// wallet/provider responses are controlled; hook/raw proof have separate suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import MarketPage from '../../web/app/market/page'
import { selectCollectionMarket, selectSoulMarket } from '../../web/lib/soulidity/public-market-model'
import { publicMarketFixture, id } from './fixtures/public-market'
const h = vi.hoisted(() => ({ soul: {} as any, collection: {} as any, bookmarks: {} as any,
  selectSouls: vi.fn(), selectCollections: vi.fn() }))
vi.mock('../../web/lib/hooks/use-souls', () => ({ useSoulsList: (params: unknown) => h.selectSouls(params) }))
vi.mock('../../web/lib/hooks/use-collections', () => ({ useCollectionsList: (params: unknown) => h.selectCollections(params) }))
vi.mock('../../web/lib/hooks/use-private-bookmarks', () => ({ usePrivateBookmarks: () => h.bookmarks }))
vi.mock('../../web/components/souls/equipment-market-browser',()=>({EquipmentMarketBrowser:()=> <section aria-label="Component Market">Component discovery boundary</section>}))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('../../web/components/souls/soul-cover-image', () => ({ SoulCoverImage: ({ imageUrl, className, children }: any) => <div className={className} data-cover-url={imageUrl}>{children}</div> }))
let f: Awaited<ReturnType<typeof publicMarketFixture>>, root: Root, host: HTMLDivElement
const render = async () => { await act(async () => root.render(<MarketPage />)) }
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
const click = async (text: string) => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()) }
const input = async (placeholder: string, value: string) => {
  const element = host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
  expect(element).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true })) })
}
const select = async (label: string, value: string) => {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })) })
}
const debounce = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(350) }) }
beforeAll(async () => {
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f = await publicMarketFixture()
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  const common = () => ({ error: null, isLoading: false,
    progress: { coverage: 'COMPLETE', pages: 3, busy: false, phase: 'SOULS', checkpoint: '100' },
    pause: vi.fn(), resume: vi.fn(async () => {}), refresh: vi.fn(async () => {}) })
  h.soul = { ...common(), rows: Array.from({ length: 25 }, (_, n) => f.soul(300 + n)), identities: {},
    creators: { loading: false, error: null, unavailable: 0, retry: vi.fn(async () => {}) } }
  h.collection = { ...common(), rows: Array.from({ length: 25 }, (_, n) => f.collection(500 + n)) }
  h.bookmarks = { connected: false }
  h.selectSouls.mockImplementation(params => {
    try { return { ...h.soul, data: selectSoulMarket({ ...f.scope, souls: h.soul.rows, coverage: h.soul.progress.coverage,
      identities: h.soul.identities }, params) } } catch (error) { return { ...h.soul, data: undefined, error } }
  })
  h.selectCollections.mockImplementation(params => ({ ...h.collection, data: selectCollectionMarket({ ...f.scope,
    collections: h.collection.rows, coverage: h.collection.progress.coverage }, params) }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })

it('preserves anonymous original page layout, cover/cards, tags and chain-ID navigation', async () => {
  await render()
  expect(host.textContent).toContain('Digital Entity Marketplace'); expect(host.querySelector('a[href="/my-souls"]')).toBeTruthy()
  expect(host.querySelector('a[href="/create"]')).toBeTruthy(); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(12)
  expect(host.querySelector(`[href="/souls/${id(324)}"]`)).toBeTruthy()
  expect(host.querySelector('[data-cover-url]')?.classList.contains('aspect-[4/5]')).toBe(true)
  expect(host.textContent).toContain('25 matching verified assets'); expect(host.querySelector('[aria-label="Souls scan"]')).toBeTruthy()
})
it('opens Components in the original Market navigation and retains the Soul view',async()=>{
  await render();await click('Components');expect(host.querySelector('[aria-label="Component Market"]')).toBeTruthy()
  await click('Souls');expect(host.querySelector('[aria-label="Component Market"]')).toBeNull()
  expect(host.querySelectorAll('.card.card-hover')).toHaveLength(12)
})
it('real controls paginate the complete model and reset the selected page when a filter changes', async () => {
  await render(); await click('Next page'); expect(host.textContent).toContain('page 2 of 3')
  expect(host.querySelector(`[href="/souls/${id(312)}"]`)).toBeTruthy()
  await click('Next page'); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(1)
  h.soul.rows[24].name = 'Rare later match'; await input('Search souls...', 'later'); await debounce()
  expect(host.querySelectorAll('.card.card-hover')).toHaveLength(1); expect(host.textContent).toContain('Rare later match')
  expect(host.textContent).toContain('page 1 of 1'); expect(h.selectSouls.mock.lastCall?.[0]).toMatchObject({ q: 'later', page: 1 })
})
it('tags and persona controls operate on the full set rather than the visible first page', async () => {
  h.soul.rows[0] = f.soul(300, { tags: ['Rare'], personaKind: 'characters' })
  await render(); await click('rare'); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(1)
  expect(host.textContent).toContain('Soul 300'); await click('Filters'); await select('Persona filter', 'agents')
  expect(host.textContent).toContain('No live Soul listings'); await select('Persona filter', 'characters')
  expect(host.textContent).toContain('Soul 300'); expect(h.selectSouls.mock.lastCall?.[0]).toMatchObject({ tag: 'rare', persona: 'characters' })
})
it('public name and handle filtering remains explicit and uncertain identities do not mean no-match', async () => {
  h.soul.rows = [f.soul(300)]; const address = h.soul.rows[0].creatorAddress
  h.soul.creators.unavailable = 1; await render(); await click('Filters'); await input('Address or name...', 'alice'); await debounce()
  expect(host.textContent).toContain('name filtering may be incomplete'); expect(host.textContent).toContain('No matching Souls in the verified results so far')
  await click('Retry creator identities'); expect(h.soul.creators.retry).toHaveBeenCalledOnce()
  h.soul.identities[address] = { address, status: 'VERIFIED', profileId: id(99), displayName: 'Alice Creator', handle: 'alice_art', error: null }
  h.soul.creators.unavailable = 0; await render(); expect(host.textContent).toContain('Soul 300')
  await input('Address or name...', 'ART'); await debounce(); expect(host.textContent).toContain('Soul 300')
})
it.each(['-1', '0.0000001', '18446744073709.551616'])('invalid displayed price %s is an error, never an omitted filter with unfiltered cards', async value => {
  await render(); await click('Filters'); await input('Min', value)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('non-negative USDC price')
  expect(host.querySelectorAll('.card.card-hover')).toHaveLength(0)
  expect(host.textContent).not.toContain('No live Soul listings')
})
it('price range handles zero, exact large decimals and reversed ranges without Number coercion', async () => {
  h.soul.rows = [f.soul(300, { listedPriceAtomic: '9007199254740993' }), f.soul(301, { listedPriceAtomic: '9007199254740992' })]
  await render(); await click('Filters'); await input('Min', '0'); expect(h.selectSouls.mock.lastCall?.[0].minPrice).toBe('0')
  await input('Min', '9007199254.740993'); await input('Max', '9007199254.740993')
  expect(host.querySelectorAll('.card.card-hover')).toHaveLength(1); expect(h.selectSouls.mock.lastCall?.[0]).toMatchObject({ minPrice: '9007199254740993', maxPrice: '9007199254740993' })
  await input('Max', '1'); expect(host.textContent).toContain('Minimum price must not exceed maximum price.'); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(0)
  await click('Clear filters'); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(2)
})
it('shows the actual buyer total including ordinary fees and keeps below-floor listings out', async () => {
  const row = f.soul(300); row.quote = { ...row.quote!, totalAtomic: '1250000' }
  h.soul.rows = [row, f.soul(301, { listingStatus: 'floor-violation', name: 'Below floor hidden' })]
  await render(); expect(host.textContent).toContain('Buyer total 1.25 USDC + SUI gas')
  expect(host.textContent).not.toContain('+ network fee at checkout'); expect(host.textContent).not.toContain('Below floor hidden')
})
it('partial failure retains real rows and exposes same-page retry without pretending complete', async () => {
  h.soul.rows = [f.soul(300)]; h.soul.progress.coverage = 'PARTIAL'; h.soul.error = Error('Raw page unavailable')
  await render(); expect(host.textContent).toContain('Raw page unavailable'); expect(host.textContent).toContain('Soul 300')
  expect(host.textContent).toContain('1+ matching verified assets'); await click('Continue / retry Souls'); expect(h.soul.resume).toHaveBeenCalledOnce()
  await click('Refresh Souls'); expect(h.soul.refresh).toHaveBeenCalledOnce()
})
it('initial configuration failure is visible, not an empty result, and retry does not use a no-op missing scan', async () => {
  h.soul.rows = []; h.soul.progress = { ...h.soul.progress, coverage: 'UNSCANNED', phase: null, pages: 0 }; h.soul.error = Error('Release missing')
  await render(); expect(host.textContent).toContain('Release missing'); expect(host.textContent).not.toContain('No live Soul listings')
  await click('Continue / retry Souls'); expect(h.soul.refresh).toHaveBeenCalledOnce(); expect(h.soul.resume).not.toHaveBeenCalled()
})
it('paused, still-loading and limited scans have distinct controls and cannot claim complete empty', async () => {
  h.soul.rows = []; h.soul.progress.coverage = 'PARTIAL'; h.soul.progress.busy = true
  await render(); await click('Pause Souls'); expect(h.soul.pause).toHaveBeenCalledOnce()
  h.soul.progress.busy = false; await render(); expect(button('Continue / retry Souls')).toBeTruthy()
  h.soul.progress.coverage = 'LIMIT_REACHED'; await render(); expect(host.textContent).toContain('not complete Market totals')
  expect(button('Continue / retry Souls')).toBeUndefined(); expect(host.textContent).not.toContain('No live Soul listings')
})
it('Collection for-sale filters before pagination and all retains non-tradeable and exact supply', async () => {
  h.collection.rows[0] = f.collection(500, { rightTradeable: false, currentSupply: '18446744073709551615' })
  h.collection.rows[24] = f.collection(524, { status: 'LISTED', listingId: id(90), priceAtomic: '1000000' })
  await render(); await click('+ Collections'); expect(host.textContent).toContain('Non-tradeable · permanent')
  expect(host.textContent).toContain('18446744073709551615'); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(12)
  await click('Caps for Sale'); expect(host.querySelectorAll('.card.card-hover')).toHaveLength(1)
  expect(host.querySelector(`[href="/collections/${id(524)}"]`)).toBeTruthy(); expect(h.selectCollections.mock.lastCall?.[0]).toMatchObject({ listed: true, page: 1 })
  await click('All Collections'); expect(h.selectCollections.mock.lastCall?.[0].listed).toBe(false)
})
it('unknown Collection reservation is never labelled Held or a complete for-sale empty', async () => {
  h.collection.rows = [f.collection(500, { status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED' })]
  await render(); await click('+ Collections'); expect(host.textContent).toContain('Listing state unavailable')
  expect(host.textContent).not.toContain('Held by creator'); expect(host.textContent).not.toContain('Held by collector')
  await click('Caps for Sale'); expect(host.textContent).toContain('No matching Collections in the verified results so far')
})
it('Collection errors retain existing cards and pause/retry only their own source', async () => {
  h.collection.progress.coverage = 'PARTIAL'; h.collection.error = Error('Collection read failed')
  await render(); await click('+ Collections'); expect(host.textContent).toContain('Collection read failed')
  expect(host.querySelectorAll('.card.card-hover')).toHaveLength(12); await click('Continue / retry Collections')
  expect(h.collection.resume).toHaveBeenCalledOnce(); expect(h.soul.resume).not.toHaveBeenCalled()
})
