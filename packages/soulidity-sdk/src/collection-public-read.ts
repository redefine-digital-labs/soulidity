import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  SOUL_PUBLIC_USDC_TYPE, type SoulPublicListingClient } from './soul-public-listing'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, KIOSK_ITEM_FIELD_BYTES } from './kiosk-item-custody'
import { CollectionFloorFieldBcs, CollectionFloorKeyBcs } from './collection-floor-read'
import { normalizeCollectionFloorAtomic } from './collection-floor-policy'
import type { ChainObjectDiscoveryPage } from './chain-object-discovery'

export interface CollectionPublicDeployment {
  originalPackageId: string; chainIdentifier: string; marketConfigId: string; paymentCoinType: string
  kioskRegistryId: string; personalKioskTypePackageId: string
}
export type CollectionPublicReadClient = SoulPublicListingClient
const A = bcs.Address, U = bcs.u64(), B = bcs.bool()
const PurchaseCap = bcs.struct('PurchaseCap', { id: A, kiosk_id: A, item_id: A, min_price: U })
export const CollectionPublicListingBcs = bcs.struct('CollectionListing', { id: A, version: U, collection_id: A,
  right_id: A, seller: A, seller_kiosk_id: A, price: U, purchase_cap: bcs.option(PurchaseCap), is_active: B })
export const CollectionKioskListingKeyBcs = bcs.struct('Listing', { id: A, is_exclusive: B })
export const CollectionKioskListingFieldBcs = bcs.struct('Field', { id: A, name: CollectionKioskListingKeyBcs, value: U })
export const CollectionKioskRegistryBcs = bcs.struct('KioskRegistry', { id: A, version: U })
export const CollectionKioskOwnerKeyBcs = bcs.struct('PersonalKioskOwnerKey', { owner: A })
export const CollectionKioskRegistrationFieldBcs = bcs.struct('Field', { id: A, name: CollectionKioskOwnerKeyBcs,
  value: bcs.struct('PersonalKioskRegistration', { version: U, kiosk_id: A, kiosk_cap_id: A }) })
export const CollectionPersonalKioskCapBcs = bcs.struct('PersonalKioskCap', { id: A,
  cap: bcs.option(bcs.struct('KioskOwnerCap', { id: A, for: A })) })
