import { afterEach, expect, it, vi } from 'vitest'
import { toBase58 } from '@mysten/sui/utils'
import * as reader from '../../packages/soulidity-sdk/src/collection-public-read'
import { createCollectionPortfolioDiscovery } from '../../packages/soulidity-sdk/src/collection-portfolio-discovery'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const genesis = toBase58(new Uint8Array(32).fill(1)), viewer = id(91)
function setup(pages: Array<{ ids: number[]; more: boolean; checkpoint?: number }>, maxPages = 20, heldRightIds: string[] = []) {
  const fetcher = vi.fn<typeof fetch>()
  pages.forEach((page, i) => fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: { chainIdentifier: genesis,
    checkpoint: { sequenceNumber: page.checkpoint ?? 100, query: { objects: { nodes: page.ids.map(n => ({ address: id(n) })),
      pageInfo: { hasNextPage: page.more, endCursor: page.ids.length ? `opaque:${i}` : null } } } } } }))))
  const deployment = { originalPackageId: id(90), chainIdentifier: '01010101', marketConfigId: id(94),
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', kioskRegistryId: id(95), personalKioskTypePackageId: id(96) }
  const root = vi.spyOn(reader, 'readCollectionPublicRoot').mockImplementation(async ({ collectionId }) => ({
    collection: { id: collectionId, version: '1', creator: viewer, extra_royalty_bps: 0, tradeable: true, current_holder: viewer,
      current_holder_kiosk_id: id(80), right_id: id(81), max_supply: null, current_supply: '0' }, objectVersion: '2', objectDigest: genesis,
  }))
  const listing = vi.spyOn(reader, 'readCollectionListingCandidate').mockImplementation(async ({ listingId }) => ({
    listing: { id: listingId, version: '1', collection_id: id(1), right_id: id(81), seller: viewer, seller_kiosk_id: id(80),
      price: '100', purchase_cap: null, is_active: false }, objectVersion: '2', objectDigest: genesis,
  }))
  const right = vi.spyOn(reader, 'readCollectionRightCandidate').mockResolvedValue(id(6))
  const snapshot = vi.spyOn(reader, 'readCollectionPublicSnapshot').mockImplementation(async ({ collectionId, listingScan }) => ({
    collectionId, rightId: id(81), creatorAddress: viewer, currentHolderAddress: viewer, holderKioskId: id(80), name: collectionId,
    description: '', imageUrl: '', maxSupply: null, currentSupply: '0', extraRoyaltyBps: 0, rightTradeable: true, floorPriceAtomic: null,
    relationship: 'CREATED_HELD', status: 'HELD', unavailableReason: null, listingId: null, priceAtomic: null, isViewerListing: false,
    personalKioskCapId: id(82), market: { secondaryEnabled: true, platformFeeBps: 50 }, quote: null,
    currency: { coinType: deployment.paymentCoinType, symbol: 'USDC', decimals: 6 }, createdAtMs: null, updatedAtMs: null,
    dateEvidence: 'UNAVAILABLE', collectionVersion: '2', collectionDigest: genesis, listingSource: listingScan.source,
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true,
  }))
  const options = { client: {} as reader.CollectionPublicReadClient, deployment, viewerAddress: viewer, heldRightIds,
    discovery: { endpoint: 'https://graphql.example.com/graphql', pageSize: 50, maxPages, maxObjects: 1000, timeoutMs: 1000, fetch: fetcher } }
  return { fetcher, root, listing, right, snapshot, options, scan: createCollectionPortfolioDiscovery(options) }
}
afterEach(() => vi.restoreAllMocks())

