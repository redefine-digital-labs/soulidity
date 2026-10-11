import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { readSoulPublicListing, SOUL_PUBLIC_USDC_TYPE, SoulPublicListingBcs, SoulPublicMarketConfigBcs,
  SoulPublicKioskBcs, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicNativeBindingBcs } from '../../packages/soulidity-sdk/src/soul-public-listing'
import { SoulPublicBcs, SoulStatePublicBcs } from '../../packages/soulidity-sdk/src/soul-public-read'
import { CollectionFloorFieldBcs, CollectionFloorKeyBcs } from '../../packages/soulidity-sdk/src/collection-floor-read'
import { NativeSoulBindingBcs } from '../../web/lib/animacraft/native-receive'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1)), hash = () => Array(32).fill(1)
const A = bcs.Address, V = bcs.vector(bcs.u8()), U = bcs.u64()
// Independent current Move RightsCommitmentInputV8 field order/domain; not the reader's codec.
const RightsInput = bcs.struct('RightsCommitmentInputV8', { domain: V, version: U, origin: bcs.u8(), creator: A,
  creator_confirmed: bcs.bool(), evidence_certified: bcs.bool(), certification_catalog_id: bcs.option(A),
  certification_binding_commitment: bcs.option(V), evidence_locator: bcs.string(), evidence_blob_id: bcs.string(),
  evidence_sha256: V, terms_commitment: V, soul_creator_royalty_bps: bcs.u16(), maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16() })