type Root = ReturnType<typeof SoulPublicCollectionBcs.parse>
type Listing = ReturnType<typeof CollectionPublicListingBcs.parse>
export interface CollectionListingObservation {
  readonly listing: Listing; readonly objectVersion: string; readonly objectDigest: string
}
export interface CollectionListingCandidateScan {
  readonly observations: readonly CollectionListingObservation[]
  readonly status: ChainObjectDiscoveryPage['page']['status']; readonly source: ChainObjectDiscoveryPage['source']
}
export interface CollectionPublicRoot {
  readonly collection: Root; readonly objectVersion: string; readonly objectDigest: string
}
export interface CollectionPublicSnapshot {
  collectionId: string; rightId: string; creatorAddress: string; currentHolderAddress: string; holderKioskId: string
  name: string; description: string; imageUrl: string; maxSupply: string | null; currentSupply: string
  extraRoyaltyBps: number; rightTradeable: boolean; floorPriceAtomic: string | null
  relationship: 'CREATED_HELD' | 'CREATED_SOLD' | 'ACQUIRED' | 'UNRELATED'
  status: 'HELD' | 'LISTED' | 'UNAVAILABLE'; unavailableReason: 'LISTING_SCAN_INCOMPLETE' | 'RESERVATION_UNMATCHED' | null
  listingId: string | null; priceAtomic: string | null; isViewerListing: boolean; personalKioskCapId: string | null
  market: { secondaryEnabled: boolean; platformFeeBps: number }
  quote: null | { model: 'BASE_PLUS_FEES'; priceAtomic: string; platformFeeAtomic: string; totalPaymentAtomic: string; available: boolean }
  currency: { coinType: string; symbol: 'USDC'; decimals: 6 }
  createdAtMs: null; updatedAtMs: null; dateEvidence: 'UNAVAILABLE'
  collectionVersion: string; collectionDigest: string
  listingSource: ChainObjectDiscoveryPage['source']; readConsistency: 'NON_ATOMIC_CURRENT_READSET'; notTransactionAuthorization: true
}
const MAX = 18446744073709551615n, ZERO = `0x${'0'.repeat(64)}`
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COLLECTION_PUBLIC_${code}`) }
function id(value: unknown): asserts value is string { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value !== ZERO, 'INVALID_ID') }
function digest(value: unknown): asserts value is string { check(typeof value === 'string' && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'INVALID_DIGEST') }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
function decode<T extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: T, bytes: Uint8Array): ReturnType<T['parse']> {
  const value = codec.parse(bytes); check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}
export function assertCollectionPublicDeployment(input: CollectionPublicDeployment): Readonly<CollectionPublicDeployment> {
  const d = structuredClone(input)
  check(d && Object.keys(d).sort().join() === ['originalPackageId', 'chainIdentifier', 'marketConfigId', 'paymentCoinType', 'kioskRegistryId', 'personalKioskTypePackageId'].sort().join(), 'DEPLOYMENT_INVALID')
  for (const value of [d.originalPackageId, d.marketConfigId, d.kioskRegistryId, d.personalKioskTypePackageId]) id(value)
  check(/^[0-9a-f]{8}$/.test(d.chainIdentifier) && d.paymentCoinType === SOUL_PUBLIC_USDC_TYPE, 'DEPLOYMENT_INVALID')
  return Object.freeze(d)
}
interface Common { client: CollectionPublicReadClient; deployment: CollectionPublicDeployment; signal?: AbortSignal }
async function session(params: Common) {
  const d = assertCollectionPublicDeployment(params.deployment), client = params.client
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  const chain = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier
  digest(chain); check(toHex(fromBase58(chain).subarray(0, 4)) === d.chainIdentifier, 'WRONG_CHAIN')
  type Raw = NonNullable<Awaited<ReturnType<CollectionPublicReadClient['ledgerService']['getObject']>>['response']['object']>
  const reads = new Map<string, { type: string; kind: number | undefined; owner: string | undefined; optional: boolean; maximum: number; raw: Raw | null }>()
  async function read(objectId: string, type: string, kind: number | undefined, owner?: string, optional = false, maximum = 16384) {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result.oneofKind === 'object' || optional && result.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const raw = result.oneofKind === 'object' ? structuredClone(result.object) : null
    if (raw) {
      check(raw.objectId === objectId && raw.objectType === normalizeStructTag(type) && typeof raw.version === 'bigint' && raw.version > 0n && raw.version <= MAX, 'OBJECT_MISMATCH')
      digest(raw.digest)
      check(raw.owner && (kind === undefined || raw.owner.kind === kind) && (owner === undefined || raw.owner.address === owner)
        && (raw.owner.kind !== 3 || typeof raw.owner.version === 'bigint' && raw.owner.version > 0n && raw.owner.version <= raw.version), 'CUSTODY_MISMATCH')
      check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0 && raw.contents.value.length <= maximum, 'BCS_BUDGET')
    }
    const prior = reads.get(objectId)
    const fingerprint = (r: Raw | null) => r === null ? 'absent' : [r.version, r.digest, r.owner?.kind, r.owner?.address,
      r.owner?.version, toBase64(r.contents!.value!)].join('|')
    if (prior) check(prior.type === type && prior.kind === kind && prior.owner === owner && fingerprint(prior.raw) === fingerprint(raw), 'CHANGED_RETRY')
    else reads.set(objectId, { type, kind, owner, optional, maximum, raw })
    return raw
  }
  async function verify() { for (const [objectId, r] of reads) await read(objectId, r.type, r.kind, r.owner, r.optional, r.maximum); signal.throwIfAborted() }
  return { d, read, verify }
}
function rootValid(c: Root, collectionId: string) {
  check(c.id === collectionId && c.version === '1' && c.extra_royalty_bps <= 10000
    && (c.max_supply === null || BigInt(c.max_supply) > 0n && BigInt(c.current_supply) <= BigInt(c.max_supply)), 'COLLECTION_MISMATCH')
  for (const value of [c.creator, c.current_holder, c.current_holder_kiosk_id, c.right_id]) id(value)
  check(new Set([c.id, c.right_id, c.current_holder_kiosk_id]).size === 3, 'OBJECT_ALIAS')
}
function listingValid(l: Listing, listingId: string) {
  check(l.id === listingId && l.version === '1' && BigInt(l.price) > 0n, 'LISTING_INVALID')
  for (const value of [l.collection_id, l.right_id, l.seller, l.seller_kiosk_id]) id(value)
  check(new Set([l.id, l.collection_id, l.right_id, l.seller_kiosk_id]).size === 4, 'OBJECT_ALIAS')
  if (l.is_active) {
    const cap = l.purchase_cap
    check(cap && cap.item_id === l.right_id && cap.kiosk_id === l.seller_kiosk_id && cap.min_price === '0', 'PURCHASE_CAP_MISMATCH')
    id(cap.id); check(![l.id, l.collection_id, l.right_id, l.seller_kiosk_id].includes(cap.id), 'PURCHASE_CAP_MISMATCH')
  } else check(l.purchase_cap === null, 'INACTIVE_CAP_PRESENT')
}
export async function readCollectionPublicRoot(params: Common & { collectionId: string }): Promise<CollectionPublicRoot> {
  const collectionId = params.collectionId, s = await session(params)
  const raw = (await s.read(collectionId, `${s.d.originalPackageId}::collection::SoulCollection`, 3))!
  const collection = decode(SoulPublicCollectionBcs, raw.contents!.value!); rootValid(collection, collectionId)
  await s.verify(); return freeze({ collection, objectVersion: String(raw.version), objectDigest: raw.digest! })
}
/** A held Right is a candidate back-pointer only; the complete snapshot proves custody. */
export async function readCollectionRightCandidate(params: Common & { rightId: string }): Promise<string> {
  const rightId = params.rightId, s = await session(params)
  const raw = (await s.read(rightId, `${s.d.originalPackageId}::collection::SoulCollectionRight`, 2, undefined, false, 262144))!
  const r = decode(SoulPublicCollectionRightBcs, raw.contents!.value!)
  check(r.id === rightId && r.version === '1', 'RIGHT_MISMATCH'); id(r.collection_id); id(r.creator)
  await s.verify(); return r.collection_id
}
export async function readCollectionListingCandidate(params: Common & { listingId: string }): Promise<CollectionListingObservation | null> {
  const listingId = params.listingId, s = await session(params)
  const raw = await s.read(listingId, `${s.d.originalPackageId}::market::CollectionListing`, 3, undefined, true)
  if (!raw) { await s.verify(); return null }
  const listing = decode(CollectionPublicListingBcs, raw.contents!.value!); listingValid(listing, listingId)
  await s.verify(); return freeze({ listing, objectVersion: String(raw.version), objectDigest: raw.digest! })
}

/** Current observations, not a transaction plan. The complete checkpoint scan
 * supplies candidate IDs only. Matching listings are reread with custody; old
 * inactive listings cannot reactivate (reprice creates a new Listing). No date
 * is fabricated from an object's latest mutation or the observation clock. */
export async function readCollectionPublicSnapshot(params: Common & { collectionId: string; viewerAddress: string | null;
  listingScan: CollectionListingCandidateScan; expectedRoot?: { objectVersion: string; objectDigest: string }
}): Promise<Readonly<CollectionPublicSnapshot>> {
  const { collectionId, viewerAddress: viewer, listingScan: scan, expectedRoot } = structuredClone({ collectionId: params.collectionId,
    viewerAddress: params.viewerAddress, listingScan: params.listingScan, expectedRoot: params.expectedRoot })
  // Anonymous public reads have no wallet relationship or holder action evidence.
  if (viewer !== null) id(viewer)
  const s = await session(params), { d } = s, pkg = d.originalPackageId
  check(scan && ['PARTIAL', 'COMPLETE', 'LIMIT_REACHED'].includes(scan.status) && scan.source.authority === 'CANDIDATE_IDS_ONLY'
    && scan.source.chainIdentifier === d.chainIdentifier && scan.source.scope.packageId === pkg
    && scan.source.scope.type === `${pkg}::market::CollectionListing` && scan.source.scope.owner?.kind === 'SHARED'
    && Array.isArray(scan.observations) && scan.observations.length <= 10000, 'LISTING_SCAN_INVALID')
  const raw = (await s.read(collectionId, `${pkg}::collection::SoulCollection`, 3))!
  if (expectedRoot) check(String(raw.version) === expectedRoot.objectVersion && raw.digest === expectedRoot.objectDigest, 'STALE_METADATA')
  const c = decode(SoulPublicCollectionBcs, raw.contents!.value!); rootValid(c, collectionId)
  const fieldId = deriveKioskItemFieldId(c.current_holder_kiosk_id, c.right_id)
  assertKioskItemField((await s.read(fieldId, KIOSK_ITEM_FIELD_TYPE, 2, c.current_holder_kiosk_id, false, KIOSK_ITEM_FIELD_BYTES))!.contents!.value!, c.current_holder_kiosk_id, c.right_id)
  const r = decode(SoulPublicCollectionRightBcs, (await s.read(c.right_id, `${pkg}::collection::SoulCollectionRight`, 2, fieldId, false, 262144))!.contents!.value!)
  check(r.id === c.right_id && r.version === '1' && r.collection_id === c.id && r.creator === c.creator, 'RIGHT_MISMATCH')
  const k = decode(SoulPublicKioskBcs, (await s.read(c.current_holder_kiosk_id, '0x2::kiosk::Kiosk', 3))!.contents!.value!)
  check(k.id === c.current_holder_kiosk_id && k.owner === c.current_holder && k.item_count > 0, 'KIOSK_MISMATCH')
  const floorType = `${pkg}::collection::FloorPolicyKeyV1`
  const floorId = deriveDynamicFieldID(c.id, floorType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
  const floor = decode(CollectionFloorFieldBcs, (await s.read(floorId, `0x2::dynamic_field::Field<${floorType},0x1::option::Option<u128>>`, 2, c.id))!.contents!.value!)
  check(floor.id === floorId && floor.name.version === 1, 'FLOOR_MISMATCH')
  const floorPriceAtomic = normalizeCollectionFloorAtomic(floor.value)?.toString() ?? null
  const config = decode(SoulPublicMarketConfigBcs, (await s.read(d.marketConfigId, `${pkg}::market::MarketConfigV2`, 3))!.contents!.value!)
  check(config.id === d.marketConfigId && config.version === '2' && config.legacy_config_id === ZERO && config.platform_fee_bps <= 10000, 'MARKET_MISMATCH'); id(config.fee_recipient)
  const markers: Array<string | null> = []
  for (const exclusive of [true, false]) {
    const name = { id: c.right_id, is_exclusive: exclusive }, markerId = deriveDynamicFieldID(k.id, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs.serialize(name).toBytes())
    const marker = await s.read(markerId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', 2, k.id, true)
    if (marker) { const m = decode(CollectionKioskListingFieldBcs, marker.contents!.value!)
      check(m.id === markerId && m.name.id === r.id && m.name.is_exclusive === exclusive, 'RESERVATION_MISMATCH')
      markers.push(m.value)
    } else markers.push(null)
  }
  let listing: Listing | null = null
  const ids = new Set<string>()
  for (const observation of scan.observations) {
    const candidate = observation.listing; listingValid(candidate, candidate.id)
    check(!ids.has(candidate.id), 'LISTING_AMBIGUOUS'); ids.add(candidate.id)
    if (!candidate.is_active || candidate.collection_id !== c.id && candidate.right_id !== r.id) continue
    const currentRaw = (await s.read(candidate.id, `${pkg}::market::CollectionListing`, 3))!
    check(String(currentRaw.version) === observation.objectVersion && currentRaw.digest === observation.objectDigest, 'STALE_LISTING_SCAN')
    const current = decode(CollectionPublicListingBcs, currentRaw.contents!.value!); listingValid(current, candidate.id)
    check(toBase64(CollectionPublicListingBcs.serialize(current).toBytes()) === toBase64(CollectionPublicListingBcs.serialize(candidate).toBytes()), 'STALE_LISTING_SCAN')
    check(current.collection_id === c.id && current.right_id === r.id && current.seller === c.current_holder && current.seller_kiosk_id === k.id && c.tradeable, 'LISTING_MISMATCH')
    check(listing === null, 'LISTING_AMBIGUOUS'); listing = current
  }
  // Generic Kiosk reservations may have any u64 minimum price. Only this
  // Market's proven purchase-cap listing requires the exclusive zero marker.
  check(!listing || markers[0] === '0' && markers[1] === null, 'LISTING_RESERVATION_MISMATCH')
  let personalKioskCapId: string | null = null
  if (viewer === c.current_holder) {
    const registry = decode(CollectionKioskRegistryBcs, (await s.read(d.kioskRegistryId, `${pkg}::market::KioskRegistry`, 3))!.contents!.value!)
    check(registry.id === d.kioskRegistryId && registry.version === '1', 'REGISTRY_MISMATCH')
    const keyType = `${pkg}::market::PersonalKioskOwnerKey`, regId = deriveDynamicFieldID(registry.id, keyType, CollectionKioskOwnerKeyBcs.serialize({ owner: viewer }).toBytes())
    const reg = decode(CollectionKioskRegistrationFieldBcs, (await s.read(regId, `0x2::dynamic_field::Field<${keyType},${pkg}::market::PersonalKioskRegistration>`, 2, registry.id))!.contents!.value!)
    check(reg.id === regId && reg.name.owner === viewer && reg.value.version === '1' && reg.value.kiosk_id === k.id, 'REGISTRATION_MISMATCH'); id(reg.value.kiosk_cap_id)
    const capRaw = await s.read(reg.value.kiosk_cap_id, `${d.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`, 1, viewer, true)
    if (capRaw) { const cap = decode(CollectionPersonalKioskCapBcs, capRaw.contents!.value!)
      check(cap.id === reg.value.kiosk_cap_id && cap.cap && cap.cap.for === k.id, 'PERSONAL_CAP_MISMATCH'); id(cap.cap.id)
      check(![k.id, cap.id].includes(cap.cap.id), 'PERSONAL_CAP_MISMATCH'); personalKioskCapId = cap.id }
  }
  const unavailableReason = scan.status !== 'COMPLETE' ? 'LISTING_SCAN_INCOMPLETE' : !listing && markers.some(value => value !== null) ? 'RESERVATION_UNMATCHED' : null
  let quote: CollectionPublicSnapshot['quote'] = null
  if (listing) { const price = BigInt(listing.price), fee = (price * BigInt(config.platform_fee_bps) + 9999n) / 10000n
    check(price + fee <= MAX, 'QUOTE_OVERFLOW'); quote = { model: 'BASE_PLUS_FEES', priceAtomic: listing.price,
      platformFeeAtomic: String(fee), totalPaymentAtomic: String(price + fee), available: config.secondary_enabled && unavailableReason === null } }
  await s.verify()
  return freeze({ collectionId: c.id, rightId: r.id, creatorAddress: c.creator, currentHolderAddress: c.current_holder, holderKioskId: k.id,
    name: r.name, description: r.description, imageUrl: r.image_url, maxSupply: c.max_supply, currentSupply: c.current_supply,
    extraRoyaltyBps: c.extra_royalty_bps, rightTradeable: c.tradeable, floorPriceAtomic,
    relationship: viewer === c.creator ? viewer === c.current_holder ? 'CREATED_HELD' : 'CREATED_SOLD' : viewer === c.current_holder ? 'ACQUIRED' : 'UNRELATED',
    status: unavailableReason ? 'UNAVAILABLE' : listing ? 'LISTED' : 'HELD', unavailableReason,
    listingId: listing?.id ?? null, priceAtomic: listing?.price ?? null, isViewerListing: listing !== null && viewer === c.current_holder,
    personalKioskCapId, quote, market: { secondaryEnabled: config.secondary_enabled, platformFeeBps: config.platform_fee_bps },
    currency: { coinType: d.paymentCoinType, symbol: 'USDC', decimals: 6 }, createdAtMs: null, updatedAtMs: null, dateEvidence: 'UNAVAILABLE',
    collectionVersion: String(raw.version), collectionDigest: raw.digest!, listingSource: scan.source,
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
}