it('finishes one bounded raw-verified Listing scan before Collection pages and exposes both checkpoints', async () => {
  const f = setup([{ ids: [20], more: true }, { ids: [21], more: false }, { ids: [1], more: true, checkpoint: 105 }, { ids: [2], more: false, checkpoint: 105 }])
  expect(await f.scan.next()).toMatchObject({ phase: 'LISTINGS', listingStatus: 'PARTIAL', candidateStatus: 'PARTIAL', collections: [] })
  expect(f.root).not.toHaveBeenCalled()
  expect(await f.scan.next()).toMatchObject({ phase: 'LISTINGS', listingStatus: 'COMPLETE', candidateStatus: 'PARTIAL', verifiedListingCandidates: 2 })
  expect(await f.scan.next()).toMatchObject({ phase: 'COLLECTIONS', candidateStatus: 'PARTIAL', verifiedCollectionCandidates: 1 })
  const last = await f.scan.next()
  expect(last.collections.map(c => c.collectionId)).toEqual([id(1), id(2)])
  expect(last).toMatchObject({ candidateStatus: 'COMPLETE', listingSource: { checkpoint: 100 }, collectionSource: { checkpoint: 105 },
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  expect(f.listing).toHaveBeenCalledTimes(2)
  expect(f.snapshot.mock.calls.every(([p]) => p.listingScan.observations.length === 2 && p.listingScan.status === 'COMPLETE')).toBe(true)
  const requests = f.fetcher.mock.calls.map(([, args]) => JSON.parse(args!.body as string).variables)
  expect(requests.map(v => v.filter.type)).toEqual([`${id(90)}::market::CollectionListing`, `${id(90)}::market::CollectionListing`,
    `${id(90)}::collection::SoulCollection`, `${id(90)}::collection::SoulCollection`])
  expect(requests[2]).toMatchObject({ checkpoint: null, after: null })
  expect(requests[3]).toMatchObject({ checkpoint: 105, after: 'opaque:2' })
  await expect(f.scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('includes created-held, created-sold and acquired roots but excludes unrelated roots', async () => {
  const f = setup([{ ids: [], more: false }, { ids: [1, 2, 3, 4], more: false }]), original = f.root.getMockImplementation()!
  f.root.mockImplementation(async args => { const result = await original(args)
    if (args.collectionId === id(2)) result.collection.current_holder = id(92)
    if (args.collectionId === id(3)) result.collection.creator = id(92)
    if (args.collectionId === id(4)) { result.collection.creator = id(92); result.collection.current_holder = id(93) }
    return result
  })
  await f.scan.next(); expect((await f.scan.next()).collections.map(c => c.collectionId)).toEqual([id(1), id(2), id(3)])
  expect(f.snapshot).toHaveBeenCalledTimes(3)
})
it('does not truncate the Collection portfolio to latest twelve or invent timestamps', async () => {
  const f = setup([{ ids: [], more: false }, { ids: Array.from({ length: 15 }, (_, i) => i + 1), more: false }])
  await f.scan.next(); const result = await f.scan.next()
  expect(result.collections).toHaveLength(15)
  expect(result.collections.every(c => c.createdAtMs === null)).toBe(true)
  expect(Object.isFrozen(result.collections[0].market)).toBe(true)
})
it('retains a failed terminal Listing page, including deleted candidates, without repeating GraphQL', async () => {
  const f = setup([{ ids: [20, 21], more: false }, { ids: [], more: false }]), original = f.listing.getMockImplementation()!
  let failing = true
  f.listing.mockImplementation(async args => { if (args.listingId === id(20)) return null; if (failing) throw new Error('raw down'); return original(args) })
  await expect(f.scan.next()).rejects.toThrow('raw down')
  expect(f.root).not.toHaveBeenCalled(); failing = false
  expect(await f.scan.next()).toMatchObject({ verifiedListingCandidates: 2, listingStatus: 'COMPLETE', candidateStatus: 'PARTIAL' })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
  expect(await f.scan.next()).toMatchObject({ candidateStatus: 'COMPLETE', collections: [] })
})
it('retains failed terminal Collection raw pages and commits no partially verified result', async () => {
  const f = setup([{ ids: [], more: false }, { ids: [1], more: true }, { ids: [2, 3], more: false }]), original = f.snapshot.getMockImplementation()!
  await f.scan.next(); const first = await f.scan.next(); let failing = true
  f.snapshot.mockImplementation(async args => { if (failing && args.collectionId === id(3)) throw new Error('right invalid'); return original(args) })
  await expect(f.scan.next()).rejects.toThrow('right invalid')
  expect(first.collections.map(c => c.collectionId)).toEqual([id(1)]); failing = false
  const last = await f.scan.next()
  expect(last.collections.map(c => c.collectionId)).toEqual([id(1), id(2), id(3)])
  expect(last.verifiedCollectionCandidates).toBe(3); expect(f.fetcher).toHaveBeenCalledTimes(3)
})
it('Collection root filter failure is not silently skipped', async () => {
  const f = setup([{ ids: [], more: false }, { ids: [1], more: false }])
  await f.scan.next(); f.root.mockRejectedValueOnce(new Error('wrong BCS'))
  await expect(f.scan.next()).rejects.toThrow('wrong BCS')
  expect((await f.scan.next()).collections).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('includes independently discovered held Right candidates, deduplicates Collection IDs and still proves custody', async () => {
  const f = setup([{ ids: [], more: false }, { ids: [1, 6], more: false }], 20, [id(60), id(61)])
  await f.scan.next(); const result = await f.scan.next()
  expect(result.collections.map(c => c.collectionId)).toEqual([id(1), id(6)])
  expect(f.right).toHaveBeenCalledTimes(2); expect(f.root).toHaveBeenCalledTimes(2); expect(f.snapshot).toHaveBeenCalledTimes(2)
})
it('retries failed held seeds on the same root page rather than discarding them', async () => {
  const f = setup([{ ids: [], more: false }, { ids: [], more: false }], 20, [id(60)])
  await f.scan.next(); f.right.mockRejectedValueOnce(new Error('missing Right'))
  await expect(f.scan.next()).rejects.toThrow('missing Right')
  expect((await f.scan.next()).collections.map(c => c.collectionId)).toEqual([id(6)])
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('Listing limit stops with explicit incomplete coverage and does not claim empty portfolio complete', async () => {
  const f = setup([{ ids: [20], more: true }], 1)
  expect(await f.scan.next()).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'LIMIT_REACHED', collections: [] })
  expect(f.root).not.toHaveBeenCalled(); await expect(f.scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('Collection limit preserves verified assets and remains incomplete', async () => {
  const f = setup([{ ids: [], more: false }, { ids: [1], more: true }], 1)
  await f.scan.next(); const result = await f.scan.next()
  expect(result).toMatchObject({ candidateStatus: 'LIMIT_REACHED', verifiedCollectionCandidates: 1 })
  expect(result.collections).toHaveLength(1); await expect(f.scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('freezes release/viewer/seed input at construction and rejects concurrent next calls', async () => {
  const f = setup([{ ids: [20], more: false }]), original = f.listing.getMockImplementation()!
  let release!: () => void
  f.listing.mockImplementation(async args => { await new Promise<void>(resolve => { release = resolve }); return original(args) })
  f.options.deployment.originalPackageId = id(101); f.options.viewerAddress = id(102); f.options.heldRightIds.push(id(103))
  const next = f.scan.next(); await vi.waitFor(() => expect(f.listing).toHaveBeenCalledTimes(1))
  await expect(f.scan.next()).rejects.toThrow('BUSY'); release(); await next
  expect(f.listing.mock.calls[0][0].deployment.originalPackageId).toBe(id(90))
})
it('abort rejects without committing a page and a retry retains the accepted candidate page', async () => {
  const f = setup([{ ids: [20], more: false }]), controller = new AbortController(), original = f.listing.getMockImplementation()!
  f.listing.mockImplementationOnce(async args => { controller.abort(new Error('cancelled')); return original(args) })
  await expect(f.scan.next({ signal: controller.signal })).rejects.toThrow('cancelled')
  expect(await f.scan.next()).toMatchObject({ verifiedListingCandidates: 1, listingStatus: 'COMPLETE' })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('rejects invalid viewer and duplicated/unbounded held seed input before discovery', () => {
  const f = setup([])
  expect(() => createCollectionPortfolioDiscovery({ ...f.options, viewerAddress: id(0) })).toThrow('INPUT_INVALID')
  expect(() => createCollectionPortfolioDiscovery({ ...f.options, heldRightIds: [id(1), id(1)] })).toThrow('INPUT_INVALID')
})
it('wrong discovery chain is an error, not empty success', async () => {
  const f = setup([])
  f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: { chainIdentifier: toBase58(new Uint8Array(32).fill(2)), checkpoint: {} } })))
  await expect(f.scan.next()).rejects.toThrow('network'); expect(f.listing).not.toHaveBeenCalled()
})
