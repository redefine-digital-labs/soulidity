import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  CollectionPublicListingBcs, CollectionPersonalKioskCapBcs, CollectionKioskRegistrationFieldBcs,
  CollectionKioskRegistryBcs, CollectionKioskOwnerKeyBcs, CollectionKioskListingKeyBcs,
  CollectionKioskListingFieldBcs, deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE,
  SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { soulAccessAddress as id, soulAccessDigest as digest, soulAccessUint as uint,
  soulAccessExact as exact, soulAccessSame as same, soulAccessFreeze as freeze,
  soulAccessDecode as decode, soulAccessBcs as decode64 } from '../soulidity/soul-access-plan'

export { id, digest, uint, exact, same, freeze, decode, decode64 }
export function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COLLECTION_COMMAND_${code}`) }
export const COLLECTION_COMMAND_MAX = 18446744073709551615n
export interface CollectionCommandTarget {
  chainIdentifier: string; originalPackageId: string; callablePackageId: string; callableDigest: string
  marketConfigId: string; kioskRegistryId: string; personalKioskTypePackageId: string; paymentCoinType: string
}
export interface CollectionCommandRequest { action: 'list' | 'reprice' | 'delist'; collectionId: string; priceAtomic: string | null }
/** Full canonical objects, not SQL IDs or contents relabelled with a digest. */
export interface CollectionCommandObject { objectId: string; version: string; digest: string; bcs: string }
export interface CollectionCommandPlan {
  schema: 'soulidity.collection-command-plan.v1'; target: CollectionCommandTarget; request: CollectionCommandRequest
  author: string; rightId: string; kioskId: string; kioskCapId: string; oldListingId: string | null
  objects: CollectionCommandObject[]; absentIds: string[]
  expected: { collectionBcs: string; rightBcs: string; kioskBcs: string; registrationBcs: string; capBcs: string;
    listingBcs: string | null; marketBcs: string | null }
  quote: { priceAtomic: string; feeBps: number; feeAtomic: string; buyerTotalAtomic: string; sellerReceivesAtomic: string }
}
export interface CollectionCommandRecord {
  schema: 'soulidity.collection-command.v1'; plan: CollectionCommandPlan
  packet: { bytes: string; digest: string; expirationEpoch: string;
    phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; signature: string | null }
}
export interface CollectionCommandQuery {
  status: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'; checkpoint?: string
  receipt?: { collectionId: string; rightId: string; oldListingId: string | null; newListingId: string | null; priceAtomic: string | null }
}
export function parseCollectionCommandTarget(input: unknown): CollectionCommandTarget {
  const d = structuredClone(input) as CollectionCommandTarget
  exact(d, ['chainIdentifier', 'originalPackageId', 'callablePackageId', 'callableDigest', 'marketConfigId',
    'kioskRegistryId', 'personalKioskTypePackageId', 'paymentCoinType'])
  check(/^[0-9a-f]{8}$/.test(d.chainIdentifier) && d.paymentCoinType === SOUL_PUBLIC_USDC_TYPE, 'TARGET_INVALID')
  ;[d.originalPackageId, d.callablePackageId, d.marketConfigId, d.kioskRegistryId, d.personalKioskTypePackageId].forEach(value => id(value))
  digest(d.callableDigest); return freeze(d)
}
export function collectionCommandHash(domain: string, bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length); return toBase58(blake2b(input, { dkLen: 32 }))
}
export function collectionCommandRaw(input: CollectionCommandObject) {
  exact(input, ['objectId', 'version', 'digest', 'bcs']); id(input.objectId); uint(input.version, true); digest(input.digest)
  check(typeof input.bcs === 'string' && input.bcs.length > 0 && input.bcs.length <= 2 * 1024 * 1024, 'OBJECT_BUDGET')
  const bytes = fromBase64(input.bcs); check(toBase64(bytes) === input.bcs, 'OBJECT_BASE64')
  const raw = decode(bcs.Object, bytes)
  check(collectionCommandHash('Object', bytes) === input.digest, 'OBJECT_DIGEST')
  if (raw.data.Move) check(raw.data.Move.version === input.version
    && `0x${toHex(raw.data.Move.contents.subarray(0, 32))}` === input.objectId, 'OBJECT_ID_VERSION')
  else check(raw.data.Package?.id === input.objectId && raw.data.Package.version === input.version, 'PACKAGE_ID_VERSION')
  const owner = raw.owner
  if (owner.Shared) { uint(owner.Shared.initialSharedVersion, true); check(BigInt(owner.Shared.initialSharedVersion) <= BigInt(input.version), 'SHARED_BIRTH') }
  digest(raw.previousTransaction); return raw
}
export function collectionCommandTypes(d: CollectionCommandTarget) {
  const p = d.originalPackageId, key = `${p}::market::PersonalKioskOwnerKey`
  return { collection: `${p}::collection::SoulCollection`, right: `${p}::collection::SoulCollectionRight`,
    kiosk: normalizeStructTag('0x2::kiosk::Kiosk'), cap: `${d.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`,
    registry: `${p}::market::KioskRegistry`, registration: normalizeStructTag(`0x2::dynamic_field::Field<${key},${p}::market::PersonalKioskRegistration>`),
    key, listing: `${p}::market::CollectionListing`, market: `${p}::market::MarketConfigV2`,
    marker: normalizeStructTag('0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>'), item: KIOSK_ITEM_FIELD_TYPE }
}
export function collectionCommandMarker(kioskId: string, rightId: string, exclusive: boolean) {
  return deriveDynamicFieldID(kioskId, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs.serialize({ id: rightId, is_exclusive: exclusive }).toBytes())
}
export function collectionCommandRegistration(d: CollectionCommandTarget, author: string) {
  return deriveDynamicFieldID(d.kioskRegistryId, collectionCommandTypes(d).key, CollectionKioskOwnerKeyBcs.serialize({ owner: author }).toBytes())
}
/** Validate all stored domain relationships again on import. Object versions are
 * observations, NOT a fictitious Collection ownership epoch. Chain holder ABA
 * with identical frozen values is legal; wallet/lifecycle ABA is not. */
export function parseCollectionCommandPlan(input: unknown): CollectionCommandPlan {
  const p = structuredClone(input) as CollectionCommandPlan
  exact(p, ['schema', 'target', 'request', 'author', 'rightId', 'kioskId', 'kioskCapId', 'oldListingId', 'objects', 'absentIds', 'expected', 'quote'])
  check(p.schema === 'soulidity.collection-command-plan.v1', 'PLAN_SCHEMA'); p.target = parseCollectionCommandTarget(p.target)
  exact(p.request, ['action', 'collectionId', 'priceAtomic'])
  check(['list', 'reprice', 'delist'].includes(p.request.action), 'ACTION_INVALID')
  ;[p.author, p.request.collectionId, p.rightId, p.kioskId, p.kioskCapId].forEach(value => id(value))
  const listing = p.request.action !== 'list', selling = p.request.action !== 'delist'
  check(listing === (p.oldListingId !== null), 'LISTING_REQUIRED'); if (p.oldListingId !== null) id(p.oldListingId)
  if (selling) uint(p.request.priceAtomic, true); else check(p.request.priceAtomic === null, 'DELIST_PRICE')
  exact(p.expected, ['collectionBcs', 'rightBcs', 'kioskBcs', 'registrationBcs', 'capBcs', 'listingBcs', 'marketBcs'])
  exact(p.quote, ['priceAtomic', 'feeBps', 'feeAtomic', 'buyerTotalAtomic', 'sellerReceivesAtomic'])
  check(Array.isArray(p.objects) && p.objects.length <= 12 && Array.isArray(p.absentIds) && p.absentIds.length <= 2, 'READSET_BUDGET')
  const ids = new Set<string>(), used = new Set<string>(), objects = new Map(p.objects.map(object => {
    check(!ids.has(object.objectId), 'DUPLICATE_OBJECT'); ids.add(object.objectId)
    return [object.objectId, collectionCommandRaw(object)] as const
  }))
  for (const absent of p.absentIds) { id(absent); check(!ids.has(absent), 'ABSENCE_ALIAS'); ids.add(absent) }
  check(new Set(p.absentIds).size === p.absentIds.length, 'DUPLICATE_ABSENCE')
  const d = p.target, t = collectionCommandTypes(d)
  function move(objectId: string, type: string, kind: 'Shared' | 'ObjectOwner' | 'AddressOwner', owner?: string, expected?: string) {
    const raw = objects.get(objectId), value = raw?.data.Move
    check(raw && value?.type.Other && normalizeStructTag(TypeTagSerializer.tagToString({ struct: value.type.Other })) === normalizeStructTag(type)
      && raw.owner.$kind === kind && (owner === undefined || raw.owner.ObjectOwner === owner || raw.owner.AddressOwner === owner), 'RAW_TYPE_OWNER')
    if (expected !== undefined) check(toBase64(value.contents) === expected, 'EXPECTED_BYTES')
    used.add(objectId); return value.contents
  }
  const packageRaw = objects.get(d.callablePackageId), pkg = packageRaw?.data.Package
  check(pkg && packageRaw.owner.$kind === 'Immutable' && p.objects.find(row => row.objectId === d.callablePackageId)?.digest === d.callableDigest, 'CALLABLE_PACKAGE')
  for (const [module, name] of [['collection', 'SoulCollection'], ['collection', 'SoulCollectionRight'], ['market', 'CollectionListing'], ['market', 'MarketConfigV2'], ['market', 'KioskRegistry'], ['market', 'PersonalKioskRegistration'], ['market', 'PersonalKioskOwnerKey'], ['market', 'CollectionListed'], ['market', 'CollectionListingCancelled']]) {
    const origins = pkg.typeOriginTable.filter(row => row.moduleName === module && row.datatypeName === name)
    check(origins.length === 1 && origins[0].package === d.originalPackageId && pkg.moduleMap.has(module), 'TYPE_ORIGIN')
  }
  used.add(d.callablePackageId)
  const c = decode(SoulPublicCollectionBcs, move(p.request.collectionId, t.collection, 'Shared', undefined, p.expected.collectionBcs))
  check(c.version === '1' && c.current_holder === p.author && c.current_holder_kiosk_id === p.kioskId && c.right_id === p.rightId
    && c.extra_royalty_bps <= 10000 && (!selling || c.tradeable)
    && (c.max_supply === null || BigInt(c.max_supply) > 0n && BigInt(c.current_supply) <= BigInt(c.max_supply)), 'COLLECTION_AUTHORITY')
  id(c.creator)
  const itemId = deriveKioskItemFieldId(p.kioskId, p.rightId)
  assertKioskItemField(move(itemId, t.item, 'ObjectOwner', p.kioskId), p.kioskId, p.rightId)
  const r = decode(SoulPublicCollectionRightBcs, move(p.rightId, t.right, 'ObjectOwner', itemId, p.expected.rightBcs))
  check(r.version === '1' && r.collection_id === c.id && r.creator === c.creator, 'RIGHT_RELATION')
  const k = decode(SoulPublicKioskBcs, move(p.kioskId, t.kiosk, 'Shared', undefined, p.expected.kioskBcs))
  check(k.owner === p.author && k.item_count > 0, 'KIOSK_AUTHORITY')
  const registry = decode(CollectionKioskRegistryBcs, move(d.kioskRegistryId, t.registry, 'Shared'))
  check(registry.version === '1', 'REGISTRY_VERSION')
  const regId = collectionCommandRegistration(d, p.author)
  const reg = decode(CollectionKioskRegistrationFieldBcs, move(regId, t.registration, 'ObjectOwner', d.kioskRegistryId, p.expected.registrationBcs))
  check(reg.name.owner === p.author && reg.value.version === '1' && reg.value.kiosk_id === p.kioskId && reg.value.kiosk_cap_id === p.kioskCapId, 'KIOSK_REGISTRATION')
  const cap = decode(CollectionPersonalKioskCapBcs, move(p.kioskCapId, t.cap, 'AddressOwner', p.author, p.expected.capBcs))
  check(cap.cap && cap.cap.for === p.kioskId && !ids.has(cap.cap.id), 'KIOSK_CAP'); id(cap.cap.id)
  const exclusive = collectionCommandMarker(p.kioskId, p.rightId, true), ordinary = collectionCommandMarker(p.kioskId, p.rightId, false)
  check(p.absentIds.includes(ordinary), 'ORDINARY_RESERVATION')
  if (listing) {
    const marker = decode(CollectionKioskListingFieldBcs, move(exclusive, t.marker, 'ObjectOwner', p.kioskId))
    check(marker.name.id === p.rightId && marker.name.is_exclusive && marker.value === '0', 'EXCLUSIVE_RESERVATION')
    const l = decode(CollectionPublicListingBcs, move(p.oldListingId!, t.listing, 'Shared', undefined, p.expected.listingBcs!))
    check(l.version === '1' && l.is_active && l.collection_id === c.id && l.right_id === r.id && l.seller === p.author && l.seller_kiosk_id === p.kioskId
      && l.purchase_cap && l.purchase_cap.kiosk_id === p.kioskId && l.purchase_cap.item_id === p.rightId && l.purchase_cap.min_price === '0', 'ACTIVE_LISTING')
    uint(l.price, true); id(l.purchase_cap.id); check(!ids.has(l.purchase_cap.id) && l.purchase_cap.id !== cap.cap.id, 'PURCHASE_CAP_ALIAS')
    if (!selling) check(p.quote.priceAtomic === l.price, 'DELIST_PRICE_MISMATCH')
    if (p.request.action === 'reprice') check(l.price !== p.request.priceAtomic, 'UNCHANGED_PRICE')
  } else check(p.expected.listingBcs === null && p.absentIds.includes(exclusive), 'HELD_REQUIRED')
  let feeBps = 0
  if (selling) {
    const market = decode(SoulPublicMarketConfigBcs, move(d.marketConfigId, t.market, 'Shared', undefined, p.expected.marketBcs!))
    check(market.version === '2' && market.secondary_enabled && market.platform_fee_bps <= 10000
      && /^0x0+$/.test(market.legacy_config_id), 'SECONDARY_MARKET_UNAVAILABLE'); id(market.fee_recipient); feeBps = market.platform_fee_bps
  } else check(p.expected.marketBcs === null, 'DELIST_MARKET_UNNECESSARY')
  const price = selling ? p.request.priceAtomic! : p.quote.priceAtomic; uint(price, true)
  const fee = selling ? (BigInt(price) * BigInt(feeBps) + 9999n) / 10000n : 0n
  check(BigInt(price) + fee <= COLLECTION_COMMAND_MAX && same(p.quote, { priceAtomic: price, feeBps, feeAtomic: String(fee),
    buyerTotalAtomic: String(BigInt(price) + fee), sellerReceivesAtomic: price }), 'QUOTE_MISMATCH')
  check(used.size === p.objects.length && p.absentIds.length === (listing ? 1 : 2), 'UNEXPECTED_OBJECT')
  return freeze(p)
}
