// @vitest-environment jsdom
// Real page components, tabs, cards and private controls. The shared wallet
// coordinator and read hooks are doubled; their proof paths have separate suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import MarketPage from '../../web/app/market/page'
import MySoulsPage from '../../web/app/my-souls/page'

const h = vi.hoisted(() => ({ actions: {} as any, rows: {} as any, auth: {} as any, my: {} as any, souls: {} as any,
  collections: {} as any, useRows: vi.fn(), useMy: vi.fn(), useSouls: vi.fn(), useCollections: vi.fn(), login: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('../../web/lib/hooks/use-private-bookmarks', () => ({ usePrivateBookmarks: () => h.actions }))
vi.mock('../../web/lib/hooks/use-bookmark-rows', () => ({ useBookmarkRows: (enabled: boolean) => { h.useRows(enabled); return h.rows } }))
vi.mock('../../web/lib/hooks/use-souls', () => ({ useMySouls: (...args: any[]) => { h.useMy(...args); return h.my },
  useSoulsList: (...args: any[]) => { h.useSouls(...args); return h.souls } }))
vi.mock('../../web/lib/hooks/use-collections', () => ({ useCollectionsList: (...args: any[]) => { h.useCollections(...args); return h.collections } }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => h.login }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => h.auth }))
vi.mock('../../web/components/souls/soul-cover-image', () => ({ SoulCoverImage: ({ imageUrl, children, className }: any) =>
  <div data-cover-url={imageUrl ?? ''} className={className}>{children}</div> }))
vi.mock('../../web/components/souls/soul-artwork-image', () => ({ SoulArtworkImage: (props: any) => <img {...props} /> }))
vi.mock('../../web/components/souls/grant-modal', () => ({ GrantModal: () => <div>Grant dialog</div> }))
vi.mock('../../web/components/collections/collection-section', () => ({ CollectionSection: () => <div>Collection cards</div> }))
vi.mock('../../web/components/collections/collection-listing-modals', () => ({ ListCollectionModal: () => null,
  EditCollectionPriceModal: () => null, DelistCollectionModal: () => null }))
// Keep bookmark interactions real without mounting independent trading wallets.
vi.mock('../../web/components/souls/native-batch-listing-panel', () => ({ NativeBatchListingPanel: () => null,
  batchSelectionId: (row: any) => row.assetType === 'equipment' ? row.itemId : row.soulId }))
vi.mock('../../web/components/souls/owned-equipment-selection', () => ({ OwnedEquipmentSelection: () => null }))
vi.mock('../../web/components/souls/equipment-market-browser', () => ({ EquipmentMarketBrowser: () => null }))

const owner = `0x${'a'.repeat(64)}`, soulId = `0x${'b'.repeat(64)}`, unavailableId = `0x${'c'.repeat(64)}`
const createdAt = '2026-09-15T00:00:00.000Z'
const entry = (id = soulId) => ({ soulId: id, createdAt })
const soul = () => ({ id: 'retired-sql-row-77', onChainId: soulId, name: 'Chain Soul', description: 'Verified public details',
  imageUrl: null, tags: ['Agent'], listingStatus: 'listed', listedPriceAtomic: '1200000', collectionOnChainId: null,
  createdAt, createdAtMs: '1789430400000', updatedAt: createdAt, provenanceKind: 'native', activeGrantCount: '0', effectiveGrantCount: '0', activeGrantDetails: [] })
const loadedRows = (partial = false) => ({ rows: [{ status: 'AVAILABLE', soulId, detail: soul() },
  ...(partial ? [{ status: 'UNAVAILABLE', soulId: unavailableId, error: 'Public detail unavailable' }] : [])],
  page: 0, pageCount: 1, hasPrevious: false, hasNext: false, partial })
let root: Root, host: HTMLDivElement
const render = async (which: 'market' | 'my' = 'market') => { await act(async () => root.render(which === 'market' ? <MarketPage /> : <MySoulsPage />)) }
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
const textButton = (text: string) => buttons().find(b => b.textContent === text)!
const labelButton = (label: string) => buttons().find(b => b.getAttribute('aria-label') === label)!
const click = async (button: HTMLButtonElement) => { expect(button).toBeTruthy(); await act(async () => button.click()) }
const bookmarksTab = () => buttons().find(b => /^Bookmarks(?: \(\d+\))?$/.test(b.textContent ?? ''))!
const openBookmarks = async () => { await render('my'); await click(bookmarksTab()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ tags: [] }) })))
  h.actions = { privacyKey: 'wallet-a:0', owner, connected: true, entries: null, revision: null,
    locked: true, busy: false, loading: false, writesEnabled: true, pending: false, canExport: false, endEpoch: null, error: null, notice: null,
    unlock: vi.fn(async () => {}), refresh: vi.fn(async () => {}), lock: vi.fn(), renew: vi.fn(async () => {}),
    query: vi.fn(async () => {}), retry: vi.fn(async () => {}), rebase: vi.fn(async () => {}), dismiss: vi.fn(async () => {}),
    exportRecovery: vi.fn(), importRecovery: vi.fn(async () => {}), setBookmark: vi.fn(async () => {}) }
  h.rows = { page: null, loading: false, error: null, refresh: vi.fn(async () => {}), retryFailed: vi.fn(async () => {}),
    previous: vi.fn(async () => {}), next: vi.fn(async () => {}) }
  // Wallet login alone is enough; deliberately no public Profile or SQL user row.
  h.auth = { user: { id: owner, address: owner }, loading: false, getAuthHeaders: vi.fn() }
  h.my = { data: { owned: [], collections: [], grants: [], purchases: [],
    coverage: { owned: 'COMPLETE', collections: 'COMPLETE', activity: 'COMPLETE' },
    totals: { listedCount: 0, listedValueAtomic: '0', listedComplete: true, effectiveGrantCount: '0', ownedComplete: true, belowFloorCount: 0 } },
    connected: true, owner, identityKey: 'wallet-a:0', isLoading: false, error: null,
    refresh: vi.fn(async () => {}), resume: vi.fn(async () => {}), pause: vi.fn() }
  const source = () => ({ isLoading: false, error: null, progress: { coverage: 'COMPLETE', pages: 2, busy: false, phase: 'SOULS', checkpoint: '100' },
    pause: vi.fn(), resume: vi.fn(async () => {}), refresh: vi.fn(async () => {}) })
  h.souls = { ...source(), data: { items: [soul()], complete: true, total: 1, totalPages: 1, page: 1, pageSize: 12, tags: [] },
    creators: { loading: false, error: null, unavailable: 0, retry: vi.fn(async () => {}) } }
  h.collections = { ...source(), data: { items: [], complete: true, total: 0, totalPages: 1, page: 1, pageSize: 12 } }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('Market unlocks first without toggling or presenting an unknown state as unsaved', async () => {
  await render(); const button = labelButton('Unlock private bookmarks')
  expect(button.hasAttribute('aria-pressed')).toBe(false); expect(button.classList.contains('ph-no-capture')).toBe(true)
  await click(button); expect(h.actions.unlock).toHaveBeenCalledOnce(); expect(h.actions.setBookmark).not.toHaveBeenCalled()
  expect(host.querySelector('a[href="/souls/' + soulId + '"]')).not.toBeNull()
})
it('Market commits the actual chain Soul ID and explicit desired state, never the retired SQL ID', async () => {
  h.actions.entries = []; h.actions.locked = false; await render()
  await click(labelButton('Bookmark this Soul')); expect(h.actions.setBookmark).toHaveBeenCalledWith(soulId, true)
  expect(h.actions.setBookmark).not.toHaveBeenCalledWith('retired-sql-row-77', expect.anything())
  // A resolved action alone is not confirmation of changed bookmark membership.
  expect(labelButton('Bookmark this Soul').getAttribute('aria-pressed')).toBe('false')
  h.actions = { ...h.actions, entries: [entry()] }; await render()
  expect(labelButton('Remove bookmark').getAttribute('aria-pressed')).toBe('true')
  await click(labelButton('Remove bookmark')); expect(h.actions.setBookmark).toHaveBeenLastCalledWith(soulId, false)
})
it('Market does not render an optimistic saved state while signing or after failure', async () => {
  h.actions.entries = []; h.actions.locked = false; let reject!: (e: Error) => void
  h.actions.setBookmark.mockImplementationOnce(() => new Promise<void>((_, r) => { reject = r }))
  await render(); await click(labelButton('Bookmark this Soul'))
  expect(labelButton('Bookmark this Soul').getAttribute('aria-pressed')).toBe('false')
  await act(async () => { h.actions.error = 'Wallet declined'; reject(Error('Wallet declined')) }); await render()
  expect(labelButton('Remove bookmark')).toBeUndefined(); expect(labelButton('Bookmark this Soul').getAttribute('aria-pressed')).toBe('false')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Wallet declined')
  expect(host.querySelector('details')?.open).toBe(true)
})
it.each(['busy', 'loading', 'pending', 'closed'] as const)('Market blocks mutation while %s', async gate => {
  h.actions.entries = []; h.actions.locked = false
  if (gate === 'closed') h.actions.writesEnabled = false; else h.actions[gate] = true
  await render(); expect(labelButton('Bookmark this Soul').disabled).toBe(true)
  await click(labelButton('Bookmark this Soul')); expect(h.actions.setBookmark).not.toHaveBeenCalled()
})
it('Market permits a read-only unlock in a write-closed release and exposes pending recovery', async () => {
  h.actions.writesEnabled = false; await render(); expect(labelButton('Unlock private bookmarks').disabled).toBe(false)
  await click(labelButton('Unlock private bookmarks')); expect(h.actions.unlock).toHaveBeenCalledOnce()
  h.actions = { ...h.actions, pending: true }; await render()
  expect(host.querySelector('details')?.open).toBe(true); expect(host.querySelector('details')?.classList.contains('ph-no-capture')).toBe(true)
  await click(textButton('Query bookmark request')); expect(h.actions.query).toHaveBeenCalledOnce()
  expect(textButton('Resume same bookmark request').disabled).toBe(true)
})
it('Market hides wallet-only bookmark controls while disconnected without changing existing cards', async () => {
  h.actions.connected = false; await render()
  expect(labelButton('Unlock private bookmarks')).toBeUndefined(); expect(host.querySelector('[aria-label="Private bookmarks"]')).toBeNull()
  expect(host.querySelectorAll('.card.card-hover')).toHaveLength(1)
  expect(host.querySelector('.card h3')?.textContent).toBe('Chain Soul')
  expect(host.querySelector('[data-cover-url]')?.classList.contains('aspect-[4/5]')).toBe(true)
})
it('Market still filters out non-listings and preserves collection navigation', async () => {
  h.souls.data.items.push({ ...soul(), id: 'not-listed', name: 'Not listed Soul', listingStatus: 'unlisted' })
  await render(); expect(host.textContent).not.toContain('Not listed Soul')
  await click(textButton('+ Collections')); expect(host.textContent).toContain('No collections yet')
  expect(textButton('Caps for Sale')).toBeTruthy(); await click(textButton('Souls')); expect(host.textContent).toContain('Chain Soul')
})

