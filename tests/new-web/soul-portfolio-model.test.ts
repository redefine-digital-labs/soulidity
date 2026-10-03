import { beforeAll, expect, it } from 'vitest'
import type { CollectionPortfolioDiscoveryResult, CollectionPublicSnapshot } from '@soulidity/sdk'
import { composeMySoulsPortfolio, type MySoulsPortfolioInput } from '../../web/lib/soulidity/soul-portfolio-model'
import type { ChainSoulDetail, ChainSoulGrant } from '../../web/lib/soulidity/soul-detail-model'
import { SOUL_ACTIVITY_FAMILIES, soulActivityGrantsCsv, type ChainSoulGrantActivity, type ChainSoulPurchaseActivity,
  type SoulActivityCoverage } from '../../web/lib/soulidity/soul-activity-model'
import type { BrowserSoulActivityPage } from '../../web/lib/soulidity/browser-soul-activity'
import { createBrowserSoulDetailModel, detailId as id, detailDigest } from './fixtures/browser-soul-detail-fixture'

let base: ChainSoulDetail
beforeAll(async () => { base = (await createBrowserSoulDetailModel()).compose() })
const MAX = '18446744073709551615'
const source = (pkg: string, type: string) => ({ endpoint: 'https://graphql.example.com/', chainIdentifier: '01010101', checkpoint: 100,
  scope: { packageId: pkg, type: `${pkg}::${type}`, owner: { kind: 'SHARED' as const } }, authority: 'CANDIDATE_IDS_ONLY' as const })
