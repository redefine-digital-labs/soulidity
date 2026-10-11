import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  CollectionPublicListingBcs, CollectionPersonalKioskCapBcs, CollectionKioskRegistrationFieldBcs,
  CollectionKioskRegistryBcs, CollectionKioskListingFieldBcs, deriveKioskItemFieldId, assertKioskItemField } from '@soulidity/sdk'
import { id, digest, uint, exact, same, freeze, decode, collectionCommandRaw, collectionCommandTypes,
  collectionCommandRegistration, collectionCommandMarker, parseCollectionCommandTarget,
  COLLECTION_COMMAND_MAX, type CollectionCommandTarget, type CollectionCommandObject, type CollectionCommandRecord,
  type CollectionCommandPlan } from './collection-command-plan'

export { id, digest, uint, exact, same, freeze, decode, collectionCommandRaw, collectionCommandTypes,
  collectionCommandRegistration, collectionCommandMarker, COLLECTION_COMMAND_MAX }
export function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COLLECTION_BUY_${code}`) }
export interface CollectionBuyTarget extends CollectionCommandTarget { collectionTransferPolicyId: string; kioskPackageId: string }
export interface CollectionBuyPlan {
  schema: 'soulidity.collection-buy-plan.v1'; target: CollectionBuyTarget; request: { collectionId: string; listingId: string }
  author: string; rightId: string; sellerAddress: string; sellerKioskId: string
  buyerKiosk: { kind: 'EXISTING' | 'NEW'; kioskId: string | null; capId: string | null }
  paymentCoinIds: string[]; objects: CollectionCommandObject[]; absentIds: string[]
  expected: { collectionBcs: string; rightBcs: string; listingBcs: string; marketBcs: string; policyBcs: string }
  quote: CollectionCommandPlan['quote']
}
export interface CollectionBuyRecord { schema: 'soulidity.collection-buy.v1'; plan: CollectionBuyPlan; packet: CollectionCommandRecord['packet'] }
export interface CollectionBuyQuery { status: 'MISSING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'; checkpoint?: string
  receipt?: { collectionId: string; rightId: string; listingId: string; sellerAddress: string; buyerAddress: string;
    buyerKioskId: string; buyerKioskCapId: string; priceAtomic: string; platformFeeAtomic: string; totalPaymentAtomic: string } }
const A = bcs.Address, Empty = bcs.struct('Empty', { dummy_field: bcs.bool() })
export const CollectionBuyCoinBcs = bcs.struct('Coin', { id: A, balance: bcs.u64() })
export const CollectionBuyPolicyBcs = bcs.struct('TransferPolicy', { id: A, balance: bcs.u64(),
  rules: bcs.struct('VecSet', { contents: bcs.vector(bcs.struct('TypeName', { name: bcs.string() })) }) })
export const CollectionBuyOwnerMarkerBcs = bcs.struct('Field', { id: A, name: Empty, value: A })
export const CollectionBuyLockBcs = bcs.struct('Field', { id: A, name: bcs.struct('Lock', { id: A }), value: bcs.bool() })
export const CollectionBuyRuleBoolBcs = bcs.struct('Field', { id: A, name: Empty, value: bcs.bool() })
export const CollectionBuyRuleEmptyBcs = bcs.struct('Field', { id: A, name: Empty, value: Empty })
export function parseCollectionBuyTarget(input: unknown): CollectionBuyTarget {
  const d = structuredClone(input) as CollectionBuyTarget
  exact(d, ['chainIdentifier', 'originalPackageId', 'callablePackageId', 'callableDigest', 'marketConfigId', 'kioskRegistryId',
    'personalKioskTypePackageId', 'paymentCoinType', 'collectionTransferPolicyId', 'kioskPackageId'])
  const { collectionTransferPolicyId, kioskPackageId, ...base } = d
  parseCollectionCommandTarget(base); id(collectionTransferPolicyId); id(kioskPackageId); return freeze(d)
}
export function collectionBuyTypes(d: CollectionBuyTarget) {
  const t = collectionCommandTypes(d), k = d.personalKioskTypePackageId
  const rules = [`${k}::kiosk_lock_rule::Rule`, `${k}::personal_kiosk_rule::Rule`, `${k}::witness_rule::Rule<${d.originalPackageId}::market::CollectionMarketProof>`]
  const ruleKeys = rules.map(rule => normalizeStructTag(`0x2::transfer_policy::RuleKey<${rule}>`))
  return { ...t, policy: normalizeStructTag(`0x2::transfer_policy::TransferPolicy<${t.right}>`), rules, ruleKeys,
    ruleFields: ruleKeys.map((key, index) => normalizeStructTag(`0x2::dynamic_field::Field<${key},${index === 0 ? `${k}::kiosk_lock_rule::Config` : 'bool'}>`)),
    ownerKey: `${k}::personal_kiosk::OwnerMarker`, ownerMarker: normalizeStructTag(`0x2::dynamic_field::Field<${k}::personal_kiosk::OwnerMarker,address>`),
    lock: normalizeStructTag('0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>'), coin: normalizeStructTag(`0x2::coin::Coin<${d.paymentCoinType}>`) }
}
export const collectionBuyOwnerMarker = (d: CollectionBuyTarget, kioskId: string) => deriveDynamicFieldID(kioskId, collectionBuyTypes(d).ownerKey, new Uint8Array([0]))
export const collectionBuyLock = (kioskId: string, rightId: string) => deriveDynamicFieldID(kioskId, '0x2::kiosk::Lock', A.serialize(rightId).toBytes())
export const collectionBuyRuleIds = (d: CollectionBuyTarget) => collectionBuyTypes(d).ruleKeys.map(key => deriveDynamicFieldID(d.collectionTransferPolicyId, key, new Uint8Array([0])))
export function collectionBuyContents(row: CollectionCommandObject) { const move = collectionCommandRaw(row).data.Move; check(move, 'MOVE_REQUIRED'); return move.contents }
export function collectionBuyRawType(raw: ReturnType<typeof collectionCommandRaw>) {
  const t = raw.data.Move?.type
  return t?.Other ? normalizeStructTag(TypeTagSerializer.tagToString({ struct: t.Other })) : t?.Coin ? normalizeStructTag(`0x2::coin::Coin<${t.Coin}>`) : t?.$kind === 'GasCoin' ? normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>') : null
}
/** Stored/imported plans attest the complete raw read set again; no summary,
 * SQL candidate, mutable projection or fictitious ownership epoch is trusted. */
export function parseCollectionBuyPlan(input: unknown): CollectionBuyPlan {
  const p = structuredClone(input) as CollectionBuyPlan
  exact(p, ['schema', 'target', 'request', 'author', 'rightId', 'sellerAddress', 'sellerKioskId', 'buyerKiosk', 'paymentCoinIds', 'objects', 'absentIds', 'expected', 'quote'])
  check(p.schema === 'soulidity.collection-buy-plan.v1', 'PLAN_SCHEMA'); p.target = parseCollectionBuyTarget(p.target)
  exact(p.request, ['collectionId', 'listingId']); exact(p.buyerKiosk, ['kind', 'kioskId', 'capId'])
  ;[p.author, p.request.collectionId, p.request.listingId, p.rightId, p.sellerAddress, p.sellerKioskId].forEach(value => id(value))
  check(p.author !== p.sellerAddress && ['EXISTING', 'NEW'].includes(p.buyerKiosk.kind), 'BUYER_INVALID')
  exact(p.expected, ['collectionBcs', 'rightBcs', 'listingBcs', 'marketBcs', 'policyBcs'])
  exact(p.quote, ['priceAtomic', 'feeBps', 'feeAtomic', 'buyerTotalAtomic', 'sellerReceivesAtomic'])
  check(Array.isArray(p.objects) && p.objects.length <= 60 && Array.isArray(p.absentIds) && p.absentIds.length <= 5
    && Array.isArray(p.paymentCoinIds) && p.paymentCoinIds.length > 0 && p.paymentCoinIds.length <= 32, 'READSET_BUDGET')
  const ids = new Set<string>(), used = new Set<string>(), objects = new Map(p.objects.map(row => {
    check(!ids.has(row.objectId), 'DUPLICATE_OBJECT'); ids.add(row.objectId); return [row.objectId, collectionCommandRaw(row)] as const
  }))
  for (const value of p.absentIds) { id(value); check(!ids.has(value), 'ABSENCE_ALIAS'); ids.add(value) }
  const d = p.target, t = collectionBuyTypes(d), absences = new Set<string>()
  function move(objectId: string, type: string, kind: 'Shared' | 'ObjectOwner' | 'AddressOwner', owner?: string, expected?: string) {
    const raw = objects.get(objectId), value = raw?.data.Move
    check(raw && value && collectionBuyRawType(raw) === normalizeStructTag(type) && raw.owner.$kind === kind
      && (owner === undefined || raw.owner.ObjectOwner === owner || raw.owner.AddressOwner === owner), 'RAW_TYPE_OWNER')
    if (expected !== undefined) check(toBase64(value.contents) === expected, 'EXPECTED_BYTES')
    used.add(objectId); return value.contents
  }
  function pkg(objectId: string, origin: string, entries: string[][]) {
    const raw = objects.get(objectId), value = raw?.data.Package; check(value && raw.owner.$kind === 'Immutable', 'PACKAGE_REQUIRED')
    for (const [module, name] of entries) { const rows = value.typeOriginTable.filter(row => row.moduleName === module && row.datatypeName === name)
      check(rows.length === 1 && rows[0].package === origin && value.moduleMap.has(module), 'TYPE_ORIGIN') }
    used.add(objectId); return value
  }
  check(p.objects.find(row => row.objectId === d.callablePackageId)?.digest === d.callableDigest, 'CALLABLE_DIGEST')
  const native = pkg(d.callablePackageId, d.originalPackageId, [['collection', 'SoulCollection'], ['collection', 'SoulCollectionRight'], ...['CollectionListing', 'MarketConfigV2', 'KioskRegistry', 'PersonalKioskRegistration', 'PersonalKioskOwnerKey', 'CollectionPurchased', 'PersonalKioskRegistrationUpdated', 'CollectionMarketProof'].map(name => ['market', name])])
  const kioskPackage = pkg(d.kioskPackageId, d.personalKioskTypePackageId, [['personal_kiosk', 'PersonalKioskCap'], ['personal_kiosk', 'OwnerMarker'], ['personal_kiosk', 'NewPersonalKiosk'], ['kiosk_lock_rule', 'Rule'], ['kiosk_lock_rule', 'Config'], ['personal_kiosk_rule', 'Rule'], ['witness_rule', 'Rule']])
  const edge = native.linkageTable.get(d.personalKioskTypePackageId)
  check(edge?.upgradedId === d.kioskPackageId && String(edge.upgradedVersion) === kioskPackage.version, 'KIOSK_LINKAGE')
  const c = decode(SoulPublicCollectionBcs, move(p.request.collectionId, t.collection, 'Shared', undefined, p.expected.collectionBcs))
  check(c.version === '1' && c.tradeable && c.current_holder === p.sellerAddress && c.current_holder_kiosk_id === p.sellerKioskId && c.right_id === p.rightId
    && c.extra_royalty_bps <= 10000 && (c.max_supply === null || BigInt(c.max_supply) > 0n && BigInt(c.current_supply) <= BigInt(c.max_supply)), 'COLLECTION_AUTHORITY'); id(c.creator)
  const item = deriveKioskItemFieldId(p.sellerKioskId, p.rightId)
  assertKioskItemField(move(item, t.item, 'ObjectOwner', p.sellerKioskId), p.sellerKioskId, p.rightId)
  const right = decode(SoulPublicCollectionRightBcs, move(p.rightId, t.right, 'ObjectOwner', item, p.expected.rightBcs))
  check(right.version === '1' && right.collection_id === c.id && right.creator === c.creator, 'RIGHT_RELATION')
  function kiosk(kioskId: string, owner: string) {
    const k = decode(SoulPublicKioskBcs, move(kioskId, t.kiosk, 'Shared')); check(k.owner === owner, 'KIOSK_OWNER')
    const marker = decode(CollectionBuyOwnerMarkerBcs, move(collectionBuyOwnerMarker(d, kioskId), t.ownerMarker, 'ObjectOwner', kioskId))
    check(!marker.name.dummy_field && marker.value === owner, 'PERSONAL_KIOSK_OWNER'); return k
  }
  check(kiosk(p.sellerKioskId, p.sellerAddress).item_count > 0, 'SELLER_EMPTY')
  const sellerLock = collectionBuyLock(p.sellerKioskId, p.rightId)
  if (objects.has(sellerLock)) { const lock = decode(CollectionBuyLockBcs, move(sellerLock, t.lock, 'ObjectOwner', p.sellerKioskId)); check(lock.name.id === p.rightId && lock.value, 'SELLER_LOCK') }
  else absences.add(sellerLock)
  const listing = decode(CollectionPublicListingBcs, move(p.request.listingId, t.listing, 'Shared', undefined, p.expected.listingBcs))
  check(listing.version === '1' && listing.is_active && listing.collection_id === c.id && listing.right_id === p.rightId && listing.seller === p.sellerAddress
    && listing.seller_kiosk_id === p.sellerKioskId && listing.purchase_cap && listing.purchase_cap.kiosk_id === p.sellerKioskId
    && listing.purchase_cap.item_id === p.rightId && listing.purchase_cap.min_price === '0', 'ACTIVE_LISTING')
  uint(listing.price, true); id(listing.purchase_cap.id); check(!ids.has(listing.purchase_cap.id), 'PURCHASE_CAP_ALIAS')
  const reservation = decode(CollectionKioskListingFieldBcs, move(collectionCommandMarker(p.sellerKioskId, p.rightId, true), t.marker, 'ObjectOwner', p.sellerKioskId))
  check(reservation.name.id === p.rightId && reservation.name.is_exclusive && reservation.value === '0', 'EXCLUSIVE_RESERVATION')
  absences.add(collectionCommandMarker(p.sellerKioskId, p.rightId, false))
  check(decode(CollectionKioskRegistryBcs, move(d.kioskRegistryId, t.registry, 'Shared')).version === '1', 'REGISTRY_VERSION')
  const regId = collectionCommandRegistration(d, p.author)
  if (p.buyerKiosk.kind === 'EXISTING') {
    id(p.buyerKiosk.kioskId); id(p.buyerKiosk.capId); check(p.buyerKiosk.kioskId !== p.sellerKioskId, 'SAME_KIOSK')
    const reg = decode(CollectionKioskRegistrationFieldBcs, move(regId, t.registration, 'ObjectOwner', d.kioskRegistryId))
    check(reg.name.owner === p.author && reg.value.version === '1' && reg.value.kiosk_id === p.buyerKiosk.kioskId && reg.value.kiosk_cap_id === p.buyerKiosk.capId, 'BUYER_REGISTRATION')
    kiosk(p.buyerKiosk.kioskId!, p.author)
    const cap = decode(CollectionPersonalKioskCapBcs, move(p.buyerKiosk.capId!, t.cap, 'AddressOwner', p.author))
    check(cap.cap && cap.cap.for === p.buyerKiosk.kioskId && !ids.has(cap.cap.id) && cap.cap.id !== listing.purchase_cap.id, 'BUYER_CAP'); id(cap.cap.id)
    absences.add(deriveKioskItemFieldId(p.buyerKiosk.kioskId!, p.rightId)); absences.add(collectionBuyLock(p.buyerKiosk.kioskId!, p.rightId))
  } else { check(p.buyerKiosk.kioskId === null && p.buyerKiosk.capId === null, 'NEW_KIOSK_IDS'); absences.add(regId) }
  const market = decode(SoulPublicMarketConfigBcs, move(d.marketConfigId, t.market, 'Shared', undefined, p.expected.marketBcs))
  check(market.version === '2' && market.secondary_enabled && market.platform_fee_bps <= 10000 && /^0x0+$/.test(market.legacy_config_id), 'MARKET_UNAVAILABLE'); id(market.fee_recipient)
  const policy = decode(CollectionBuyPolicyBcs, move(d.collectionTransferPolicyId, t.policy, 'Shared', undefined, p.expected.policyBcs))
  const rules = policy.rules.contents.map(row => normalizeStructTag(row.name.startsWith('0x') ? row.name : `0x${row.name}`))
  check(rules.length === 3 && new Set(rules).size === 3 && t.rules.every(rule => rules.includes(normalizeStructTag(rule))), 'POLICY_RULES')
  collectionBuyRuleIds(d).forEach((ruleId, index) => {
    const bytes = move(ruleId, t.ruleFields[index], 'ObjectOwner', d.collectionTransferPolicyId)
    if (index === 0) { const rule = decode(CollectionBuyRuleEmptyBcs, bytes); check(!rule.name.dummy_field && !rule.value.dummy_field, 'POLICY_LOCK_CONFIG') }
    else { const rule = decode(CollectionBuyRuleBoolBcs, bytes); check(!rule.name.dummy_field && rule.value, 'POLICY_BOOL_CONFIG') }
  })
  const fee = (BigInt(listing.price) * BigInt(market.platform_fee_bps) + 9999n) / 10000n, total = BigInt(listing.price) + fee
  check(total <= COLLECTION_COMMAND_MAX && same(p.quote, { priceAtomic: listing.price, feeBps: market.platform_fee_bps, feeAtomic: String(fee), buyerTotalAtomic: String(total), sellerReceivesAtomic: listing.price }), 'QUOTE_MISMATCH')
  check(new Set(p.paymentCoinIds).size === p.paymentCoinIds.length, 'DUPLICATE_PAYMENT')
  let balance = 0n
  for (const coinId of p.paymentCoinIds) { id(coinId); balance += BigInt(decode(CollectionBuyCoinBcs, move(coinId, t.coin, 'AddressOwner', p.author)).balance) }
  check(balance >= total && balance <= COLLECTION_COMMAND_MAX, 'PAYMENT_BALANCE')
  check(used.size === p.objects.length && p.absentIds.length === absences.size && p.absentIds.every(value => absences.has(value)), 'UNEXPECTED_OBJECT')
  return freeze(p)
}