const Pointer = bcs.struct('Field', { id: A, name: bcs.u8(), value: A })
it('BCS layouts follow actual current Move fields rather than JSON projection names', () => {
  const fields = (file: string, name: string) => {
    const source = readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '')
    const body = source.match(new RegExp(`(?:public )?struct ${name}(?:<[^>]*>)?[^\\{]*\\{([^}]+)\\}`))?.[1]
    expect(body, name).toBeDefined()
    return [...body!.matchAll(/([a-z_]+)\s*:\s*([^,]+),/g)].map(m => `${m[1]}:${m[2].replace(/\s/g, '')}`)
  }
  expect(fields('move/soulidity/sources/market.move', 'SoulListing')).toEqual([
    'id:UID', 'version:u64', 'soul_id:ID', 'state_id:ID', 'seller:address', 'seller_kiosk_id:ID', 'price:u64',
    'creator:address', 'creator_royalty_bps:u16', 'collection_id:Option<ID>', 'purchase_cap:Option<kiosk::PurchaseCap<Soul>>', 'is_active:bool'])
  expect(fields('move/soulidity/sources/market.move', 'MarketConfigV2')).toEqual([
    'id:UID', 'version:u64', 'legacy_config_id:ID', 'fee_recipient:address', 'platform_fee_bps:u16', 'primary_enabled:bool', 'secondary_enabled:bool'])
  expect(fields('move/soulidity/sources/collection.move', 'SoulCollection')).toEqual([
    'id:UID', 'version:u64', 'creator:address', 'extra_royalty_bps:u16', 'tradeable:bool', 'current_holder:address',
    'current_holder_kiosk_id:ID', 'right_id:ID', 'max_supply:Option<u64>', 'current_supply:u64'])
})
async function fixture(native = false, withCollection = false) {
  const deployment = { originalPackageId: id(1), marketConfigId: id(12), chainIdentifier: '01010101', paymentCoinType: SOUL_PUBLIC_USDC_TYPE,
    native: { outputOriginalPackageId: id(30), protocolConfigId: id(31), soulRegistryId: id(32) } }
  const pkg = deployment.originalPackageId
  const state = { id: id(2), version: '1', soul_id: id(3), creator: id(4), creator_royalty_bps: 500,
    current_owner: id(5), current_kiosk_id: id(6), ownership_epoch: '2', grant_capacity: '3',
    active_grants: { id: id(7), size: '2' }, active_grant_ids: { id: id(8), size: '2' }, active_grant_count: '0',
    content_id: id(9), config_ext: { id: id(10), size: '1' }, collection_id: withCollection ? id(20) : null,
    access_list_id: id(11), is_listed: true }
  const soul = { id: id(3), version: '1', name: 'Example', description: 'Description', image_url: '',
    provenance_kind: native ? 3 : 1, origin_ref: null as string | null, creator: id(4) }
  const config = { id: id(12), version: '2', legacy_config_id: id(0), fee_recipient: id(13), platform_fee_bps: 250,
    primary_enabled: true, secondary_enabled: true }
  const kiosk = { id: id(6), profits: '0', owner: id(5), item_count: 1, allow_extensions: false }
  const listing = { id: id(14), version: native ? '8' : '2', soul_id: id(3), state_id: id(2), seller: id(5), seller_kiosk_id: id(6),
    price: '1000000', creator: id(4), creator_royalty_bps: 500, collection_id: state.collection_id,
    purchase_cap: { id: id(15), kiosk_id: id(6), item_id: id(3), min_price: '0' } as any, is_active: true }
  const collection = { id: id(20), version: '1', creator: id(4), extra_royalty_bps: 100, tradeable: false,
    current_holder: id(22), current_holder_kiosk_id: id(23), right_id: id(24), max_supply: '100' as string | null, current_supply: '1' }
  const right = { id: id(24), version: '1', collection_id: id(20), creator: id(4), name: 'Collection', description: '', image_url: '' }
  const rights = { origin: 0, creator: id(34), creator_confirmed: true, evidence_certified: false,
    certification_catalog_id: null as string | null, certification_binding_commitment: null as number[] | null,
    evidence_locator: '', evidence_blob_id: '', evidence_sha256: [] as number[], terms_commitment: [] as number[],
    soul_creator_royalty_bps: 500, maker_source_royalty_bps: 300, maker_resale_royalty_bps: 1000, commitment: hash() }
  const binding = { id: id(33), version: '8', protocol_config_id: id(31), soul_registry_id: id(32), soul_id: id(3), soul_state_id: id(2),
    root_id: id(35), maker_version: '1', root_content_commitment: hash(), maker_creator: id(34), maker_treasury_id: id(36),
    original_holder: id(4), output_id: id(37), receipt_id: id(38), output_key: 'primary', output_policy_commitment: hash(),
    recipe_commitment: hash(), render_commitment: hash(), output_commitment: hash(), receipt_commitment: hash(), rights, authorization_commitment: hash() }
  const rows = new Map<string, any>()
  const shared = { kind: 3, version: 1n }
  function put(objectId: string, type: string, bytes: Uint8Array, owner: any = shared) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 1n, digest, owner: structuredClone(owner), contents: { value: bytes } })
  }
  const putState = () => put(state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs.serialize(state).toBytes())
  const putSoul = () => {
    const fieldId = deriveKioskItemFieldId(state.current_kiosk_id, soul.id)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: soul.id } }, value: soul.id }).toBytes(),
      { kind: 2, address: state.current_kiosk_id })
    put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: fieldId })
  }
  const putListing = () => put(listing.id, `${pkg}::market::SoulListing`, SoulPublicListingBcs.serialize(listing).toBytes())
  const putConfig = () => put(config.id, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs.serialize(config).toBytes())
  const putKiosk = () => put(kiosk.id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize(kiosk).toBytes())
  const putCollection = () => put(collection.id, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs.serialize(collection).toBytes())
  const putRight = () => {
    const fieldId = deriveKioskItemFieldId(collection.current_holder_kiosk_id, right.id)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: right.id } }, value: right.id }).toBytes(),
      { kind: 2, address: collection.current_holder_kiosk_id })
    put(right.id, `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs.serialize(right).toBytes(), { kind: 2, address: fieldId })
  }
  const floorType = `${pkg}::collection::FloorPolicyKeyV1`, floorId = deriveDynamicFieldID(collection.id, floorType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
  function putFloor(value: string | null = '2000000') { put(floorId, `0x2::dynamic_field::Field<${floorType},0x1::option::Option<u128>>`,
    CollectionFloorFieldBcs.serialize({ id: floorId, name: { version: 1 }, value }).toBytes(), { kind: 2, address: collection.id }) }
  const df9 = deriveDynamicFieldID(state.id, 'u8', new Uint8Array([9])), df10 = deriveDynamicFieldID(state.id, 'u8', new Uint8Array([10]))
  function putPointer(key = 9, value = binding.id) { const field = key === 9 ? df9 : df10;
    put(field, '0x2::dynamic_field::Field<u8,0x2::object::ID>', Pointer.serialize({ id: field, name: key, value }).toBytes(), { kind: 2, address: state.id }) }
  const putBinding = () => put(binding.id, `${deployment.native.outputOriginalPackageId}::output_v8::NativeSoulBindingV8`, NativeSoulBindingBcs.serialize(binding).toBytes(), { kind: 4 })
  async function hashRights() { rights.commitment = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(RightsInput.serialize({ ...rights,
    domain: [...new TextEncoder().encode('animacraft-v8/rights-snapshot')], version: '8' }).toBytes())))]; putBinding() }
  putState(); putSoul(); putListing(); putConfig(); putKiosk()
  if (withCollection) { putCollection(); putRight(); putFloor(); put(id(23), '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ ...kiosk, id: id(23), owner: id(22) }).toBytes()) }
  if (native) { await hashRights(); putPointer() }
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((r: any) => ({ result: rows.has(r.objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(r.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const get = vi.spyOn(client.ledgerService, 'getObject').mockRejectedValue(new Error('No JSON projection or alternate reader'))
  const read = (overrides: Partial<Parameters<typeof readSoulPublicListing>[0]> = {}) => readSoulPublicListing({ client, deployment,
    stateId: state.id, listingId: listing.id, expectedState: { version: '1', digest }, ...overrides })
  return { deployment, state, soul, config, listing, kiosk, collection, right, rights, binding, rows, client, batch, get,
    putState, putSoul, putListing, putConfig, putKiosk, putCollection, putRight, putFloor, putPointer, putBinding, hashRights, df9, df10, floorId, read }
}

it.each(['Soul', 'CollectionRight'] as const)('rejects forged or changing %s Kiosk item custody', async kind => {
  for (const problem of ['missing', 'parent', 'type', 'uid', 'key', 'value', 'direct-kiosk', 'changed']) {
    const f = await fixture(false, true)
    const itemId = kind === 'Soul' ? f.soul.id : f.right.id
    const kioskId = kind === 'Soul' ? f.state.current_kiosk_id : f.collection.current_holder_kiosk_id
    const fieldId = deriveKioskItemFieldId(kioskId, itemId), raw = f.rows.get(fieldId)
    const field = KioskItemFieldBcs.parse(raw.contents.value)
    if (problem === 'missing') f.rows.delete(fieldId)
    if (problem === 'parent') raw.owner.address = id(99)
    if (problem === 'type') raw.objectType = '0x2::dynamic_field::Field<u8,0x2::object::ID>'
    if (problem === 'uid') field.id = id(99)
    if (problem === 'key') field.name.name.id = id(99)
    if (problem === 'value') field.value = id(99)
    if (['uid', 'key', 'value'].includes(problem)) raw.contents.value = KioskItemFieldBcs.serialize(field).toBytes()
    if (problem === 'direct-kiosk') f.rows.get(itemId).owner.address = kioskId
    if (problem === 'changed') {
      const original = f.batch.getMockImplementation()!; let reads = 0
      f.batch.mockImplementation(((args: any, opts: any) => {
        if (args.requests[0].objectId === fieldId && ++reads === 2) raw.version = 2n
        return original(args, opts)
      }) as any)
    }
    await expect(f.read(), `${kind}: ${problem}`).rejects.toThrow()
  }
})
it('ordinary V2 raw price uses ceil additive fees, not native gross price', async () => {
  const f = await fixture(); const result = await f.read()
  expect(result.quote).toEqual({ model: 'BASE_PLUS_FEES', platformFee: '25000', creatorRoyalty: '50000',
    collectionRoyalty: '0', makerSourceRoyalty: '0', totalPayment: '1075000' })
  expect(result.status).toBe('LISTED'); expect(result.notPurchaseAuthorization).toBe(true)
  expect(result.currency).toEqual({ coinType: SOUL_PUBLIC_USDC_TYPE, symbol: 'USDC', decimals: 6 })
  expect(Object.isFrozen(result.market)).toBe(true); expect(f.get).not.toHaveBeenCalled()
})
it('native V8 rights and DF9 use actual producer BCS and gross inclusive floor fees', async () => {
  const f = await fixture(true)
  expect(SoulPublicNativeBindingBcs.serialize(f.binding).toBytes()).toEqual(NativeSoulBindingBcs.serialize(f.binding).toBytes())
  expect((await f.read()).quote).toEqual({ model: 'GROSS_INCLUSIVE', platformFee: '25000', creatorRoyalty: '50000',
    collectionRoyalty: '0', makerSourceRoyalty: '30000', totalPayment: '1000000' })
})
it.each([false, true])('one atomic unit uses the actual ordinary/native rounding (%s)', async native => {
  const f = await fixture(native); f.listing.price = '1'; f.putListing()
  const q = (await f.read()).quote!; expect(q.totalPayment).toBe(native ? '1' : '3'); expect(q.platformFee).toBe(native ? '0' : '1')
})
it('native licensed rights use current certification fields and commitment', async () => {
  const f = await fixture(true); Object.assign(f.rights, { origin: 1, evidence_certified: true, certification_catalog_id: id(50),
    certification_binding_commitment: hash(), evidence_locator: 'walrus://evidence', evidence_blob_id: 'blob', evidence_sha256: hash(), terms_commitment: hash() })
  await f.hashRights(); expect((await f.read()).status).toBe('LISTED')
})
it.each([null, '0', '2000000', '99999999999999999999'])('collection floor preserves actual None/zero/20-digit values %s', async floor => {
  const f = await fixture(false, true); f.putFloor(floor); const result = await f.read()
  expect(result.collection?.floor).toEqual({ status: 'VERIFIED', floorPriceAtomic: floor, belowFloor: floor !== null && BigInt(floor) > 1000000n })
  expect(result.collection?.rightTradeable).toBe(false); expect(result.quote?.collectionRoyalty).toBe('10000')
  expect(result.price).toBe('1000000') // A display floor never rewrites chain price or a Move sale gate.
})
it.each([false, true])('paused market retains factual price, no buy authorization (%s)', async native => {
  const f = await fixture(native); f.config.primary_enabled = false; f.config.secondary_enabled = false; f.putConfig()
  const result = await f.read(); expect(result.price).toBe('1000000'); expect(result.market.secondaryEnabled).toBe(false)
})
it('native fee config mismatch is visible and does not erase the existing listing', async () => {
  const f = await fixture(true); f.config.platform_fee_bps = 251; f.putConfig()
  expect((await f.read()).market.nativeFeePolicyMatches).toBe(false)
})
it.each([false, true])('actual unlisted State overrides stale listing hint, equipment is allowed held (%s)', async native => {
  const f = await fixture(native); f.state.is_listed = false; f.putState(); f.putPointer(10)
  const result = await f.read(); expect(result.status).toBe('HELD'); expect(result.listingId).toBeNull(); expect(result.quote).toBeNull()
})
it('a held Native Soul may belong to its actual creator Collection', async () => {
  const f = await fixture(true, true); f.state.is_listed = false; f.putState()
  const result = await f.read()
  expect(result.status).toBe('HELD'); expect(result.price).toBeNull(); expect(result.quote).toBeNull()
  expect(result.collection).toMatchObject({ id: f.collection.id, creator: f.state.creator,
    floor: { status: 'VERIFIED', floorPriceAtomic: '2000000', belowFloor: null } })
  expect(result.notPurchaseAuthorization).toBe(true)
})
it('a listed Native Soul still cannot bypass the market no-Collection constraint', async () => {
  const f = await fixture(true, true)
  await expect(f.read()).rejects.toThrow('NATIVE_LISTED_COLLECTION')
})
it('listed State with no candidate hint is incomplete, never held/free', async () => {
  const f = await fixture(); await expect(f.read({ listingId: null })).rejects.toThrow('INCOMPLETE_LISTING_HINT')
})
it.each(['version', 'digest'])('metadata/listing read sets must share exact State %s', async key => {
  const f = await fixture(); await expect(f.read({ expectedState: { version: '1', digest, [key]: key === 'version' ? '2' : toBase58(new Uint8Array(32).fill(2)) } })).rejects.toThrow('STALE_METADATA')
})
it.each(['id', 'version', 'soul_id', 'state_id', 'seller', 'seller_kiosk_id', 'creator', 'creator_royalty_bps', 'collection_id', 'is_active', 'price'])('rejects listing %s drift', async key => {
  const f = await fixture(); const bad: any = { ...f.listing, [key]: key === 'version' ? '6' : key === 'creator_royalty_bps' ? 600 : key === 'is_active' ? false : key === 'price' ? '0' : id(80) }
  f.rows.get(f.listing.id).contents.value = SoulPublicListingBcs.serialize(bad).toBytes()
  await expect(f.read()).rejects.toThrow('LISTING_MISMATCH')
})
it.each(['missing', 'id', 'item_id', 'kiosk_id', 'min_price'])('rejects missing/wrong embedded PurchaseCap %s', async key => {
  const f = await fixture(); if (key === 'missing') f.listing.purchase_cap = null
  else f.listing.purchase_cap[key] = key === 'id' ? f.state.id : key === 'min_price' ? '1' : id(90)
  f.putListing(); await expect(f.read()).rejects.toThrow(/PURCHASE_CAP|CAP_ALIAS/)
})
it.each([false, true])('listed DF10 lock is rejected in both actual branches (%s)', async native => {
  const f = await fixture(native); f.putPointer(10); await expect(f.read()).rejects.toThrow('EQUIPMENT_LOCKED')
})
it('ordinary provenance with actual DF9 cannot take generic route', async () => {
  const f = await fixture(); f.putPointer(); await expect(f.read()).rejects.toThrow('NATIVE_GENERIC_BYPASS')
})
it.each(['pointer', 'target'])('native proof %s absence never falls through generic parser', async which => {
  const f = await fixture(true); if (which === 'pointer') f.rows.delete(f.df9); else delete (f.deployment as any).native
  await expect(f.read()).rejects.toThrow('NATIVE_PROOF_REQUIRED')
})
it.each(['protocol_config_id', 'soul_registry_id', 'soul_id', 'soul_state_id', 'original_holder', 'maker_creator', 'version'])('rejects native binding %s mismatch', async key => {
  const f = await fixture(true); (f.binding as any)[key] = key === 'version' ? '7' : id(98); f.putBinding()
  await expect(f.read()).rejects.toThrow('NATIVE_BINDING_MISMATCH')
})
it.each(['commitment', 'creator_confirmed', 'origin', 'maker_source_royalty_bps', 'maker_resale_royalty_bps', 'evidence_locator'])('rejects native rights %s corruption', async key => {
  const f = await fixture(true); (f.rights as any)[key] = key === 'commitment' ? Array(32).fill(2) : key === 'creator_confirmed' ? false
    : key === 'origin' ? 2 : key === 'evidence_locator' ? 'unexpected' : 1050
  f.putBinding(); await expect(f.read()).rejects.toThrow(/RIGHTS/)
})
it('rehashed rights cannot evade constructor policy', async () => {
  const f = await fixture(true); f.rights.maker_source_royalty_bps = 600; await f.hashRights()
  await expect(f.read()).rejects.toThrow('RIGHTS_RATE_INVALID')
})
it.each(['collection_id', 'creator', 'version'])('collection right %s must match actual parent', async key => {
  const f = await fixture(false, true); (f.right as any)[key] = key === 'version' ? '2' : id(90); f.putRight()
  await expect(f.read()).rejects.toThrow('COLLECTION_RIGHT_MISMATCH')
})
it('an internally consistent foreign-author Collection cannot claim this Soul', async () => {
  const f = await fixture(false, true); f.collection.creator = id(90); f.right.creator = id(90); f.putCollection(); f.putRight()
  await expect(f.read()).rejects.toThrow('COLLECTION_MISMATCH')
})
it.each(['version', 'id', 'current_supply', 'max_supply', 'extra_royalty_bps'])('rejects Collection %s relation/limits', async key => {
  const f = await fixture(false, true)
  const c = { ...f.collection, [key]: key === 'id' ? id(90) : key === 'version' ? '2' : key === 'extra_royalty_bps' ? 10001 : '0' }
  f.rows.get(f.collection.id).contents.value = SoulPublicCollectionBcs.serialize(c).toBytes()
  await expect(f.read()).rejects.toThrow('COLLECTION_MISMATCH')
})
it.each(['seller', 'collection-holder'])('actual %s Kiosk owner must match current custody', async which => {
  const f = await fixture(false, true), target = which === 'seller' ? f.kiosk.id : f.collection.current_holder_kiosk_id
  f.rows.get(target).contents.value = SoulPublicKioskBcs.serialize({ ...f.kiosk, id: target, owner: id(99) }).toBytes()
  await expect(f.read()).rejects.toThrow('KIOSK_MISMATCH')
})
it.each(['id', 'version', 'legacy_config_id', 'platform_fee_bps', 'fee_recipient'])('rejects config %s corruption', async key => {
  const f = await fixture(), value = { ...f.config, [key]: key === 'version' ? '1' : key === 'platform_fee_bps' ? 10001 : key === 'fee_recipient' ? id(0) : id(90) }
  f.rows.get(f.config.id).contents.value = SoulPublicMarketConfigBcs.serialize(value).toBytes()
  await expect(f.read()).rejects.toThrow()
})
it.each(['native-null', 'chain-number', 'extra-field', 'state-version-number'])('strict request deployment shape %s', async key => {
  const f = await fixture()
  if (key === 'native-null') (f.deployment as any).native = null
  if (key === 'chain-number') (f.deployment as any).chainIdentifier = 12345678
  if (key === 'extra-field') (f.deployment as any).fallbackPackageId = id(98)
  await expect(f.read(key === 'state-version-number' ? { expectedState: { version: 1 as any, digest } } : {})).rejects.toThrow()
})
it.each(['missing', 'oversized', 'wrongkey', 'owner'])('floor %s fails visible rather than becoming None or zero', async key => {
  const f = await fixture(false, true)
  if (key === 'missing') f.rows.delete(f.floorId)
  if (key === 'oversized') f.putFloor('100000000000000000000')
  if (key === 'wrongkey') f.rows.get(f.floorId).contents.value = CollectionFloorFieldBcs.serialize({ id: f.floorId, name: { version: 2 }, value: null }).toBytes()
  if (key === 'owner') f.rows.get(f.floorId).owner.address = id(90)
  await expect(f.read()).rejects.toThrow()
})
it.each(['owner', 'birth', 'type', 'version', 'digest', 'bytes'])('raw object %s cannot be projection authority', async key => {
  const f = await fixture(); const row = f.rows.get(f.listing.id)
  if (key === 'owner') row.owner = { kind: 1, address: f.state.current_owner }
  if (key === 'birth') row.owner.version = 2n
  if (key === 'type') row.objectType = `${id(99)}::market::SoulListing`
  if (key === 'version') row.version = '1'
  if (key === 'digest') row.digest = 'abc'
  if (key === 'bytes') row.contents.value = new Uint8Array([...row.contents.value, 0])
  await expect(f.read()).rejects.toThrow()
})
it.each(['listing', 'state', 'kiosk', 'config', 'floor', 'absence9', 'absence10'])('rereads %s and rejects same-ref byte/owner or absence drift', async key => {
  const f = await fixture(false, true), original = f.batch.getMockImplementation()!
  const target = ({ listing: f.listing.id, state: f.state.id, kiosk: f.kiosk.id, config: f.config.id,
    floor: f.floorId, absence9: f.df9, absence10: f.df10 })[key]!
  let count = 0
  f.batch.mockImplementation(((args: any) => {
    if (args.requests[0].objectId === target && ++count === 2) {
      if (key === 'absence9') f.putPointer(); else if (key === 'absence10') f.putPointer(10)
      else f.rows.get(target).contents.value = new Uint8Array([...f.rows.get(target).contents.value, 0])
    }
    return original(args)
  }) as any)
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})
it.each([13, 14, 7])('DF9 error code %s is not absence', async code => {
  const f = await fixture(); const original = f.batch.getMockImplementation()!
  f.batch.mockImplementation(((args: any) => args.requests[0].objectId === f.df9
    ? Promise.resolve({ response: { objects: [{ result: { oneofKind: 'error', error: { code } } }] } }) : original(args)) as any)
  await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it('transport error remains observable, no alternate endpoint', async () => {
  const f = await fixture(); const failure = new Error('grpc unavailable'); f.batch.mockRejectedValueOnce(failure)
  await expect(f.read()).rejects.toBe(failure); expect(f.get).not.toHaveBeenCalled()
})
it('oversized quote is not truncated to a u64 price', async () => {
  const f = await fixture(); f.listing.price = '18446744073709551615'; f.putListing()
  await expect(f.read()).rejects.toThrow('QUOTE_OVERFLOW')
})
it('native maximum u64 gross quote remains exact', async () => {
  const f = await fixture(true); f.listing.price = '18446744073709551615'; f.putListing()
  expect((await f.read()).quote?.totalPayment).toBe('18446744073709551615')
})
it('collection display fields come from the verified right and collection, with exact supply strings', async () => {
  const f = await fixture(false, true)
  Object.assign(f.right, { name: '系列 🌙', description: 'Line one\nLine two', image_url: 'walrus://collection-image' })
  f.collection.max_supply = '18446744073709551615'; f.collection.current_supply = '9007199254740993'
  f.putRight(); f.putCollection()
  const result = await f.read()
  expect(result.collection).toEqual({ id: f.collection.id, name: f.right.name, description: f.right.description,
    imageUrl: f.right.image_url, rightId: f.right.id, creator: f.collection.creator, currentHolder: f.collection.current_holder,
    holderKioskId: f.collection.current_holder_kiosk_id, maxSupply: '18446744073709551615', currentSupply: '9007199254740993',
    extraRoyaltyBps: 100, rightTradeable: false, floor: { status: 'VERIFIED', floorPriceAtomic: '2000000', belowFloor: true } })
  expect(result.stateVersion).toBe('1'); expect(result.stateDigest).toBe(digest)
  expect(Object.isFrozen(result.collection)).toBe(true)
  f.right.name = 'later mutation'; f.putRight(); expect(result.collection?.name).toBe('系列 🌙')
})
it('unlimited collection supply and absent collection are not fabricated numbers or display labels', async () => {
  const f = await fixture(false, true); f.collection.max_supply = null; f.putCollection()
  const result = await f.read()
  expect(result.collection).toMatchObject({ maxSupply: null, currentSupply: '1', description: '', imageUrl: '' })
  expect((await (await fixture()).read()).collection).toBeNull()
})
it.each([false, true])('native source rate remains available independent of listing price (%s)', async listed => {
  const f = await fixture(true); f.state.is_listed = listed; f.putState()
  expect((await f.read()).sourceRoyaltyBps).toBe(300)
  f.rights.maker_source_royalty_bps = 0; await f.hashRights()
  expect((await f.read()).sourceRoyaltyBps).toBe(0)
})
it.each([false, true])('ordinary Soul has no Native source-right rate (%s)', async listed => {
  const f = await fixture(); f.state.is_listed = listed; f.putState()
  expect((await f.read()).sourceRoyaltyBps).toBeNull()
})
it.each(['right', 'collection'])('returned collection display data rejects same-reference %s mutation during reread', async target => {
  const f = await fixture(false, true), original = f.batch.getMockImplementation()!
  const objectId = target === 'right' ? f.right.id : f.collection.id; let count = 0
  f.batch.mockImplementation(((args: any) => {
    if (args.requests[0].objectId === objectId && ++count === 2) {
      if (target === 'right') { f.right.image_url = 'changed'; f.putRight() }
      else { f.collection.current_supply = '2'; f.putCollection() }
    }
    return original(args)
  }) as any)
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})
it('configured and observed chain identity must agree', async () => {
  const f = await fixture(); f.deployment.chainIdentifier = '02020202'; await expect(f.read()).rejects.toThrow('WRONG_CHAIN')
})
it('arbitrary payment currency cannot relabel hard-coded Coin<USDC>', async () => {
  const f = await fixture(); f.deployment.paymentCoinType = '0x2::sui::SUI'; await expect(f.read()).rejects.toThrow('DEPLOYMENT_INVALID')
})
it('clones deployment and expected refs before any await', async () => {
  const f = await fixture(); const pending = f.read(); f.deployment.marketConfigId = id(99); f.deployment.native.protocolConfigId = id(98)
  expect((await pending).status).toBe('LISTED')
})
it('aborts a non-abort-compliant grpc request without progressing to later reads', async () => {
  const f = await fixture(); let resolve!: (value: any) => void
  f.batch.mockImplementationOnce(() => new Promise(r => { resolve = r }) as any)
  const controller = new AbortController(), promise = f.read({ signal: controller.signal })
  await vi.waitFor(() => expect(f.batch).toHaveBeenCalledTimes(1)); controller.abort(new Error('user cancelled'))
  await expect(promise).rejects.toThrow('user cancelled'); resolve({ response: { objects: [] } })
  await Promise.resolve(); expect(f.batch).toHaveBeenCalledTimes(1)
})
