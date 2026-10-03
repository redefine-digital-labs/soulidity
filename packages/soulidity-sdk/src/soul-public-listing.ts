import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, KIOSK_ITEM_FIELD_BYTES } from './kiosk-item-custody'
import { SoulPublicBcs, SoulStatePublicBcs, SOUL_PUBLIC_MAX_SOUL_BYTES } from './soul-public-read'
import { CollectionFloorFieldBcs, CollectionFloorKeyBcs } from './collection-floor-read'
import { normalizeCollectionFloorAtomic } from './collection-floor-policy'

export const SOUL_PUBLIC_USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
export interface SoulPublicListingDeployment {
  originalPackageId: string; chainIdentifier: string; marketConfigId: string; paymentCoinType: string
  native?: { outputOriginalPackageId: string; protocolConfigId: string; soulRegistryId: string }
}
export interface SoulPublicListingClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'batchGetObjects' | 'getObject'>
}
export interface SoulPublicListingSnapshot {
  status: 'HELD' | 'LISTED'; soulId: string; stateId: string; creator: string; currentOwner: string; kioskId: string
  stateVersion: string; stateDigest: string; listingId: string | null; price: string | null
  /** Verified Native rights rate, including zero; null for ordinary Souls. */
  sourceRoyaltyBps: number | null
  currency: { coinType: string; symbol: 'USDC'; decimals: 6 }
  market: { primaryEnabled: boolean; secondaryEnabled: boolean; platformFeeBps: number; nativeFeePolicyMatches: boolean | null }
  quote: null | { model: 'BASE_PLUS_FEES' | 'GROSS_INCLUSIVE'; platformFee: string; creatorRoyalty: string;
    collectionRoyalty: string; makerSourceRoyalty: string; totalPayment: string }
  collection: null | { id: string; name: string; description: string; imageUrl: string; rightId: string;
    creator: string; currentHolder: string; holderKioskId: string; maxSupply: string | null; currentSupply: string;
    extraRoyaltyBps: number; rightTradeable: boolean;
    floor: { status: 'VERIFIED'; floorPriceAtomic: string | null; belowFloor: boolean | null } }
  notPurchaseAuthorization: true
}
const A = bcs.Address, U = bcs.u64(), S = bcs.string(), V = bcs.vector(bcs.u8()), B = bcs.bool()
const Cap = bcs.struct('PurchaseCap', { id: A, kiosk_id: A, item_id: A, min_price: U })
export const SoulPublicListingBcs = bcs.struct('SoulListing', { id: A, version: U, soul_id: A, state_id: A,
  seller: A, seller_kiosk_id: A, price: U, creator: A, creator_royalty_bps: bcs.u16(), collection_id: bcs.option(A),
  purchase_cap: bcs.option(Cap), is_active: B })
export const SoulPublicMarketConfigBcs = bcs.struct('MarketConfigV2', { id: A, version: U, legacy_config_id: A,
  fee_recipient: A, platform_fee_bps: bcs.u16(), primary_enabled: B, secondary_enabled: B })
export const SoulPublicKioskBcs = bcs.struct('Kiosk', { id: A, profits: U, owner: A, item_count: bcs.u32(), allow_extensions: B })
export const SoulPublicCollectionBcs = bcs.struct('SoulCollection', { id: A, version: U, creator: A,
  extra_royalty_bps: bcs.u16(), tradeable: B, current_holder: A, current_holder_kiosk_id: A, right_id: A,
  max_supply: bcs.option(U), current_supply: U })
export const SoulPublicCollectionRightBcs = bcs.struct('SoulCollectionRight', { id: A, version: U,
  collection_id: A, creator: A, name: S, description: S, image_url: S })
const RightsFields = { origin: bcs.u8(), creator: A, creator_confirmed: B, evidence_certified: B,
  certification_catalog_id: bcs.option(A), certification_binding_commitment: bcs.option(V), evidence_locator: S,
  evidence_blob_id: S, evidence_sha256: V, terms_commitment: V, soul_creator_royalty_bps: bcs.u16(),
  maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16() }