it('My Souls preserves all five tabs and does not publish a zero bookmark count while locked', async () => {
  await render('my'); expect(bookmarksTab().textContent).toBe('Bookmarks')
  expect(buttons().filter(b => /^(Owned|Collections|Listings|Activity|Bookmarks)(?: \(\d+\))?$/.test(b.textContent ?? '')).map(b => b.textContent))
    .toEqual(['Owned (0)', 'Collections (0)', 'Listings (0)', 'Activity', 'Bookmarks'])
  expect(bookmarksTab().closest('.ph-no-capture')).not.toBeNull()
  expect(h.useMy).toHaveBeenCalledWith(); expect(h.auth.getAuthHeaders).not.toHaveBeenCalled(); expect(h.useRows).toHaveBeenLastCalledWith(false)
  await click(bookmarksTab()); expect(h.useRows).toHaveBeenLastCalledWith(true)
  expect(host.textContent).toContain('locked or unavailable, not empty'); expect(host.textContent).not.toContain('No bookmarks yet')
})
it('My Souls counts every private entry including unavailable and off-page Souls', async () => {
  h.actions.entries = [entry(), entry(unavailableId), entry(`0x${'d'.repeat(64)}`)]; h.actions.locked = false
  h.rows.page = loadedRows(true); await openBookmarks()
  expect(bookmarksTab().textContent).toBe('Bookmarks (3)'); expect(host.textContent).toContain('Bookmarked Souls (3)')
  expect(host.querySelectorAll('button[aria-label^="Remove bookmark "]')).toHaveLength(2)
  expect(host.textContent).toContain('Soul information unavailable'); expect(host.textContent).toContain(unavailableId)
  expect(host.querySelector('a[href="/souls/' + unavailableId + '"]')?.textContent).toBe('Open Soul')
  await click(labelButton(`Remove bookmark ${unavailableId}`)); expect(h.actions.setBookmark).toHaveBeenCalledWith(unavailableId, false)
  expect(bookmarksTab().textContent).toBe('Bookmarks (3)')
  await click(textButton('Retry unavailable Souls')); expect(h.rows.retryFailed).toHaveBeenCalledOnce()
})
it('My Souls uses verified public details in the original cover/card layout', async () => {
  h.actions.entries = [entry()]; h.actions.locked = false; h.rows.page = loadedRows(); await openBookmarks()
  const remove = labelButton(`Remove bookmark ${soulId}`), card = remove.parentElement!.parentElement!
  expect(card.classList.contains('rounded-xl')).toBe(true); expect(card.parentElement?.classList.contains('lg:grid-cols-3')).toBe(true)
  expect(card.querySelector('[data-cover-url]')?.classList.contains('aspect-[4/5]')).toBe(true)
  expect(card.textContent).toContain('Chain Soul'); expect(card.textContent).toContain('Verified public details')
  expect(card.querySelector('a')?.getAttribute('href')).toBe(`/souls/${soulId}`)
  expect(card.closest('.ph-no-capture')).not.toBeNull()
})
it.each(['busy', 'loading', 'pending', 'closed'] as const)('My Souls disables removal while %s without dropping an unavailable ID', async gate => {
  h.actions.entries = [entry(), entry(unavailableId)]; h.actions.locked = false; h.rows.page = loadedRows(true)
  if (gate === 'closed') h.actions.writesEnabled = false; else h.actions[gate] = true
  await openBookmarks(); expect(labelButton(`Remove bookmark ${unavailableId}`).disabled).toBe(true)
  await click(labelButton(`Remove bookmark ${unavailableId}`)); expect(h.actions.setBookmark).not.toHaveBeenCalled()
  expect(host.querySelector('a[href="/souls/' + unavailableId + '"]')).not.toBeNull()
})
it('My Souls retains membership and unavailable rows after a failed removal', async () => {
  h.actions.entries = [entry(), entry(unavailableId)]; h.actions.locked = false; h.rows.page = loadedRows(true)
  h.actions.setBookmark.mockRejectedValueOnce(Error('Unknown signed transaction')); await openBookmarks()
  await click(labelButton(`Remove bookmark ${unavailableId}`))
  h.actions.error = 'Unknown signed transaction'; h.actions.pending = true; await render('my')
  expect(bookmarksTab().textContent).toBe('Bookmarks (2)'); expect(host.textContent).toContain(unavailableId)
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unknown signed transaction')
  expect(textButton('Query bookmark request')).toBeTruthy()
})
it('My Souls separates public page failure from an empty or lost private library', async () => {
  h.actions.entries = [entry(), entry(unavailableId)]; h.actions.locked = false; h.rows.error = 'Reader offline'; await openBookmarks()
  expect(bookmarksTab().textContent).toBe('Bookmarks (2)'); expect(host.textContent).toContain('Your private bookmark entries are retained')
  expect(host.textContent).not.toContain('No bookmarks yet'); await click(textButton('Retry bookmark page'))
  expect(h.rows.refresh).toHaveBeenCalledOnce(); expect(h.actions.setBookmark).not.toHaveBeenCalled()
})
it('My Souls exposes complete page navigation and disables it during loading', async () => {
  h.actions.entries = [entry()]; h.actions.locked = false
  h.rows.page = { ...loadedRows(), page: 1, pageCount: 3, hasPrevious: true, hasNext: true }; await openBookmarks()
  expect(host.querySelector('[aria-label="Bookmark pages"]')?.textContent).toContain('Page 2 of 3')
  await click(textButton('Previous bookmarks')); await click(textButton('Next bookmarks'))
  expect(h.rows.previous).toHaveBeenCalledOnce(); expect(h.rows.next).toHaveBeenCalledOnce()
  h.rows.loading = true; await render('my'); expect(textButton('Previous bookmarks').disabled).toBe(true)
  expect(textButton('Next bookmarks').disabled).toBe(true); expect(host.textContent).toContain('Loading public Soul information')
})
it('My Souls shows an empty list only after a verified explicit empty unlock', async () => {
  await openBookmarks(); expect(host.textContent).not.toContain('No bookmarks yet')
  h.actions = { ...h.actions, entries: [], locked: false, revision: '0' }; await render('my')
  expect(bookmarksTab().textContent).toBe('Bookmarks (0)'); expect(host.textContent).toContain('No bookmarks yet')
  expect(host.querySelectorAll('button[aria-label^="Remove bookmark "]')).toHaveLength(0)
})
it('My Souls hides all private IDs and counts on a wallet/privacy change even if the row hook has an old page', async () => {
  h.actions.entries = [entry(), entry(unavailableId)]; h.actions.locked = false; h.rows.page = loadedRows(true); await openBookmarks()
  expect(host.textContent).toContain(unavailableId)
  h.actions = { ...h.actions, privacyKey: 'wallet-b:1', owner: 'wallet-b', entries: null, locked: true, revision: null }; await render('my')
  expect(bookmarksTab().textContent).toBe('Bookmarks'); expect(host.textContent).not.toContain(unavailableId)
  expect(host.textContent).not.toContain('Chain Soul'); expect(host.querySelector('[aria-label="Bookmark pages"]')).toBeNull()
})
it('My Souls bookmarks remain usable when portfolio data is unavailable and no public Profile exists', async () => {
  h.my = { ...h.my, data: undefined, isLoading: false, error: Error('Portfolio reader offline') }
  h.actions.entries = [entry()]; h.actions.locked = false; h.rows.page = loadedRows(); await openBookmarks()
  expect(host.textContent).toContain('Chain Soul'); expect(host.textContent).not.toContain('Sign in to load')
  expect(h.auth.user).not.toHaveProperty('profile'); expect(h.useMy).toHaveBeenCalledWith(); expect(h.auth.getAuthHeaders).not.toHaveBeenCalled()
})
it('My Souls preserves owned/listed card actions and the original portfolio summary', async () => {
  h.my.data.owned = [soul()]; h.my.data.totals.listedCount = 1; h.my.data.totals.listedValueAtomic = '1200000'; await render('my')
  expect(textButton('Owned (1)')).toBeTruthy(); expect(textButton('Listings (1)')).toBeTruthy()
  expect(host.textContent).toContain('Chain Soul'); expect(host.textContent).toContain('Listed on Sui')
  expect(host.querySelector('[data-portfolio-stat="Listed value"]')?.textContent).toContain('1 listed')
  expect([...host.querySelectorAll('a')].find(a => a.textContent === 'Delist')?.getAttribute('href')).toBe(`/souls/${soulId}`)
  await click(textButton('Listings (1)')); expect(host.textContent).toContain('Souls listed for sale')
  await click(textButton('Activity')); expect(host.textContent).toContain('No activity yet')
})