function soul(n = 3, overrides: Partial<ChainSoulDetail> = {}): ChainSoulDetail {
  const row = structuredClone(base)
  row.onChainId = id(n)
  row.activeGrants = row.activeGrants.map((grant, i) => ({ ...grant, id: id(n * 100 + i), onChainId: id(n * 100 + i), soulOnChainId: id(n) }))
  return { ...row, ...overrides }
}
function collection(n = 500, overrides: Partial<CollectionPublicSnapshot> = {}): CollectionPublicSnapshot {
  return { collectionId: id(n), rightId: id(n + 1000), creatorAddress: base.currentOwnerAddress, currentHolderAddress: base.currentOwnerAddress,
    holderKioskId: base.currentKioskId, name: 'Current raw Collection', description: '', imageUrl: '', maxSupply: MAX, currentSupply: '9007199254740993',
    extraRoyaltyBps: 9999, rightTradeable: true, floorPriceAtomic: MAX, relationship: 'CREATED_HELD', status: 'HELD', unavailableReason: null,
    listingId: null, priceAtomic: null, isViewerListing: false, personalKioskCapId: id(76), market: { secondaryEnabled: true, platformFeeBps: 250 },
    quote: null, currency: { coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', symbol: 'USDC', decimals: 6 },
    createdAtMs: null, updatedAtMs: null, dateEvidence: 'UNAVAILABLE', collectionVersion: MAX, collectionDigest: detailDigest,
    listingSource: source(base.originalPackageId, 'market::CollectionListing'), readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true,
    ...overrides }
}
function collections(rows: CollectionPublicSnapshot[] = []): CollectionPortfolioDiscoveryResult {
  return { collections: rows, candidateStatus: 'COMPLETE', phase: 'COLLECTIONS', listingStatus: 'COMPLETE',
    listingSource: source(base.originalPackageId, 'market::CollectionListing'), collectionSource: source(base.originalPackageId, 'collection::SoulCollection'),
    verifiedListingCandidates: rows.length, verifiedCollectionCandidates: rows.length, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true }
}
function grantHistory(grant: ChainSoulGrant, overrides: Partial<ChainSoulGrantActivity> = {}): ChainSoulGrantActivity {
  return { id: grant.onChainId, onChainId: grant.onChainId, soulOnChainId: grant.soulOnChainId, issuedByAddress: base.currentOwnerAddress,
    granteeAddress: grant.granteeAddress, scopes: [...grant.scopes], scopeMask: grant.scopeMask, ownershipEpochSnapshot: grant.ownershipEpochSnapshot,
    status: null, statusEvidence: 'UNAVAILABLE', createdAtMs: '123', createdAt: '1970-01-01T00:00:00.123Z',
    expiresAtMs: grant.expiresAtMs, expiresAt: grant.expiresAt, endedAtMs: null, endedAt: null, replacedByGrantOnChainId: null,
    issuedTransactionDigest: detailDigest, issuedEventSequence: 1, endedTransactionDigest: null, endedEventSequence: null,
    cleanupAtMs: null, destroyedAtMs: null, observedAtMs: '9007199254740993', observedCheckpoint: '100', notAuthorization: true, ...overrides }
}
function purchase(overrides: Partial<ChainSoulPurchaseActivity> = {}): ChainSoulPurchaseActivity {
  return { id: `${detailDigest}:2`, txDigest: detailDigest, eventSequence: 2, soulOnChainId: id(900), soulName: null,
    listingOnChainId: id(901), sellerAddress: id(902), buyerAddress: base.currentOwnerAddress, model: 'BASE_PLUS_FEES',
    paidAtomic: '9007199254740993', totalAtomic: '9007199254740996', platformFeeAtomic: '1', creatorRoyaltyAtomic: '1',
    collectionRoyaltyAtomic: '1', makerSourceRoyaltyAtomic: null, sellerPayoutAtomic: null, makerSourceRecipient: null, provenanceId: null,
    checkpoint: '100', createdAtMs: MAX, createdAt: null, notAuthorization: true, ...overrides }
}
function activity(grants: ChainSoulGrantActivity[] = [], purchases: ChainSoulPurchaseActivity[] = []): BrowserSoulActivityPage {
  return { activity: { viewerAddress: base.currentOwnerAddress, originalPackageId: base.originalPackageId,
    deployment: { originalPackageId: base.originalPackageId, callablePackageId: id(84), callableDigest: detailDigest, chainIdentifier: '01010101' },
    checkpoint: '100', observedAtMs: MAX, grants, purchases,
    coverage: Object.fromEntries(SOUL_ACTIVITY_FAMILIES.map(name => [name, 'COMPLETE'])) as unknown as SoulActivityCoverage,
    status: 'COMPLETE', historyAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY', completenessAuthority: 'BOUNDED_INDEX_COVERAGE', notAuthorization: true },
    currentFamily: 'SoulGrantIssued', source: { endpoint: 'https://graphql.example.com/', chainIdentifier: '01010101', checkpoint: 100,
      scope: { packageId: base.originalPackageId, type: `${base.originalPackageId}::grant::SoulGrantIssued` }, authority: 'CANDIDATE_EVENTS_ONLY' },
    verifiedTransactions: 1, retainedEvidenceBytes: 100, verifiedCandidateEvents: grants.length + purchases.length,
    pages: 1, limitReason: null, notAuthorization: true }
}
function input(rows: ChainSoulDetail[] = [soul()]): MySoulsPortfolioInput {
  return { owner: base.currentOwnerAddress, originalPackageId: base.originalPackageId,
    owned: { owner: base.currentOwnerAddress, souls: rows, heldCollectionRightIds: [], status: 'COMPLETE',
      inventory: { owner: base.currentOwnerAddress, kioskId: base.currentKioskId, registeredCapId: base.currentKioskCapOnChainId,
        items: [], status: 'COMPLETE', expectedItemCount: rows.length, scannedFields: rows.length, pages: 1,
        consistency: 'STABLE_KIOSK_MEMBERSHIP_PER_PAGE', notAuthorization: true }, consistency: 'NON_ATOMIC_CURRENT_READSETS', notAuthorization: true },
    collections: collections(), activity: null }
}

it('preserves the actual chain detail projection and adds only explicit portfolio fields', () => {
  const row = soul(), result = composeMySoulsPortfolio(input([row]))
  const { effectiveGrantCount, activeGrantDetails, ...original } = result.owned[0]
  expect(original).toEqual(row); expect(effectiveGrantCount).toBe('1')
  expect(activeGrantDetails).toEqual([{ granteeAddress: row.activeGrants[0].granteeAddress, createdAtMs: null }])
  expect(result.totals).toEqual({ listedCount: 1, listedValueAtomic: '1000000', listedComplete: true,
    effectiveGrantCount: '1', ownedComplete: true, belowFloorCount: 0 })
})
it('uses BigInt for each atomic price and allows an aggregate above u64 without Number rounding', () => {
  const data = input([soul(3, { listedPriceAtomic: MAX }), soul(4, { listedPriceAtomic: MAX })])
  data.collections = collections([collection(500, { status: 'LISTED', listingId: id(501), priceAtomic: '9007199254740993', isViewerListing: true })])
  expect(composeMySoulsPortfolio(data).totals).toMatchObject({ listedCount: 3, listedValueAtomic: '36902495346673844223', listedComplete: true })
})
it('counts zero-price observed listings and distinguishes complete zero from unscanned totals', () => {
  expect(composeMySoulsPortfolio(input([soul(3, { listedPriceAtomic: '0' })])).totals).toMatchObject({ listedCount: 1, listedValueAtomic: '0', listedComplete: true })
  expect(composeMySoulsPortfolio(input([])).totals).toMatchObject({ listedCount: 0, listedValueAtomic: '0', effectiveGrantCount: '0', ownedComplete: true })
  const data = input([]); data.owned = null; data.collections = null
  expect(composeMySoulsPortfolio(data)).toMatchObject({ coverage: { owned: 'UNSCANNED', collections: 'UNSCANNED', activity: 'UNSCANNED' },
    totals: { listedCount: 0, listedValueAtomic: null, listedComplete: false, ownedComplete: false } })
})
it('does not confuse expired or invalidated occupied slots with effective grants', () => {
  const row = soul(), active = row.activeGrants[0]
  row.activeGrantCount = '3'
  row.activeGrants = [active, { ...active, id: id(400), onChainId: id(400), status: 'expired' },
    { ...active, id: id(401), onChainId: id(401), status: 'invalidated' }]
  const result = composeMySoulsPortfolio(input([row]))
  expect(result.owned[0]).toMatchObject({ activeGrantCount: '3', effectiveGrantCount: '1' })
  expect(result.owned[0].activeGrantDetails).toHaveLength(1); expect(result.totals.effectiveGrantCount).toBe('1')
})
it.each(['0', MAX])('joins an exact issuance timestamp %s without changing unknown lifecycle status', createdAtMs => {
  const data = input(), grant = data.owned!.souls[0].activeGrants[0]
  const history = grantHistory(grant, { createdAtMs, createdAt: createdAtMs === MAX ? null : '1970-01-01T00:00:00.000Z' })
  data.activity = activity([history])
  const result = composeMySoulsPortfolio(data)
  expect(result.owned[0].activeGrantDetails[0].createdAtMs).toBe(createdAtMs)
  expect(result.grants[0]).toEqual(history); expect(result.grants[0].status).toBeNull()
  const csv = soulActivityGrantsCsv(result.grants)
  expect(csv).toContain('"unavailable"'); expect(csv).toContain(`"${createdAtMs}"`)
})
it.each(['grant', 'soul', 'grantee'] as const)('does not substitute observedAt or a history row with a different %s', mismatch => {
  const data = input(), grant = data.owned!.souls[0].activeGrants[0], history = grantHistory(grant)
  if (mismatch === 'grant') { history.id = id(700); history.onChainId = id(700) }
  if (mismatch === 'soul') history.soulOnChainId = id(700)
  if (mismatch === 'grantee') history.granteeAddress = id(700)
  data.activity = activity([history])
  expect(composeMySoulsPortfolio(data).owned[0].activeGrantDetails[0].createdAtMs).toBeNull()
})
it('keeps created-but-sold Collections and excludes their buyers listings from owner totals', () => {
  const sold = collection(500, { currentHolderAddress: id(600), relationship: 'CREATED_SOLD', status: 'LISTED',
    listingId: id(700), priceAtomic: MAX, isViewerListing: false, personalKioskCapId: null })
  const acquired = collection(501, { creatorAddress: id(601), relationship: 'ACQUIRED', status: 'LISTED', listingId: id(701), priceAtomic: '5', isViewerListing: true })
  const data = input([]); data.collections = collections([sold, acquired])
  const result = composeMySoulsPortfolio(data)
  expect(result.collections).toEqual([sold, acquired]); expect(result.totals).toMatchObject({ listedCount: 1, listedValueAtomic: '5', listedComplete: true })
  expect(result.collections[0]).toMatchObject({ maxSupply: MAX, currentSupply: '9007199254740993', collectionVersion: MAX,
    createdAtMs: null, updatedAtMs: null, dateEvidence: 'UNAVAILABLE' })
  expect(result.collections[0]).not.toHaveProperty('id'); expect(result.collections[0]).not.toHaveProperty('creatorMemberId')
})
it('counts floor-violating Soul listings without falsely treating their chain listing as removed', () => {
  const data = input([soul(3, { listingStatus: 'floor-violation', listedPriceAtomic: '2', purchaseAvailable: false }),
    soul(4, { listingStatus: 'unlisted', chainListingStatus: 'HELD', listedPriceAtomic: null })])
  expect(composeMySoulsPortfolio(data).totals).toMatchObject({ listedCount: 1, belowFloorCount: 1, listedValueAtomic: '2' })
})
it('keeps Collections, received grants and purchases even when Owned has not loaded', () => {
  const data = input(); data.owned = null; data.collections = collections([collection()])
  const grant = grantHistory(soul().activeGrants[0], { issuedByAddress: id(800), granteeAddress: data.owner })
  const bought = purchase(); data.activity = activity([grant], [bought])
  const result = composeMySoulsPortfolio(data)
  expect(result.owned).toEqual([]); expect(result.collections).toHaveLength(1); expect(result.grants).toEqual([grant]); expect(result.purchases).toEqual([bought])
  expect(result.totals).toMatchObject({ listedValueAtomic: null, ownedComplete: false, listedComplete: false, effectiveGrantCount: '0' })
})
it.each(['PARTIAL', 'LIMIT_REACHED'] as const)('reports %s Owned as observed lower-bound counts, never a complete value', coverage => {
  const data = input()
  data.owned = { ...data.owned!, status: coverage, inventory: { ...data.owned!.inventory, status: coverage } }
  const result = composeMySoulsPortfolio(data)
  expect(result.coverage.owned).toBe(coverage); expect(result.totals).toMatchObject({ listedCount: 1, listedValueAtomic: null, ownedComplete: false, listedComplete: false })
})
it.each(['listing-partial', 'listing-limit', 'collection-partial', 'collection-limit'])(
  'retains independent Collection scan coverage: %s', kind => {
    const data = input(), original = data.collections!
    data.collections = kind.startsWith('listing') ? { ...original, phase: 'LISTINGS', collectionSource: null,
      listingStatus: kind.endsWith('limit') ? 'LIMIT_REACHED' : 'PARTIAL', candidateStatus: kind.endsWith('limit') ? 'LIMIT_REACHED' : 'PARTIAL' }
      : { ...original, candidateStatus: kind.endsWith('limit') ? 'LIMIT_REACHED' : 'PARTIAL' }
    const result = composeMySoulsPortfolio(data)
    expect(result.coverage.collections).toBe(kind.endsWith('limit') ? 'LIMIT_REACHED' : 'PARTIAL')
    expect(result.totals.listedComplete).toBe(false); expect(result.totals.listedValueAtomic).toBeNull()
  })
it('an activity evidence budget limit remains LIMIT_REACHED without blocking complete listing totals', () => {
  const data = input(); data.activity = { ...activity(), activity: { ...activity().activity, status: 'PARTIAL' }, limitReason: 'EVIDENCE_BYTES_LIMIT' }
  const result = composeMySoulsPortfolio(data)
  expect(result.coverage.activity).toBe('LIMIT_REACHED'); expect(result.totals.listedComplete).toBe(true)
})
it.each(['soul-price', 'collection-price', 'owned-reservation'])(
  'keeps unknown listing information %s explicit, not a zero-priced estimate', kind => {
    const data = input(kind === 'soul-price' ? [soul(3, { listedPriceAtomic: null })] : [])
    if (kind !== 'soul-price') data.collections = collections([collection(500, kind === 'collection-price'
      ? { status: 'LISTED', listingId: id(700), isViewerListing: true, priceAtomic: null }
      : { status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED' })])
    const result = composeMySoulsPortfolio(data)
    expect(result.totals.listedComplete).toBe(false); expect(result.totals.listedValueAtomic).toBeNull()
  })
it('an unavailable sold Collection does not make the buyers reservation this wallets unknown listing', () => {
  const data = input([])
  data.collections = collections([collection(500, { currentHolderAddress: id(900), relationship: 'CREATED_SOLD',
    status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED', personalKioskCapId: null })])
  expect(composeMySoulsPortfolio(data).totals).toMatchObject({ listedCount: 0, listedValueAtomic: '0', listedComplete: true })
})
it('repeated cumulative snapshots replace the projection rather than appending duplicate rows', () => {
  const data = input([soul(3), soul(4)]); data.collections = collections([collection()]); data.activity = activity([], [purchase()])
  const first = composeMySoulsPortfolio(data), second = composeMySoulsPortfolio(data)
  expect(second).toEqual(first); expect(second.owned).toHaveLength(2); expect(second.purchases).toHaveLength(1)
})
it('deeply isolates and freezes rows, raw Collection data, history and derived details', () => {
  const data = input(); data.collections = collections([collection()]); data.activity = activity([grantHistory(data.owned!.souls[0].activeGrants[0])], [purchase()])
  const result = composeMySoulsPortfolio(data), oldName = result.owned[0].name
  data.owned!.souls[0].name = 'changed'; data.collections.collections[0].market.platformFeeBps = 1
  data.activity.activity.grants[0].scopes.push('memory')
  expect(result.owned[0].name).toBe(oldName); expect(result.collections[0].market.platformFeeBps).toBe(250)
  expect([result, result.owned, result.owned[0], result.owned[0].activeGrantDetails[0], result.collections[0].market,
    result.grants[0].scopes, result.purchases[0], result.coverage, result.totals].every(Object.isFrozen)).toBe(true)
})
it.each(['owner', 'package', 'owned-owner', 'inventory-owner', 'soul-owner', 'soul-viewer', 'soul-package', 'soul-kiosk',
  'collection-source', 'collection-relationship', 'buyer-listing', 'activity-owner', 'activity-package', 'activity-source', 'source-chain', 'purchase-buyer'])(
  'fails mixed wallet/release scope %s instead of blending plausible rows', kind => {
    const data = input(); data.collections = collections([collection()]); data.activity = activity([], [purchase()])
    if (kind === 'owner') data.owner = id(999)
    if (kind === 'package') data.originalPackageId = id(999)
    if (kind === 'owned-owner') data.owned = { ...data.owned!, owner: id(999) }
    if (kind === 'inventory-owner') data.owned = { ...data.owned!, inventory: { ...data.owned!.inventory, owner: id(999) } }
    if (kind === 'soul-owner') data.owned!.souls[0].currentOwnerAddress = id(999)
    if (kind === 'soul-viewer') data.owned!.souls[0].viewerAddress = id(999)
    if (kind === 'soul-package') data.owned!.souls[0].originalPackageId = id(999)
    if (kind === 'soul-kiosk') data.owned!.souls[0].currentKioskId = id(999)
    if (kind === 'collection-source') data.collections = { ...data.collections, listingSource: source(id(999), 'market::CollectionListing') }
    if (kind === 'collection-relationship') data.collections = collections([collection(500, { relationship: 'ACQUIRED' })])
    if (kind === 'buyer-listing') data.collections = collections([collection(500, { currentHolderAddress: id(999), relationship: 'CREATED_SOLD',
      status: 'LISTED', listingId: id(998), priceAtomic: '1', isViewerListing: true })])
    if (kind === 'activity-owner') data.activity = { ...data.activity, activity: { ...data.activity.activity, viewerAddress: id(999) } }
    if (kind === 'activity-package') data.activity = { ...data.activity, activity: { ...data.activity.activity,
      deployment: { ...data.activity.activity.deployment, originalPackageId: id(999) } } }
    if (kind === 'activity-source') data.activity = { ...data.activity, source: { ...data.activity.source, scope: { ...data.activity.source.scope, packageId: id(999) } } }
    if (kind === 'source-chain') data.activity = { ...data.activity, source: { ...data.activity.source, chainIdentifier: '02020202' } }
    if (kind === 'purchase-buyer') data.activity.activity.purchases[0].buyerAddress = id(999)
    expect(() => composeMySoulsPortfolio(data)).toThrow('SOUL_PORTFOLIO_')
  })
it.each(['owned', 'collections', 'grants', 'purchases'] as const)('rejects duplicate cumulative %s identities rather than double counting', kind => {
  const data = input()
  if (kind === 'owned') data.owned = { ...data.owned!, souls: [soul(), soul()] }
  if (kind === 'collections') data.collections = collections([collection(), collection()])
  if (kind === 'grants') { const grant = grantHistory(soul().activeGrants[0]); data.activity = activity([grant, grant]) }
  if (kind === 'purchases') data.activity = activity([], [purchase(), purchase()])
  expect(() => composeMySoulsPortfolio(data)).toThrow('DUPLICATE_ROW')
})
it.each(['01', '-1', '1.5', '1e6', '18446744073709551616', 9007199254740992])('rejects a rounded or noncanonical atomic input %s', amount => {
  const data = input([soul(3, { listedPriceAtomic: amount as string })])
  expect(() => composeMySoulsPortfolio(data)).toThrow('INTEGER_INVALID')
})