const Rights = bcs.struct('RightsSnapshotV8', { ...RightsFields, commitment: V })
const RightsInput = bcs.struct('RightsCommitmentInputV8', { domain: V, version: U, ...RightsFields })
export const SoulPublicNativeBindingBcs = bcs.struct('NativeSoulBindingV8', { id: A, version: U,
  protocol_config_id: A, soul_registry_id: A, soul_id: A, soul_state_id: A, root_id: A, maker_version: U,
  root_content_commitment: V, maker_creator: A, maker_treasury_id: A, original_holder: A, output_id: A, receipt_id: A,
  output_key: S, output_policy_commitment: V, recipe_commitment: V, render_commitment: V, output_commitment: V,
  receipt_commitment: V, rights: Rights, authorization_commitment: V })
const Pointer = bcs.struct('Field', { id: A, name: bcs.u8(), value: A })
const MAX = 18446744073709551615n, ZERO = `0x${'0'.repeat(64)}`
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_PUBLIC_LISTING_${code}`) }
function id(value: unknown): asserts value is string { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value !== ZERO, 'INVALID_ID') }
function exact(value: unknown, keys: string[]) { check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === keys.sort().join(), 'INVALID_FIELDS') }
function hash(value: number[]) { check(value.length === 32 && value.some(x => x !== 0), 'INVALID_HASH') }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
function decode<T extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(schema: T, bytes: Uint8Array): ReturnType<T['parse']> {
  const value = schema.parse(bytes)
  check(toBase64(schema.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}

/** A current raw-object price observation, never purchase authorization. Discovery
 * supplies only a hint. Paused gates do not erase a live listing's factual price.
 * Sequential rereads detect drift; they are not a global checkpoint/atomic read. */
export async function readSoulPublicListing(params: { client: SoulPublicListingClient; deployment: SoulPublicListingDeployment;
  stateId: string; listingId: string | null; expectedState?: { version: string; digest: string }; signal?: AbortSignal
}): Promise<SoulPublicListingSnapshot> {
  const { deployment: d, stateId, listingId, expectedState } = structuredClone({ deployment: params.deployment,
    stateId: params.stateId, listingId: params.listingId, expectedState: params.expectedState })
  exact(d, ['originalPackageId', 'chainIdentifier', 'marketConfigId', 'paymentCoinType', ...(d.native === undefined ? [] : ['native'])])
  id(d.originalPackageId); id(d.marketConfigId); id(stateId); if (listingId !== null) id(listingId)
  check(typeof d.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(d.chainIdentifier) && d.paymentCoinType === SOUL_PUBLIC_USDC_TYPE, 'DEPLOYMENT_INVALID')
  if (Object.hasOwn(d, 'native')) { exact(d.native, ['outputOriginalPackageId', 'protocolConfigId', 'soulRegistryId']); Object.values(d.native!).forEach(id) }
  if (expectedState !== undefined) { exact(expectedState, ['version', 'digest']); check(typeof expectedState.version === 'string' && /^[1-9][0-9]*$/.test(expectedState.version)
    && BigInt(expectedState.version) <= MAX && fromBase58(expectedState.digest).length === 32
    && toBase58(fromBase58(expectedState.digest)) === expectedState.digest, 'EXPECTED_STATE_INVALID') }
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
  const client = params.client, pkg = d.originalPackageId
  const chain = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier
  const genesis = fromBase58(chain)
  check(genesis.length === 32 && toBase58(genesis) === chain && toHex(genesis.subarray(0, 4)) === d.chainIdentifier, 'WRONG_CHAIN')
  type Raw = NonNullable<Awaited<ReturnType<SoulPublicListingClient['ledgerService']['getObject']>>['response']['object']>
  const reads = new Map<string, { type: string; kind: number; owner?: string; maximum: number; raw: Raw | null }>()
  async function read(objectId: string, type: string, kind: number, owner?: string, optional = false, maximum = 16384): Promise<Uint8Array | null> {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result.oneofKind === 'object' || optional && result.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const raw = result.oneofKind === 'object' ? structuredClone(result.object) : null
    if (raw) {
      check(raw.objectId === objectId && raw.objectType === normalizeStructTag(type) && typeof raw.version === 'bigint'
        && raw.version > 0n && raw.version <= MAX, 'OBJECT_IDENTITY_MISMATCH')
      check(typeof raw.digest === 'string' && fromBase58(raw.digest).length === 32 && toBase58(fromBase58(raw.digest)) === raw.digest, 'DIGEST_INVALID')
      check(raw.owner?.kind === kind && (owner === undefined || raw.owner.address === owner)
        && (kind !== 3 || typeof raw.owner.version === 'bigint' && raw.owner.version > 0n && raw.owner.version <= raw.version), 'CUSTODY_MISMATCH')
      check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0 && raw.contents.value.length <= maximum, 'BCS_BUDGET')
    }
    const prior = reads.get(objectId)
    if (prior) check(prior.type === type && prior.kind === kind && prior.owner === owner &&
      (prior.raw === null ? raw === null : raw !== null && prior.raw.version === raw.version && prior.raw.digest === raw.digest
        && prior.raw.owner?.version === raw.owner?.version && prior.raw.owner?.address === raw.owner?.address
        && toBase64(prior.raw.contents!.value!) === toBase64(raw.contents!.value!)), 'CHANGED_RETRY')
    else reads.set(objectId, { type, kind, owner, maximum, raw })
    return raw ? raw.contents!.value! : null
  }
  const state = decode(SoulStatePublicBcs, (await read(stateId, `${pkg}::soul::SoulState`, 3))!)
  check(state.id === stateId && state.version === '1', 'STATE_MISMATCH')
  for (const value of [state.soul_id, state.creator, state.current_owner, state.current_kiosk_id]) id(value)
  check(state.creator_royalty_bps <= 10000, 'ROYALTY_INVALID')
  const stateRaw = reads.get(stateId)!.raw!
  if (expectedState) check(String(stateRaw.version) === expectedState.version && stateRaw.digest === expectedState.digest, 'STALE_METADATA')
  async function itemOwner(kioskId: string, itemId: string) {
    const fieldId = deriveKioskItemFieldId(kioskId, itemId)
    return assertKioskItemField((await read(fieldId, KIOSK_ITEM_FIELD_TYPE, 2, kioskId, false, KIOSK_ITEM_FIELD_BYTES))!, kioskId, itemId)
  }
  const soul = decode(SoulPublicBcs, (await read(state.soul_id, `${pkg}::soul::Soul`, 2,
    await itemOwner(state.current_kiosk_id, state.soul_id), false, SOUL_PUBLIC_MAX_SOUL_BYTES))!)
  check(soul.id === state.soul_id && soul.version === '1' && soul.creator === state.creator && [0, 1, 2, 3].includes(soul.provenance_kind), 'SOUL_MISMATCH')
  async function kiosk(objectId: string, owner: string) {
    const value = decode(SoulPublicKioskBcs, (await read(objectId, '0x2::kiosk::Kiosk', 3))!)
    check(value.id === objectId && value.owner === owner && value.item_count > 0, 'KIOSK_MISMATCH')
  }
  await kiosk(state.current_kiosk_id, state.current_owner)
  const config = decode(SoulPublicMarketConfigBcs, (await read(d.marketConfigId, `${pkg}::market::MarketConfigV2`, 3))!)
  check(config.id === d.marketConfigId && config.version === '2' && config.legacy_config_id === ZERO && config.platform_fee_bps <= 10000, 'CONFIG_MISMATCH')
  id(config.fee_recipient)
  const pointerId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const pointerBytes = await read(pointerId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId, true)
  const native = soul.provenance_kind === 3
  let sourceRate = 0
  if (native) {
    check(d.native && pointerBytes, 'NATIVE_PROOF_REQUIRED')
    // add_soul permits an unlisted Native Soul in its creator's Collection.
    // The no-Collection restriction belongs to native listing/quote/buy only.
    check(!state.is_listed || state.collection_id === null, 'NATIVE_LISTED_COLLECTION')
    const pointer = decode(Pointer, pointerBytes)
    check(pointer.id === pointerId && pointer.name === 9, 'POINTER_MISMATCH'); id(pointer.value)
    const binding = decode(SoulPublicNativeBindingBcs, (await read(pointer.value, `${d.native.outputOriginalPackageId}::output_v8::NativeSoulBindingV8`, 4))!)
    check(binding.id === pointer.value && binding.version === '8' && binding.protocol_config_id === d.native.protocolConfigId
      && binding.soul_registry_id === d.native.soulRegistryId && binding.soul_id === soul.id && binding.soul_state_id === stateId
      && binding.original_holder === state.creator && binding.rights.soul_creator_royalty_bps === state.creator_royalty_bps
      && binding.rights.creator === binding.maker_creator && BigInt(binding.maker_version) > 0n, 'NATIVE_BINDING_MISMATCH')
    for (const value of [binding.root_id, binding.maker_creator, binding.maker_treasury_id, binding.output_id, binding.receipt_id]) id(value)
    for (const value of [binding.root_content_commitment, binding.output_policy_commitment, binding.recipe_commitment,
      binding.render_commitment, binding.output_commitment, binding.receipt_commitment, binding.authorization_commitment]) hash(value)
    const r = binding.rights
    check([0, 1].includes(r.origin) && r.creator_confirmed && r.evidence_certified === (r.origin === 1), 'RIGHTS_INVALID')
    for (const rate of [r.soul_creator_royalty_bps, r.maker_source_royalty_bps, r.maker_resale_royalty_bps]) check(rate <= 1000 && rate % 50 === 0, 'RIGHTS_RATE_INVALID')
    check(r.soul_creator_royalty_bps + r.maker_source_royalty_bps <= 1000, 'RIGHTS_RATE_INVALID')
    if (r.origin === 0) check(r.certification_catalog_id === null && r.certification_binding_commitment === null
      && r.evidence_locator === '' && r.evidence_blob_id === '' && r.evidence_sha256.length === 0 && r.terms_commitment.length === 0, 'RIGHTS_INVALID')
    else {
      id(r.certification_catalog_id); check(r.certification_binding_commitment !== null, 'RIGHTS_INVALID'); hash(r.certification_binding_commitment)
      hash(r.evidence_sha256); hash(r.terms_commitment)
      check(new TextEncoder().encode(r.evidence_locator).length > 0 && new TextEncoder().encode(r.evidence_locator).length <= 1024
        && new TextEncoder().encode(r.evidence_blob_id).length > 0 && new TextEncoder().encode(r.evidence_blob_id).length <= 512, 'RIGHTS_INVALID')
    }
    hash(r.commitment)
    const bytes = RightsInput.serialize({ ...r, domain: [...new TextEncoder().encode('animacraft-v8/rights-snapshot')], version: '8' }).toBytes()
    const computed = await profileReadStep(signal, () => crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
    check(toBase64(new Uint8Array(computed)) === toBase64(new Uint8Array(r.commitment)), 'RIGHTS_COMMITMENT_MISMATCH')
    sourceRate = r.maker_source_royalty_bps
  } else check(pointerBytes === null, 'NATIVE_GENERIC_BYPASS')

  let collection: SoulPublicListingSnapshot['collection'] = null, collectionRate = 0
  if (state.collection_id !== null) {
    id(state.collection_id)
    const c = decode(SoulPublicCollectionBcs, (await read(state.collection_id, `${pkg}::collection::SoulCollection`, 3))!)
    check(c.id === state.collection_id && c.version === '1' && c.creator === state.creator && c.extra_royalty_bps <= 10000 && BigInt(c.current_supply) > 0n
      && (c.max_supply === null || BigInt(c.max_supply) > 0n && BigInt(c.current_supply) <= BigInt(c.max_supply)), 'COLLECTION_MISMATCH')
    for (const value of [c.creator, c.current_holder, c.current_holder_kiosk_id, c.right_id]) id(value)
    const right = decode(SoulPublicCollectionRightBcs, (await read(c.right_id, `${pkg}::collection::SoulCollectionRight`, 2,
      await itemOwner(c.current_holder_kiosk_id, c.right_id), false, SOUL_PUBLIC_MAX_SOUL_BYTES))!)
    check(right.id === c.right_id && right.version === '1' && right.collection_id === c.id && right.creator === c.creator, 'COLLECTION_RIGHT_MISMATCH')
    await kiosk(c.current_holder_kiosk_id, c.current_holder)
    const floorKeyType = `${pkg}::collection::FloorPolicyKeyV1`
    const floorId = deriveDynamicFieldID(c.id, floorKeyType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
    const floor = decode(CollectionFloorFieldBcs, (await read(floorId,
      `0x2::dynamic_field::Field<${floorKeyType},0x1::option::Option<u128>>`, 2, c.id))!)
    check(floor.id === floorId && floor.name.version === 1, 'FLOOR_MISMATCH')
    const floorAmount = normalizeCollectionFloorAtomic(floor.value)
    collectionRate = c.extra_royalty_bps
    collection = { id: c.id, name: right.name, description: right.description, imageUrl: right.image_url, rightId: right.id,
      creator: c.creator, currentHolder: c.current_holder, holderKioskId: c.current_holder_kiosk_id,
      maxSupply: c.max_supply, currentSupply: c.current_supply, extraRoyaltyBps: collectionRate,
      rightTradeable: c.tradeable, floor: { status: 'VERIFIED', floorPriceAtomic: floorAmount?.toString() ?? null, belowFloor: null } }
  }
  let price: string | null = null, quote: SoulPublicListingSnapshot['quote'] = null
  if (state.is_listed) {
    check(listingId !== null, 'INCOMPLETE_LISTING_HINT')
    const equipmentId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([10]))
    check(await read(equipmentId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId, true) === null, 'EQUIPMENT_LOCKED')
    const l = decode(SoulPublicListingBcs, (await read(listingId, `${pkg}::market::SoulListing`, 3))!)
    check(l.id === listingId && l.version === (native ? '8' : '2') && l.is_active && l.state_id === stateId && l.soul_id === soul.id
      && l.seller === state.current_owner && l.seller_kiosk_id === state.current_kiosk_id && l.creator === state.creator
      && l.creator_royalty_bps === state.creator_royalty_bps && l.collection_id === state.collection_id && BigInt(l.price) > 0n, 'LISTING_MISMATCH')
    const cap = l.purchase_cap
    check(cap && cap.kiosk_id === state.current_kiosk_id && cap.item_id === soul.id && cap.min_price === '0', 'PURCHASE_CAP_MISMATCH'); id(cap.id)
    check(![l.id, stateId, soul.id, state.current_kiosk_id, d.marketConfigId].includes(cap.id), 'CAP_ALIAS')
    const p = BigInt(l.price), fee = (rate: number) => native ? p * BigInt(rate) / 10000n : (p * BigInt(rate) + 9999n) / 10000n
    check(native || config.platform_fee_bps + state.creator_royalty_bps + collectionRate <= 10000, 'COMBINED_FEES_INVALID')
    const platform = fee(native ? 250 : config.platform_fee_bps), creator = fee(state.creator_royalty_bps), extra = fee(collectionRate), source = fee(sourceRate)
    const total = native ? p : p + platform + creator + extra
    check(total <= MAX, 'QUOTE_OVERFLOW')
    price = l.price
    if (collection) collection.floor.belowFloor = collection.floor.floorPriceAtomic !== null && p < BigInt(collection.floor.floorPriceAtomic)
    quote = { model: native ? 'GROSS_INCLUSIVE' : 'BASE_PLUS_FEES', platformFee: String(platform), creatorRoyalty: String(creator),
      collectionRoyalty: String(extra), makerSourceRoyalty: String(source), totalPayment: String(total) }
  }
  // A stale hint is not evidence of a sale when the current State is unlisted.
  for (const [objectId, entry] of reads) await read(objectId, entry.type, entry.kind, entry.owner, entry.raw === null, entry.maximum)
  signal.throwIfAborted()
  return freeze({ status: state.is_listed ? 'LISTED' : 'HELD', soulId: soul.id, stateId, creator: state.creator,
    currentOwner: state.current_owner, kioskId: state.current_kiosk_id, stateVersion: String(stateRaw.version), stateDigest: stateRaw.digest!,
    listingId: state.is_listed ? listingId : null, price, quote, collection, sourceRoyaltyBps: native ? sourceRate : null,
    currency: { coinType: d.paymentCoinType, symbol: 'USDC', decimals: 6 },
    market: { primaryEnabled: config.primary_enabled, secondaryEnabled: config.secondary_enabled, platformFeeBps: config.platform_fee_bps,
      nativeFeePolicyMatches: native ? config.platform_fee_bps === 250 : null }, notPurchaseAuthorization: true })
}
