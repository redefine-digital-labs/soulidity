// Public Market projection/hook fixtures. The underlying readers have raw-BCS
// composition suites; generated multi-row variants here are not ledger evidence.
import type { CollectionMarketDiscoveryResult, CollectionPublicSnapshot } from '@soulidity/sdk'
import type { BrowserMarketSoulsPage } from '../../../web/lib/soulidity/browser-market-souls'
import type { ChainSoulDetail } from '../../../web/lib/soulidity/soul-detail-model'
import { createBrowserSoulDetailModel, detailId as id } from './browser-soul-detail-fixture'
import { mySoulsFixture } from './my-souls'
export { id, deferred } from './my-souls'

export async function publicMarketFixture(viewerAddress: string | null = null) {
  const model = await createBrowserSoulDetailModel(), base = model.compose(), old = mySoulsFixture(), config = old.config
  const source = (type: string) => ({ endpoint: config.discoveryEndpoint!, chainIdentifier: config.chainIdentifier,
    checkpoint: 100, scope: { packageId: config.native.soulidityOriginalPackageId, type: `${config.native.soulidityOriginalPackageId}::${type}`,
      owner: { kind: 'SHARED' as const } }, authority: 'CANDIDATE_IDS_ONLY' as const })
  const soul = (n = 300, patch: Partial<ChainSoulDetail> = {}): ChainSoulDetail => ({ ...structuredClone(base),
    onChainId: id(n), name: `Soul ${n}`, creatorAddress: id(n + 10000), viewerAddress, isOwner: viewerAddress === base.currentOwnerAddress,
    isCreator: viewerAddress === id(n + 10000), tags: ['Agent'], createdAtMs: String(n),
    activeGrants: base.activeGrants.map((g, i) => ({ ...g, id: id(n * 100 + i), onChainId: id(n * 100 + i), soulOnChainId: id(n) })), ...patch })
  const collection = (n = 500, patch: Partial<CollectionPublicSnapshot> = {}): CollectionPublicSnapshot => {
    const c = { ...old.collection(n), ...patch }, creator = c.creatorAddress === viewerAddress, holder = c.currentHolderAddress === viewerAddress
    return { ...c, relationship: creator ? holder ? 'CREATED_HELD' : 'CREATED_SOLD' : holder ? 'ACQUIRED' : 'UNRELATED',
      isViewerListing: holder && c.status === 'LISTED', personalKioskCapId: holder ? id(76) : null }
  }
  const souls = (rows: ChainSoulDetail[] = [soul()], candidateStatus: BrowserMarketSoulsPage['candidateStatus'] = 'COMPLETE'): BrowserMarketSoulsPage => ({
    souls: rows, candidateStatus, phase: 'SOULS', listingSource: source('market::SoulListing'), source: source('soul::SoulState'),
    verifiedListingCandidates: rows.length, verifiedSoulCandidates: rows.length, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notAuthorization: true })
  const collections = (rows: CollectionPublicSnapshot[] = [collection()], candidateStatus: CollectionMarketDiscoveryResult['candidateStatus'] = 'COMPLETE'): CollectionMarketDiscoveryResult => ({
    collections: rows, candidateStatus, phase: 'COLLECTIONS', listingStatus: 'COMPLETE', listingSource: source('market::CollectionListing'),
    collectionSource: source('collection::SoulCollection'), verifiedListingCandidates: rows.length, verifiedCollectionCandidates: rows.length,
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  return { config, viewerAddress, source, soul, collection, souls, collections,
    scope: { originalPackageId: config.native.soulidityOriginalPackageId, viewerAddress },
    profileConfig: { deployment: { originalPackageId: config.native.soulidityOriginalPackageId,
      callablePackageId: config.native.soulidityCallablePackageId, registryId: id(4000), chainIdentifier: config.chainIdentifier },
      storage: { blobType: `${id(4001)}::blob::Blob`, aggregatorUrl: 'https://aggregator.example.com/' }, writesEnabled: false } }
}
