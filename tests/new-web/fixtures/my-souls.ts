// Coordinator/hook transport fixtures, not new ledger or signing evidence.
import { vi } from 'vitest'
import type { CollectionPortfolioDiscoveryResult, CollectionPublicSnapshot } from '@soulidity/sdk'
import type { BrowserOwnedSoulsPage } from '../../../web/lib/soulidity/browser-owned-souls'
import type { BrowserSoulActivityPage } from '../../../web/lib/soulidity/browser-soul-activity'
import type { ChainSoulDetail } from '../../../web/lib/soulidity/soul-detail-model'
import { SOUL_ACTIVITY_FAMILIES, type SoulActivityCoverage } from '../../../web/lib/soulidity/soul-activity-model'
import { browserSoulDetailFixture, detailDigest, detailId as id } from './browser-soul-detail-fixture'

export { id }
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
export function mySoulsFixture(owner = id(5)) {
  const raw = browserSoulDetailFixture(false), config = raw.config, lifetime = new AbortController()
  const source = (type: string) => ({ endpoint: config.discoveryEndpoint!, chainIdentifier: config.chainIdentifier,
    checkpoint: 100, scope: { packageId: id(1), type: `${id(1)}::${type}`, owner: { kind: 'SHARED' as const } },
    authority: 'CANDIDATE_IDS_ONLY' as const })
  function owned(status: BrowserOwnedSoulsPage['status'] = 'COMPLETE', souls: ChainSoulDetail[] = []): BrowserOwnedSoulsPage {
    return { owner, souls, status, heldCollectionRightIds: [],
      inventory: { owner, kioskId: id(7), registeredCapId: id(76), items: [], status,
        expectedItemCount: souls.length, scannedFields: souls.length, pages: 1,
        consistency: 'STABLE_KIOSK_MEMBERSHIP_PER_PAGE', notAuthorization: true },
      consistency: 'NON_ATOMIC_CURRENT_READSETS', notAuthorization: true }
  }
  function collection(n = 500): CollectionPublicSnapshot {
    return { collectionId: id(n), rightId: id(n + 1000), creatorAddress: owner, currentHolderAddress: id(800),
      holderKioskId: id(801), name: `Sold Collection ${n}`, description: '', imageUrl: '', maxSupply: '9007199254740993', currentSupply: '1',
      extraRoyaltyBps: 0, rightTradeable: true, floorPriceAtomic: '1', relationship: 'CREATED_SOLD', status: 'HELD', unavailableReason: null,
      listingId: null, priceAtomic: null, isViewerListing: false, personalKioskCapId: null, market: { secondaryEnabled: true, platformFeeBps: 250 },
      quote: null, currency: { coinType: config.paymentCoinType, symbol: 'USDC', decimals: 6 }, createdAtMs: null, updatedAtMs: null,
      dateEvidence: 'UNAVAILABLE', collectionVersion: '1', collectionDigest: detailDigest,
      listingSource: source('market::CollectionListing'), readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true }
  }
  function collections(status: CollectionPortfolioDiscoveryResult['candidateStatus'] = 'COMPLETE', count = 1): CollectionPortfolioDiscoveryResult {
    return { collections: Array.from({ length: count }, (_, i) => collection(500 + i)), candidateStatus: status, phase: 'COLLECTIONS',
      listingStatus: 'COMPLETE', listingSource: source('market::CollectionListing'), collectionSource: source('collection::SoulCollection'),
      verifiedListingCandidates: 0, verifiedCollectionCandidates: count, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true }
  }
  function activity(status: BrowserSoulActivityPage['activity']['status'] = 'COMPLETE', count = 1): BrowserSoulActivityPage {
    return { activity: { viewerAddress: owner, originalPackageId: id(1), deployment: { originalPackageId: id(1),
      callablePackageId: id(84), callableDigest: detailDigest, chainIdentifier: config.chainIdentifier }, checkpoint: '100', observedAtMs: '1000',
      grants: Array.from({ length: count }, (_, i) => ({ id: id(900 + i), onChainId: id(900 + i), soulOnChainId: id(3), issuedByAddress: id(4),
        granteeAddress: owner, scopes: ['memory'], scopeMask: 2, ownershipEpochSnapshot: '2', status: null, statusEvidence: 'UNAVAILABLE',
        createdAtMs: '123', createdAt: '1970-01-01T00:00:00.123Z', expiresAtMs: null, expiresAt: null, endedAtMs: null, endedAt: null,
        replacedByGrantOnChainId: null, issuedTransactionDigest: detailDigest, issuedEventSequence: i,
        endedTransactionDigest: null, endedEventSequence: null, cleanupAtMs: null, destroyedAtMs: null,
        observedAtMs: '1000', observedCheckpoint: '100', notAuthorization: true })),
      purchases: Array.from({ length: count }, (_, i) => ({ id: `${detailDigest}:${i}`, txDigest: detailDigest, eventSequence: i,
        soulOnChainId: id(1000 + i), soulName: null, listingOnChainId: id(1100 + i), sellerAddress: id(4), buyerAddress: owner,
        model: 'BASE_PLUS_FEES', paidAtomic: '9007199254740993', totalAtomic: '9007199254740993', platformFeeAtomic: '0',
        creatorRoyaltyAtomic: '0', collectionRoyaltyAtomic: '0', makerSourceRoyaltyAtomic: null, sellerPayoutAtomic: null,
        makerSourceRecipient: null, provenanceId: null, checkpoint: '100', createdAtMs: '123', createdAt: '1970-01-01T00:00:00.123Z', notAuthorization: true })),
      coverage: Object.fromEntries(SOUL_ACTIVITY_FAMILIES.map(name => [name, status])) as unknown as SoulActivityCoverage,
      status, historyAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY', completenessAuthority: 'BOUNDED_INDEX_COVERAGE', notAuthorization: true },
      currentFamily: 'SoulGrantIssued', source: { ...source('grant::SoulGrantIssued'), authority: 'CANDIDATE_EVENTS_ONLY' },
      verifiedTransactions: 1, retainedEvidenceBytes: 100, verifiedCandidateEvents: count * 2, pages: 1, limitReason: null, notAuthorization: true }
  }
  const reads = { owned: vi.fn(async (_options?: { signal?: AbortSignal }) => owned()),
    collections: vi.fn(async (_options?: { signal?: AbortSignal }) => collections()),
    activity: vi.fn(async (_options?: { signal?: AbortSignal }) => activity()) }
  const factories = { owned: vi.fn((_params: unknown, _dependencies?: unknown) => ({ next: reads.owned })),
    collections: vi.fn((_params: unknown) => ({ next: reads.collections })),
    activity: vi.fn((_params: unknown, _dependencies?: unknown) => ({ next: reads.activity })) }
  return { raw, config, owner, lifetime, owned, collections, collection, activity, reads, factories,
    params: { owner, config, signal: lifetime.signal }, dependencies: { client: () => raw.client, ...factories } }
}
