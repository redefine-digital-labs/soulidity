import { beforeAll, expect, it } from 'vitest'
import { projectCollectionDetail } from '../../web/lib/collections/collection-detail-model'
import { publicMarketFixture, id } from './fixtures/public-market'
let f: Awaited<ReturnType<typeof publicMarketFixture>>
beforeAll(async () => { f = await publicMarketFixture() })
function input() {
  const snapshot = f.collection(500, { currentSupply: '2' })
  return { ...f.scope, snapshot, coverage: 'COMPLETE' as const,
    souls: [f.soul(300, { collectionOnChainId: snapshot.collectionId }), f.soul(301, { collectionOnChainId: snapshot.collectionId })] }
}
it('preserves anonymous detail, exact chain supply, member holders and unknown historical dates/volume', () => {
  const i = input(), result = projectCollectionDetail(i)
  expect(result).toMatchObject({ onChainId: i.snapshot.collectionId, currentSoulSupply: '2', isCreator: false, isHolder: false,
    createdAt: null, memberCount: 2, membersComplete: true, stats: { soulHolders: 1, soulVolume: null } })
  expect(Object.isFrozen(result.souls[0])).toBe(true)
  i.snapshot.name = 'mutated'; i.souls[0].name = 'mutated'; expect(result.name).not.toBe('mutated')
  expect(result.souls.some(s => s.name === 'mutated')).toBe(false)
})
it('does not substitute Right holder for the member holder count or floor policy for minimum price', () => {
  const i = input(); i.souls[0].currentOwnerAddress = id(999)
  i.snapshot.floorPriceAtomic = null
  i.souls[0].listedPriceAtomic = '9007199254740993'; i.souls[1].listedPriceAtomic = '9007199254740992'
  const result = projectCollectionDetail(i)
  expect(result.stats.soulHolders).toBe(2); expect(result.floorPriceAtomic).toBeNull()
  expect(result.stats.soulFloorAtomic).toBe('9007199254740992')
})
it('marks partial, limited and supply-drift member scans incomplete without false zero aggregates', () => {
  for (const coverage of ['UNSCANNED', 'PARTIAL', 'LIMIT_REACHED', 'COMPLETE'] as const) {
    const result = projectCollectionDetail({ ...input(), souls: [], coverage })
    expect(result.membersComplete).toBe(false); expect(result.stats.soulHolders).toBeNull()
    expect(result.memberSupplyMismatch).toBe(coverage === 'COMPLETE')
  }
  expect(projectCollectionDetail({ ...input(), snapshot: f.collection(500, { currentSupply: '0' }), souls: [] }).membersComplete).toBe(true)
})
it('exact u64 supply/cap and intrinsic u64 capacity never pass through Number', () => {
  for (const maxSupply of [null, '18446744073709551615']) {
    const result = projectCollectionDetail({ ...input(), snapshot: f.collection(500, { currentSupply: '18446744073709551615', maxSupply }) })
    expect(result.atCapacity).toBe(true); expect(result.currentSoulSupply).toBe('18446744073709551615')
  }
  expect(projectCollectionDetail({ ...input(), snapshot: f.collection(500, { currentSupply: '9007199254740992', maxSupply: '9007199254740993' }) }).atCapacity).toBe(false)
})
it('paginates the complete verified member set with exact newest ordering and stable tie IDs', () => {
  const i = input(); i.snapshot.currentSupply = '25'
  i.souls = Array.from({ length: 25 }, (_, n) => f.soul(300 + n, { collectionOnChainId: i.snapshot.collectionId, createdAtMs: String(9007199254740992n + BigInt(n)) }))
  const result = projectCollectionDetail({ ...i, page: 2 })
  expect(result.souls).toHaveLength(12); expect(result.souls[0].onChainId).toBe(id(312))
  expect(result).toMatchObject({ memberCount: 25, page: 2, pages: 3 })
  expect(projectCollectionDetail({ ...i, page: 99 }).souls[0].onChainId).toBe(id(300))
})
it('creator sold and acquired holder identities remain distinct, including creator buyback', () => {
  const i = input()
  for (const [viewerAddress, relationship, isCreator, isHolder] of [
    [i.snapshot.creatorAddress, 'CREATED_SOLD', true, false], [i.snapshot.currentHolderAddress, 'ACQUIRED', false, true],
  ] as const) {
    const snapshot = { ...i.snapshot, creatorAddress: id(1), currentHolderAddress: id(2) }
    const viewer = isCreator ? id(1) : id(2)
    const result = projectCollectionDetail({ ...i, viewerAddress: viewer, snapshot: { ...snapshot, relationship }, souls: i.souls.map(s => ({ ...s, viewerAddress: viewer })) })
    expect(result).toMatchObject({ isCreator, isHolder })
  }
})
it('a verified below-floor listing is visible as a member, but is not the eligible member minimum', () => {
  const i = input(); i.souls[0].listingStatus = 'floor-violation'; i.souls[0].listedPriceAtomic = '1'
  i.souls[1].listingStatus = 'unlisted'; i.souls[1].listedPriceAtomic = null
  const result = projectCollectionDetail(i); expect(result.souls).toHaveLength(2); expect(result.stats.soulFloorAtomic).toBeNull()
})
it.each(['collection', 'viewer', 'release', 'duplicate', 'capacity', 'quote', 'status'])('rejects mismatched %s evidence', kind => {
  const i = input()
  if (kind === 'collection') i.souls[0].collectionOnChainId = id(55)
  if (kind === 'viewer') i.souls[0].viewerAddress = id(55)
  if (kind === 'release') i.souls[0].originalPackageId = id(55)
  if (kind === 'duplicate') i.souls[1] = i.souls[0]
  if (kind === 'capacity') i.snapshot.maxSupply = '1'
  if (kind === 'quote') i.snapshot.quote = { model: 'BASE_PLUS_FEES', priceAtomic: '5', platformFeeAtomic: '1', totalPaymentAtomic: '5', available: true }
  if (kind === 'status') i.snapshot.status = 'WRONG' as any
  expect(() => projectCollectionDetail(i)).toThrow('OBSERVATION_MISMATCH')
})
