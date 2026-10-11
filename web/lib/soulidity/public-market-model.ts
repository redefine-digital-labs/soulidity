import type { CollectionPublicSnapshot, PersonaFilter } from '@soulidity/sdk'
import type { ChainSoulDetail } from './soul-detail-model'

export type PublicMarketCoverage = 'UNSCANNED' | 'PARTIAL' | 'COMPLETE' | 'LIMIT_REACHED'
export type SoulsSortOption = 'newest' | 'price_asc' | 'price_desc' | 'popular'
export interface SoulsListParams {
  page?: number; pageSize?: number; tag?: string; q?: string; sort?: SoulsSortOption
  minPrice?: string; maxPrice?: string; creator?: string; persona?: PersonaFilter
}
export interface CollectionsListParams { page?: number; pageSize?: number; q?: string; listed?: boolean }
export type MarketCreatorIdentity = Readonly<{
  address: string; status: 'VERIFIED' | 'ABSENT' | 'UNAVAILABLE'
  profileId: string | null; displayName: string | null; handle: string | null; error: string | null
}>
export interface PublicMarketSoul extends ChainSoulDetail {
  effectiveGrantCount: string
  creatorIdentity: MarketCreatorIdentity | null
}
export interface PublicMarketPage<T> {
  readonly items: readonly T[]; readonly total: number; readonly totalPages: number; readonly page: number; readonly pageSize: number
  readonly complete: boolean; readonly coverage: PublicMarketCoverage; readonly identityIncomplete: boolean
  readonly unavailableCount: number; readonly notAuthorization: true
}
const MAX = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`PUBLIC_MARKET_${code}`) }
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > MAX) throw new Error('PUBLIC_MARKET_INTEGER_INVALID')
  return BigInt(value)
}
const text = (value: string | undefined) => (value ?? '').trim().toLowerCase()
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const numbers = (a: string, b: string) => integer(a) < integer(b) ? -1 : integer(a) > integer(b) ? 1 : 0
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
function scope(pkg: string, coverage: PublicMarketCoverage, viewer: string | null) {
  check(id(pkg) && (viewer === null || id(viewer)), 'SCOPE_INVALID')
  check(['UNSCANNED', 'PARTIAL', 'COMPLETE', 'LIMIT_REACHED'].includes(coverage), 'COVERAGE_INVALID')
}
function page<T>(items: T[], coverage: PublicMarketCoverage, params: { page?: number; pageSize?: number },
  incomplete: boolean, unavailableCount: number, identityIncomplete = false): PublicMarketPage<T> {
  const size = params.pageSize ?? 12, requested = params.page ?? 1
  check(Number.isSafeInteger(size) && size >= 1 && size <= 50 && Number.isSafeInteger(requested) && requested >= 1, 'PAGE_INVALID')
  const totalPages = Math.max(1, Math.ceil(items.length / size)), selected = Math.min(requested, totalPages)
  return freeze({ items: items.slice((selected - 1) * size, selected * size), total: items.length, totalPages, page: selected, pageSize: size,
    complete: coverage === 'COMPLETE' && !incomplete, coverage, identityIncomplete, unavailableCount, notAuthorization: true })
}

/** Select from the full cumulative verified read set, never the first API page.
 * Counts/rank remain provisional until its bounded scan and required identity
 * facts are complete. This projection cannot authorize a transaction. */
