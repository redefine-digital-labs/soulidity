import { beforeAll, expect, it } from 'vitest'
import { selectCollectionMarket, selectSoulMarket, type MarketCreatorIdentity, type SoulsListParams } from '../../web/lib/soulidity/public-market-model'
import { publicMarketFixture, id } from './fixtures/public-market'
let f: Awaited<ReturnType<typeof publicMarketFixture>>
beforeAll(async () => { f = await publicMarketFixture() })
const MAX = '18446744073709551615'
function input(count = 25) { return { ...f.scope, coverage: 'COMPLETE' as const, souls: Array.from({ length: count }, (_, i) => f.soul(i + 300)) } }
function identity(address: string, patch: Partial<MarketCreatorIdentity> = {}): MarketCreatorIdentity {
  return { address, status: 'VERIFIED', profileId: id(100), displayName: 'Alice Creator', handle: 'alice_works', error: null, ...patch }
}
it('filters and sorts the complete cumulative set before slicing, not the first twelve candidates', () => {
  const data = input(); data.souls[24].name = 'Only later match'
  expect(selectSoulMarket(data, { q: 'later' })).toMatchObject({ total: 1, complete: true, items: [{ name: 'Only later match' }] })
  const first = selectSoulMarket(data), second = selectSoulMarket(data, { page: 2 }), third = selectSoulMarket(data, { page: 3 })
  expect(first.total).toBe(25); expect(first.totalPages).toBe(3); expect(first.items).toHaveLength(12); expect(second.items).toHaveLength(12); expect(third.items).toHaveLength(1)
  expect(new Set([...first.items, ...second.items, ...third.items].map(row => row.onChainId)).size).toBe(25)
})
it('preserves name/description substring OR complete tag and combines independent filters with AND', () => {
  const data = input(3)
  data.souls[0] = f.soul(300, { name: 'Alpha soul', tags: ['Finance', 'Agent'], personaKind: 'agents' })
  data.souls[1] = f.soul(301, { description: 'ALPHA story', tags: ['Art'], personaKind: 'characters' })
  data.souls[2] = f.soul(302, { tags: ['ALPHA'], personaKind: 'agents' })
  expect(selectSoulMarket(data, { q: ' ALPHA ' }).total).toBe(3)
  expect(selectSoulMarket(data, { q: 'alph' }).total).toBe(2)
  expect(selectSoulMarket(data, { q: 'alpha', tag: 'FINANCE', persona: 'agents' }).items.map(r => r.onChainId)).toEqual([id(300)])
  expect(selectSoulMarket(data, { q: 'alpha', tag: 'finance', persona: 'characters' }).total).toBe(0)
})
it('keeps exact u64 prices/dates and deterministic ID tie-breakers at page boundaries', () => {
  const data = input(3)
  data.souls = [f.soul(302, { listedPriceAtomic: MAX, createdAtMs: MAX }),
    f.soul(301, { listedPriceAtomic: '9007199254740993', createdAtMs: MAX }),
    f.soul(300, { listedPriceAtomic: '9007199254740992', createdAtMs: MAX })]
  expect(selectSoulMarket(data, { sort: 'price_asc' }).items.map(r => r.onChainId)).toEqual([id(300), id(301), id(302)])
  expect(selectSoulMarket(data, { sort: 'price_desc', maxPrice: '9007199254740993', minPrice: '9007199254740993' }).items.map(r => r.onChainId)).toEqual([id(301)])
  expect(selectSoulMarket(data).items.map(r => r.onChainId)).toEqual([id(300), id(301), id(302)])
})
it('popular counts current effective grants, not occupied slots or private bookmark counts', () => {
  const data = input(2), grant = data.souls[0].activeGrants[0]
  data.souls[0].activeGrantCount = MAX; data.souls[0].activeGrants = [{ ...grant, status: 'expired' }]
  expect(selectSoulMarket(data, { sort: 'popular' }).items.map(r => [r.onChainId, r.effectiveGrantCount])).toEqual([[id(301), '1'], [id(300), '0']])
})
it('tags aggregate all app-visible listings before filters/page and normalize counts with deterministic ties', () => {
  const data = input(3)
  data.souls[0].tags = ['a', 'A', 'z']; data.souls[1].tags = ['Z', 'b']; data.souls[2].tags = ['invisible']; data.souls[2].listingStatus = 'floor-violation'
  expect(selectSoulMarket(data, { q: 'Soul 300', pageSize: 1 }).tags).toEqual([{ tag: 'z', count: 2 }, { tag: 'a', count: 1 }, { tag: 'b', count: 1 }])
})
it.each(['UNSCANNED', 'PARTIAL', 'LIMIT_REACHED'] as const)('%s never means a complete zero Market', coverage => {
  expect(selectSoulMarket({ ...input(0), coverage })).toMatchObject({ total: 0, complete: false, coverage })
})
it('complete empty is distinct from partial and no mutable returned data leaks into the source', () => {
  expect(selectSoulMarket(input(0))).toMatchObject({ total: 0, complete: true, totalPages: 1 })
  const data = input(1), view = selectSoulMarket(data); expect(Object.isFrozen(view.items[0].activeGrants)).toBe(true)
  data.souls[0].name = 'later mutation'; expect(view.items[0].name).not.toBe('later mutation')
})
it.each(['alice', 'WORKS', 'creator'])('creator search preserves public display name and handle substring %s', creator => {
  const data = input(2), address = data.souls[1].creatorAddress
  const view = selectSoulMarket({ ...data, identities: { [address]: identity(address), [data.souls[0].creatorAddress]: identity(data.souls[0].creatorAddress, { status: 'ABSENT', profileId: null, displayName: null, handle: null }) } }, { creator })
  expect(view.items.map(r => r.onChainId)).toEqual([id(301)]); expect(view.complete).toBe(true)
})
it('unknown or failed identity cannot manufacture a complete no-match, while address matches remain visible', () => {
  const data = input(2), address = data.souls[0].creatorAddress
  const failed = identity(address, { status: 'UNAVAILABLE', error: 'Walrus unavailable', displayName: null, handle: null })
  expect(selectSoulMarket({ ...data, identities: { [address]: failed } }, { creator: 'Alice' })).toMatchObject({ total: 0, complete: false, identityIncomplete: true })
  expect(selectSoulMarket({ ...data, identities: { [address]: failed } }, { creator: address })).toMatchObject({ total: 1, identityIncomplete: true })
  expect(selectSoulMarket({ ...input(1), identities: { [address]: failed } }, { creator: address })).toMatchObject({ total: 1, complete: true })
})
it('only missing identities relevant to the other filters make creator matching incomplete', () => {
  const data = input(2), address = data.souls[0].creatorAddress
  expect(selectSoulMarket({ ...data, identities: { [address]: identity(address) } }, { q: 'Soul 300', creator: 'alice' })).toMatchObject({ total: 1, complete: true })
})
it.each([{ minPrice: '-1' }, { maxPrice: '1.1' }, { minPrice: '01' }, { maxPrice: '18446744073709551616' },
  { minPrice: '3', maxPrice: '2' }, { sort: 'unknown' }, { persona: 'people' }, { page: 0 }, { pageSize: 51 }])('rejects invalid filters instead of ignoring them: %j', params => {
  expect(() => selectSoulMarket(input(), params as SoulsListParams)).toThrow('PUBLIC_MARKET_')
})
it('does not allow a different wallet, package, duplicate row or grant-Soul relation into a projection', () => {
  for (const mutate of [(d: ReturnType<typeof input>) => { d.souls[0].viewerAddress = id(99) },
    (d: ReturnType<typeof input>) => { d.souls[0].originalPackageId = id(99) },
    (d: ReturnType<typeof input>) => { d.souls.push(d.souls[0]) },
    (d: ReturnType<typeof input>) => { d.souls[0].activeGrants[0].soulOnChainId = id(99) }]) {
    const data = input(); mutate(data); expect(() => selectSoulMarket(data)).toThrow('PUBLIC_MARKET_')
  }
})
it('Collection all includes unrelated, held and non-tradeable roots; for-sale selects before paging', () => {
  const rows = Array.from({ length: 25 }, (_, i) => f.collection(i + 500, { rightTradeable: i !== 0 }))
  rows[24] = f.collection(524, { status: 'LISTED', listingId: id(2000), priceAtomic: MAX, currentSupply: MAX })
  const data = { ...f.scope, collections: rows, coverage: 'COMPLETE' as const }
  expect(selectCollectionMarket(data).total).toBe(25)
  const sale = selectCollectionMarket(data, { listed: true }); expect(sale).toMatchObject({ total: 1, complete: true, items: [{ collectionId: id(524), currentSupply: MAX }] })
  expect(sale.items[0].createdAtMs).toBeNull()
  expect(selectCollectionMarket(data, { listed: false, page: 3 }).items).toHaveLength(1)
})
it('Collection state unavailable is visible in all, never guessed held or a complete for-sale no-match', () => {
  const data = { ...f.scope, collections: [f.collection(500, { status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED' })], coverage: 'COMPLETE' as const }
  expect(selectCollectionMarket(data)).toMatchObject({ total: 1, complete: true, unavailableCount: 1 })
  expect(selectCollectionMarket(data, { listed: true })).toMatchObject({ total: 0, complete: false, unavailableCount: 1 })
  expect(selectCollectionMarket(data, { listed: true, q: 'does not match' })).toMatchObject({ total: 0, complete: true })
})
it('Collection name and description search remains case-insensitive before pagination', () => {
  const data = { ...f.scope, collections: [f.collection(500, { description: 'Story about ALPHA' }), f.collection(501)], coverage: 'COMPLETE' as const }
  expect(selectCollectionMarket(data, { q: ' ALPHA ' })).toMatchObject({ total: 1, items: [{ collectionId: id(500) }] })
})
