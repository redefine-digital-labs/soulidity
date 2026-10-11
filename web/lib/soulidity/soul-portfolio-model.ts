import type { CollectionPortfolioDiscoveryResult, CollectionPublicSnapshot } from '@soulidity/sdk'
import type { BrowserOwnedSoulsPage } from './browser-owned-souls'
import type { BrowserSoulActivityPage } from './browser-soul-activity'
import type { ChainSoulDetail } from './soul-detail-model'
import { soulActivityEventType, type ChainSoulGrantActivity, type ChainSoulPurchaseActivity } from './soul-activity-model'

export interface PortfolioSoul extends ChainSoulDetail {
  /** Current effective grants, not the contract's occupied active-grant slots. */
  effectiveGrantCount: string
  activeGrantDetails: Array<{ granteeAddress: string; createdAtMs: string | null }>
}
export type MySoulsPortfolioCoverage = 'UNSCANNED' | 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'
export interface MySoulsPortfolio {
  readonly owner: string
  readonly originalPackageId: string
  readonly owned: readonly PortfolioSoul[]
  readonly collections: readonly CollectionPublicSnapshot[]
  readonly grants: readonly ChainSoulGrantActivity[]
  readonly purchases: readonly ChainSoulPurchaseActivity[]
  readonly coverage: Readonly<{ owned: MySoulsPortfolioCoverage; collections: MySoulsPortfolioCoverage; activity: MySoulsPortfolioCoverage }>
  readonly totals: Readonly<{
    /** Counts describe observed rows; completeness flags describe the scan. */
    listedCount: number; listedValueAtomic: string | null; listedComplete: boolean
    effectiveGrantCount: string; ownedComplete: boolean; belowFloorCount: number
  }>
}
export interface MySoulsPortfolioInput {
  owner: string; originalPackageId: string
  owned: BrowserOwnedSoulsPage | null
  collections: CollectionPortfolioDiscoveryResult | null
  activity: BrowserSoulActivityPage | null
}
const MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_PORTFOLIO_${code}`) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'ID_INVALID')
}
function uint(value: unknown): bigint {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= MAX_U64, 'INTEGER_INVALID')
  return BigInt(value)
}
function status(value: unknown): asserts value is Exclude<MySoulsPortfolioCoverage, 'UNSCANNED'> {
  check(['PARTIAL', 'COMPLETE', 'LIMIT_REACHED'].includes(value as string), 'COVERAGE_INVALID')
}
function unique<T>(rows: readonly T[], key: (row: T) => string) {
  check(Array.isArray(rows) && new Set(rows.map(key)).size === rows.length, 'DUPLICATE_ROW')
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Pure projection of cumulative, already-verified reader snapshots. Calling
 * this again replaces the projection; it never appends or caches old wallets.
 * Scope checks prevent accidental joins but are not new raw-ledger proofs.
 * COMPLETE retains each reader's bounded/non-atomic completeness meaning.
 */
export function composeMySoulsPortfolio(input: MySoulsPortfolioInput): MySoulsPortfolio {
  const { owner, originalPackageId: pkg, owned: inventory, collections: discovered, activity: page } = structuredClone(input)
  id(owner); id(pkg)
  let chain: string | null = null
  const source = (value: { chainIdentifier: string; scope: { packageId: string; type: string } }, expectedType: string) => {
    check(value && value.scope?.packageId === pkg && value.scope.type === expectedType
      && /^[0-9a-f]{8}$/.test(value.chainIdentifier), 'SOURCE_SCOPE_MISMATCH')
    check(chain === null || chain === value.chainIdentifier, 'CHAIN_MISMATCH'); chain = value.chainIdentifier
  }
  let ownedCoverage: MySoulsPortfolioCoverage = 'UNSCANNED'
  if (inventory) {
    status(inventory.status)
    check(inventory.owner === owner && inventory.inventory.owner === owner && inventory.status === inventory.inventory.status,
      'OWNED_SCOPE_MISMATCH')
    unique(inventory.souls, row => row.onChainId)
    ownedCoverage = inventory.status
  }
  let collectionCoverage: MySoulsPortfolioCoverage = 'UNSCANNED'
  if (discovered) {
    status(discovered.candidateStatus); status(discovered.listingStatus)
    check(['LISTINGS', 'COLLECTIONS'].includes(discovered.phase), 'COVERAGE_INVALID')
    source(discovered.listingSource, `${pkg}::market::CollectionListing`)
    if (discovered.collectionSource) source(discovered.collectionSource, `${pkg}::collection::SoulCollection`)
    check(discovered.phase !== 'COLLECTIONS' || discovered.collectionSource !== null, 'SOURCE_SCOPE_MISMATCH')
    unique(discovered.collections, row => row.collectionId)
    collectionCoverage = discovered.candidateStatus === 'LIMIT_REACHED' || discovered.listingStatus === 'LIMIT_REACHED'
      ? 'LIMIT_REACHED' : discovered.phase === 'COLLECTIONS' && discovered.candidateStatus === 'COMPLETE'
        && discovered.listingStatus === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL'
  }
  let activityCoverage: MySoulsPortfolioCoverage = 'UNSCANNED'
  const grants = page?.activity.grants ?? [], purchases = page?.activity.purchases ?? []
  if (page) {
    const activity = page.activity
    check(activity.viewerAddress === owner && activity.originalPackageId === pkg && activity.deployment.originalPackageId === pkg,
      'ACTIVITY_SCOPE_MISMATCH')
    status(activity.status)
    source(page.source, soulActivityEventType(pkg, page.currentFamily))
    check(activity.deployment.chainIdentifier === chain, 'CHAIN_MISMATCH')
    unique(grants, row => row.onChainId); unique(purchases, row => row.id)
    for (const grant of grants) {
      id(grant.onChainId); id(grant.soulOnChainId); id(grant.granteeAddress)
      check(grant.id === grant.onChainId && (grant.issuedByAddress === owner || grant.granteeAddress === owner), 'ACTIVITY_SCOPE_MISMATCH')
    }
    for (const purchase of purchases) check(purchase.buyerAddress === owner, 'ACTIVITY_SCOPE_MISMATCH')
    activityCoverage = page.limitReason !== null || activity.status === 'LIMIT_REACHED' ? 'LIMIT_REACHED' : activity.status
  }
  const history = new Map(grants.map(grant => [grant.onChainId, grant]))
  const owned: PortfolioSoul[] = (inventory?.souls ?? []).map(soul => {
    id(soul.onChainId)
    check(soul.originalPackageId === pkg && soul.viewerAddress === owner && soul.currentOwnerAddress === owner && soul.isOwner
      && soul.currentKioskId === inventory!.inventory.kioskId, 'OWNED_SCOPE_MISMATCH')
    check(['listed', 'floor-violation', 'unlisted'].includes(soul.listingStatus), 'LISTING_INVALID')
    unique(soul.activeGrants, grant => grant.onChainId)
    const active = soul.activeGrants.filter(grant => grant.status === 'active')
    const activeGrantDetails = active.map(grant => {
      check(grant.soulOnChainId === soul.onChainId, 'GRANT_SCOPE_MISMATCH')
      const issued = history.get(grant.onChainId)
      const matches = issued?.soulOnChainId === soul.onChainId && issued.granteeAddress === grant.granteeAddress
      if (matches) uint(issued.createdAtMs)
      return { granteeAddress: grant.granteeAddress, createdAtMs: matches ? issued.createdAtMs : null }
    })
    return { ...soul, effectiveGrantCount: String(active.length), activeGrantDetails }
  })
  const collections = [...(discovered?.collections ?? [])]
  for (const collection of collections) {
    id(collection.collectionId); id(collection.currentHolderAddress); id(collection.creatorAddress)
    source(collection.listingSource, `${pkg}::market::CollectionListing`)
    const created = collection.creatorAddress === owner, held = collection.currentHolderAddress === owner
    check((created || held) && collection.relationship === (created ? held ? 'CREATED_HELD' : 'CREATED_SOLD' : 'ACQUIRED'),
      'COLLECTION_SCOPE_MISMATCH')
    check(['HELD', 'LISTED', 'UNAVAILABLE'].includes(collection.status)
      && collection.isViewerListing === (held && collection.listingId !== null), 'COLLECTION_LISTING_MISMATCH')
  }
  const ownedComplete = ownedCoverage === 'COMPLETE'
  let listedComplete = ownedComplete && collectionCoverage === 'COMPLETE'
  let listedCount = 0, listedValue = 0n, effectiveGrantCount = 0n, belowFloorCount = 0
  const listing = (price: string | null) => {
    listedCount++
    if (price === null) listedComplete = false
    else listedValue += uint(price)
  }
  for (const soul of owned) {
    effectiveGrantCount += BigInt(soul.effectiveGrantCount)
    if (soul.listingStatus !== 'unlisted') listing(soul.listedPriceAtomic)
    if (soul.listingStatus === 'floor-violation') belowFloorCount++
  }
  for (const collection of collections) {
    if (collection.currentHolderAddress === owner && collection.status === 'UNAVAILABLE') listedComplete = false
    if (collection.isViewerListing) listing(collection.priceAtomic)
  }
  return freeze({ owner, originalPackageId: pkg, owned, collections, grants, purchases,
    coverage: { owned: ownedCoverage, collections: collectionCoverage, activity: activityCoverage },
    totals: { listedCount, listedValueAtomic: listedComplete ? String(listedValue) : null, listedComplete,
      effectiveGrantCount: String(effectiveGrantCount), ownedComplete, belowFloorCount } })
}