export function selectSoulMarket(input: { souls: readonly ChainSoulDetail[]; coverage: PublicMarketCoverage;
  originalPackageId: string; viewerAddress: string | null; identities?: Readonly<Record<string, MarketCreatorIdentity>> }, params: SoulsListParams = {}) {
  const { souls, coverage, originalPackageId: pkg, viewerAddress, identities = {} } = structuredClone(input)
  scope(pkg, coverage, viewerAddress)
  check(new Set(souls.map(s => s.onChainId)).size === souls.length, 'DUPLICATE_SOUL')
  const q = text(params.q), tag = text(params.tag), creator = text(params.creator), persona = params.persona ?? 'all', sort = params.sort ?? 'newest'
  check(['all', 'agents', 'characters'].includes(persona) && ['newest', 'price_asc', 'price_desc', 'popular'].includes(sort), 'FILTER_INVALID')
  const min = params.minPrice ? integer(params.minPrice) : null, max = params.maxPrice ? integer(params.maxPrice) : null
  check(min === null || max === null || min <= max, 'PRICE_RANGE_INVALID')
  const counts = new Map<string, number>(), rows: PublicMarketSoul[] = []
  let identityIncomplete = false
  for (const soul of souls) {
    check(id(soul.onChainId) && soul.originalPackageId === pkg && soul.viewerAddress === viewerAddress, 'SOUL_SCOPE_MISMATCH')
    check(['listed', 'floor-violation', 'unlisted'].includes(soul.listingStatus), 'LISTING_INVALID')
    if (soul.listingStatus !== 'listed') continue
    check(soul.listedPriceAtomic !== null && integer(soul.listedPriceAtomic) > 0n, 'LISTING_PRICE_INVALID')
    integer(soul.createdAtMs)
    const tags = [...new Set(soul.tags.map(t => t.toLowerCase()))]
    for (const key of tags) counts.set(key, (counts.get(key) ?? 0) + 1)
    check(new Set(soul.activeGrants.map(g => g.onChainId)).size === soul.activeGrants.length, 'GRANT_DUPLICATE')
    for (const grant of soul.activeGrants) check(grant.soulOnChainId === soul.onChainId, 'GRANT_SCOPE_MISMATCH')
    const identity = identities[soul.creatorAddress] ?? null
    if (identity) check(identity.address === soul.creatorAddress && ['VERIFIED', 'ABSENT', 'UNAVAILABLE'].includes(identity.status), 'CREATOR_SCOPE_MISMATCH')
    if (q && !soul.name.toLowerCase().includes(q) && !soul.description.toLowerCase().includes(q) && !tags.includes(q)) continue
    if (tag && !tags.includes(tag) || persona !== 'all' && soul.personaKind !== persona) continue
    const amount = integer(soul.listedPriceAtomic!)
    if (min !== null && amount < min || max !== null && amount > max) continue
    if (creator && !soul.creatorAddress.toLowerCase().includes(creator)) {
      if (!identity || identity.status === 'UNAVAILABLE') { identityIncomplete = true; continue }
      if (identity.status === 'ABSENT' || ![identity.displayName, identity.handle].some(v => v?.toLowerCase().includes(creator))) continue
    }
    rows.push({ ...soul, effectiveGrantCount: String(soul.activeGrants.filter(g => g.status === 'active').length), creatorIdentity: identity })
  }
  rows.sort((a, b) => (sort === 'price_asc' ? numbers(a.listedPriceAtomic!, b.listedPriceAtomic!)
    : sort === 'price_desc' ? numbers(b.listedPriceAtomic!, a.listedPriceAtomic!)
      : sort === 'popular' ? numbers(b.effectiveGrantCount, a.effectiveGrantCount) : 0)
    || numbers(b.createdAtMs, a.createdAtMs) || order(a.onChainId, b.onChainId))
  return freeze({ ...page(rows, coverage, params, identityIncomplete, 0, identityIncomplete),
    tags: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || order(a.tag, b.tag)) })
}

export function selectCollectionMarket(input: { collections: readonly CollectionPublicSnapshot[]; coverage: PublicMarketCoverage;
  originalPackageId: string; viewerAddress: string | null }, params: CollectionsListParams = {}) {
  const { collections, coverage, originalPackageId: pkg, viewerAddress } = structuredClone(input)
  scope(pkg, coverage, viewerAddress)
  check(new Set(collections.map(c => c.collectionId)).size === collections.length, 'DUPLICATE_COLLECTION')
  const q = text(params.q); let unavailable = 0
  const selected = collections.filter(c => {
    check(id(c.collectionId) && c.listingSource.scope.packageId === pkg
      && c.listingSource.scope.type === `${pkg}::market::CollectionListing`, 'COLLECTION_SCOPE_MISMATCH')
    const created = c.creatorAddress === viewerAddress, held = c.currentHolderAddress === viewerAddress
    check(c.relationship === (created ? held ? 'CREATED_HELD' : 'CREATED_SOLD' : held ? 'ACQUIRED' : 'UNRELATED'), 'COLLECTION_VIEWER_MISMATCH')
    check(['HELD', 'LISTED', 'UNAVAILABLE'].includes(c.status), 'COLLECTION_STATUS_INVALID')
    integer(c.currentSupply); if (c.maxSupply !== null) integer(c.maxSupply)
    if (q && !c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) return false
    if (c.status === 'UNAVAILABLE') unavailable++
    return params.listed !== true || c.status === 'LISTED'
  })
  // Collection BCS has no creation timestamp. Do not invent newest ordering from
  // current object versions; stable IDs keep pages deterministic until evidence exists.
  selected.sort((a, b) => order(a.collectionId, b.collectionId))
  return page(selected, coverage, params, params.listed === true && unavailable > 0, unavailable)
}
