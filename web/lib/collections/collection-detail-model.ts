import type { CollectionPublicSnapshot } from '@soulidity/sdk'
import type { ChainSoulDetail } from '../soulidity/soul-detail-model'
import type { PublicMarketCoverage } from '../soulidity/public-market-model'

/** Public current observations. No SQL identifiers, guessed dates or member
 * membership are substituted for the wallet or raw Collection/Soul relation. */
export interface ChainCollectionDetail {
  onChainId: string; name: string; description: string; imageUrl: string
  creatorAddress: string; currentHolderAddress: string; currentHolderKioskId: string
  currentSoulSupply: string; maxSoulSupply: string | null; floorPriceAtomic: string | null
  extraRoyaltyBps: number; tradeable: boolean; createdAt: null
  listedPriceAtomic: string | null; listingObjectOnChainId: string | null
  listingStatus: 'listed' | 'unlisted' | 'unavailable'; unavailableReason: string | null
  isCreator: boolean; isHolder: boolean; purchaseAvailable: boolean
  quote: null | { priceAtomic: string; platformFeeAtomic: string; totalAtomic: string }
  souls: readonly ChainSoulDetail[]; memberCount: number; membersComplete: boolean
  memberCoverage: PublicMarketCoverage; memberSupplyMismatch: boolean
  page: number; pageSize: number; pages: number; atCapacity: boolean
  stats: { soulFloorAtomic: string | null; soulHolders: number | null; soulVolume: null }
  snapshot: Readonly<CollectionPublicSnapshot>; notAuthorization: true
}
function check(value: unknown): asserts value { if (!value) throw new Error('COLLECTION_DETAIL_OBSERVATION_MISMATCH') }
const MAX = 18446744073709551615n
function integer(value: string) { check(/^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= MAX); return BigInt(value) }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }

export function projectCollectionDetail(input: {
  snapshot: Readonly<CollectionPublicSnapshot>; souls: readonly ChainSoulDetail[]
  viewerAddress: string | null; originalPackageId: string; coverage: PublicMarketCoverage
  page?: number; pageSize?: number
}): Readonly<ChainCollectionDetail> {
  const c = input.snapshot, supply = integer(c.currentSupply), cap = c.maxSupply === null ? null : integer(c.maxSupply)
  check(cap === null || cap > 0n && supply <= cap)
  const isCreator = input.viewerAddress === c.creatorAddress, isHolder = input.viewerAddress === c.currentHolderAddress
  check(c.relationship === (isCreator ? isHolder ? 'CREATED_HELD' : 'CREATED_SOLD' : isHolder ? 'ACQUIRED' : 'UNRELATED'))
  check(['HELD', 'LISTED', 'UNAVAILABLE'].includes(c.status))
  if (c.status === 'LISTED') check(c.listingId && c.priceAtomic && integer(c.priceAtomic) > 0n && c.quote)
  else check(c.listingId === null && c.priceAtomic === null && c.quote === null)
  if (c.quote) check(c.quote.model === 'BASE_PLUS_FEES' && c.quote.priceAtomic === c.priceAtomic
    && integer(c.quote.totalPaymentAtomic) === integer(c.quote.priceAtomic) + integer(c.quote.platformFeeAtomic))
  const ids = new Set<string>(), holders = new Set<string>()
  let floor: bigint | null = null
  for (const soul of input.souls) {
    check(soul.collectionOnChainId === c.collectionId && soul.originalPackageId === input.originalPackageId
      && soul.viewerAddress === input.viewerAddress && !ids.has(soul.onChainId))
    ids.add(soul.onChainId); holders.add(soul.currentOwnerAddress)
    if (soul.listingStatus === 'listed' && soul.listedPriceAtomic !== null) {
      const value = integer(soul.listedPriceAtomic); if (floor === null || value < floor) floor = value
    }
  }
  const mismatch = input.coverage === 'COMPLETE' && BigInt(ids.size) !== supply
  const complete = input.coverage === 'COMPLETE' && !mismatch
  const pageSize = input.pageSize ?? 12, requested = input.page ?? 1
  check(Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 50 && Number.isSafeInteger(requested) && requested > 0)
  const pages = Math.max(1, Math.ceil(ids.size / pageSize)), page = Math.min(requested, pages)
  const souls = [...input.souls].sort((a, b) => {
    const aa = integer(a.createdAtMs), bb = integer(b.createdAtMs)
    return aa > bb ? -1 : aa < bb ? 1 : a.onChainId.localeCompare(b.onChainId)
  }).slice((page - 1) * pageSize, page * pageSize)
  return freeze(structuredClone({ onChainId: c.collectionId, name: c.name, description: c.description, imageUrl: c.imageUrl,
    creatorAddress: c.creatorAddress, currentHolderAddress: c.currentHolderAddress, currentHolderKioskId: c.holderKioskId,
    currentSoulSupply: c.currentSupply, maxSoulSupply: c.maxSupply, floorPriceAtomic: c.floorPriceAtomic,
    extraRoyaltyBps: c.extraRoyaltyBps, tradeable: c.rightTradeable, createdAt: null,
    listedPriceAtomic: c.priceAtomic, listingObjectOnChainId: c.listingId,
    listingStatus: c.status === 'LISTED' ? 'listed' : c.status === 'HELD' ? 'unlisted' : 'unavailable', unavailableReason: c.unavailableReason,
    isCreator, isHolder, purchaseAvailable: c.status === 'LISTED' && c.quote?.available === true && !isHolder,
    quote: c.quote ? { priceAtomic: c.quote.priceAtomic, platformFeeAtomic: c.quote.platformFeeAtomic, totalAtomic: c.quote.totalPaymentAtomic } : null,
    souls, memberCount: ids.size, membersComplete: complete, memberCoverage: input.coverage, memberSupplyMismatch: mismatch,
    page, pageSize, pages, atCapacity: supply === MAX || cap !== null && supply >= cap,
    stats: { soulFloorAtomic: floor === null ? null : String(floor), soulHolders: complete ? holders.size : null, soulVolume: null },
    snapshot: c, notAuthorization: true,
  } as ChainCollectionDetail))
}
