import { expect, it, vi } from 'vitest'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE } from '../../packages/soulidity-sdk/src/soul-public-listing'
import { CollectionFloorFieldBcs, CollectionFloorKeyBcs } from '../../packages/soulidity-sdk/src/collection-floor-read'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { CollectionPublicListingBcs, CollectionKioskListingKeyBcs, CollectionKioskListingFieldBcs,
  CollectionKioskRegistryBcs, CollectionKioskOwnerKeyBcs, CollectionKioskRegistrationFieldBcs, CollectionPersonalKioskCapBcs,
  readCollectionPublicSnapshot, readCollectionPublicRoot, readCollectionListingCandidate, readCollectionRightCandidate,
  type CollectionListingCandidateScan, type CollectionPublicReadClient } from '../../packages/soulidity-sdk/src/collection-public-read'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const genesis = toBase58(new Uint8Array(32).fill(1)), digest = toBase58(new Uint8Array(32).fill(2))
function fixture(options: { listed?: boolean; sold?: boolean; acquired?: boolean; floor?: string | null; supply?: string; maxSupply?: string | null } = {}) {
  const pkg = id(90), viewer = id(91), creator = options.acquired ? id(92) : viewer, holder = options.sold ? id(93) : viewer
  const deployment = { originalPackageId: pkg, chainIdentifier: '01010101', marketConfigId: id(94), paymentCoinType: SOUL_PUBLIC_USDC_TYPE,
    kioskRegistryId: id(95), personalKioskTypePackageId: id(96) }
  const c = { id: id(10), version: '1', creator, extra_royalty_bps: 500, tradeable: true, current_holder: holder,
    current_holder_kiosk_id: id(11), right_id: id(12), max_supply: options.maxSupply ?? null, current_supply: options.supply ?? '0' }
  const r = { id: c.right_id, version: '1', collection_id: c.id, creator, name: 'Collection', description: 'Public right', image_url: 'https://example.com/right.png' }
  const listing = { id: id(13), version: '1', collection_id: c.id, right_id: r.id, seller: holder, seller_kiosk_id: c.current_holder_kiosk_id,
    price: '1000001', purchase_cap: { id: id(14), kiosk_id: c.current_holder_kiosk_id, item_id: r.id, min_price: '0' }, is_active: true }
  const objects = new Map<string, any>()
  function put(objectId: string, type: string, codec: any, value: any, kind = 3, owner?: string) {
    objects.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 2n, digest,
      owner: { kind, ...(kind === 3 ? { version: 1n } : {}), ...(owner ? { address: owner } : {}) }, contents: { value: codec.serialize(value).toBytes() } })
  }
  put(c.id, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs, c)
  put(c.current_holder_kiosk_id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs, { id: c.current_holder_kiosk_id, profits: '0', owner: holder, item_count: 1, allow_extensions: true })
  const wrapperId = deriveKioskItemFieldId(c.current_holder_kiosk_id, r.id)
  put(wrapperId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs, { id: wrapperId, name: { name: { id: r.id } }, value: r.id }, 2, c.current_holder_kiosk_id)
  put(r.id, `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs, r, 2, wrapperId)
  const floorType = `${pkg}::collection::FloorPolicyKeyV1`, floorId = deriveDynamicFieldID(c.id, floorType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
  put(floorId, `0x2::dynamic_field::Field<${floorType},0x1::option::Option<u128>>`, CollectionFloorFieldBcs,
    { id: floorId, name: { version: 1 }, value: options.floor ?? null }, 2, c.id)
  put(deployment.marketConfigId, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs, { id: deployment.marketConfigId, version: '2',
    legacy_config_id: id(0), fee_recipient: id(97), platform_fee_bps: 50, primary_enabled: true, secondary_enabled: true })
  put(deployment.kioskRegistryId, `${pkg}::market::KioskRegistry`, CollectionKioskRegistryBcs, { id: deployment.kioskRegistryId, version: '1' })
  const ownerType = `${pkg}::market::PersonalKioskOwnerKey`, regId = deriveDynamicFieldID(deployment.kioskRegistryId, ownerType, CollectionKioskOwnerKeyBcs.serialize({ owner: viewer }).toBytes())
  put(regId, `0x2::dynamic_field::Field<${ownerType},${pkg}::market::PersonalKioskRegistration>`, CollectionKioskRegistrationFieldBcs,
    { id: regId, name: { owner: viewer }, value: { version: '1', kiosk_id: c.current_holder_kiosk_id, kiosk_cap_id: id(98) } }, 2, deployment.kioskRegistryId)
  put(id(98), `${deployment.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`, CollectionPersonalKioskCapBcs,
    { id: id(98), cap: { id: id(99), for: c.current_holder_kiosk_id } }, 1, viewer)
  function marker(exclusive = true) {
    const name = { id: r.id, is_exclusive: exclusive }, markerId = deriveDynamicFieldID(c.current_holder_kiosk_id, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs.serialize(name).toBytes())
    put(markerId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', CollectionKioskListingFieldBcs, { id: markerId, name, value: '0' }, 2, c.current_holder_kiosk_id)
    return markerId
  }
  put(listing.id, `${pkg}::market::CollectionListing`, CollectionPublicListingBcs, listing)
  if (options.listed) marker()
  const listingScan: CollectionListingCandidateScan = { observations: options.listed ? [{ listing, objectVersion: '2', objectDigest: digest }] : [], status: 'COMPLETE',
    source: { endpoint: 'https://graphql.example.com/graphql', chainIdentifier: '01010101', checkpoint: 100,
      scope: { packageId: pkg, type: `${pkg}::market::CollectionListing`, owner: { kind: 'SHARED' } }, authority: 'CANDIDATE_IDS_ONLY' } }
  const batchGetObjects = vi.fn(async ({ requests }: { requests: Array<{ objectId: string }> }) => ({ response: {
    objects: requests.map(({ objectId }) => ({ result: objects.has(objectId) ? { oneofKind: 'object', object: structuredClone(objects.get(objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } }))
  const client = { core: { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: genesis })) }, ledgerService: { batchGetObjects } } as unknown as CollectionPublicReadClient
  const params = { client, deployment, collectionId: c.id, viewerAddress: viewer, listingScan }
  function edit(objectId: string, codec: any, change: (value: any) => void) { const raw = objects.get(objectId), value = codec.parse(raw.contents.value); change(value); raw.contents.value = codec.serialize(value).toBytes() }
  return { params, client, deployment, c, r, listing, listingScan, objects, put, marker, edit, batchGetObjects, wrapperId, floorId, regId, viewer }
}

it('proves an empty created-held Collection, actual wrapper custody and cap without inventing dates', async () => {
  const f = fixture(), result = await readCollectionPublicSnapshot(f.params)
  expect(result).toMatchObject({ status: 'HELD', relationship: 'CREATED_HELD', currentSupply: '0', maxSupply: null, floorPriceAtomic: null,
    personalKioskCapId: id(98), createdAtMs: null, updatedAtMs: null, dateEvidence: 'UNAVAILABLE', isViewerListing: false,
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  expect(Object.isFrozen(result.market)).toBe(true)
  expect(f.batchGetObjects.mock.calls.filter(([args]) => args.requests[0].objectId === f.wrapperId)).toHaveLength(2)
})
it.each([false, true])('anonymous listed=%s reads retain raw custody but never request viewer registration or cap', async listed => {
  const f = fixture({ listed })
  for (const key of [f.deployment.kioskRegistryId, f.regId, id(98)]) f.objects.delete(key)
  const result = await readCollectionPublicSnapshot({ ...f.params, viewerAddress: null })
  expect(result).toMatchObject({ relationship: 'UNRELATED', status: listed ? 'LISTED' : 'HELD',
    isViewerListing: false, personalKioskCapId: null, createdAtMs: null, updatedAtMs: null })
  const requested = f.batchGetObjects.mock.calls.flatMap(([args]) => args.requests.map(row => row.objectId))
  expect(requested).not.toContain(f.deployment.kioskRegistryId); expect(requested).not.toContain(f.regId); expect(requested).not.toContain(id(98))
  expect(requested.filter(key => key === f.wrapperId)).toHaveLength(2)
  if (listed) expect(result.quote).toMatchObject({ priceAtomic: '1000001', totalPaymentAtomic: '1005002' })
})
it('anonymous reads still reject forged Right custody', async () => {
  const f = fixture(); f.objects.get(f.r.id).owner.address = f.c.current_holder_kiosk_id
  await expect(readCollectionPublicSnapshot({ ...f.params, viewerAddress: null })).rejects.toThrow('CUSTODY_MISMATCH')
})
it.each([undefined, '', '0x1', id(0), 1, false])('does not confuse invalid viewer %s with anonymous null', async viewerAddress => {
  const f = fixture()
  await expect(readCollectionPublicSnapshot({ ...f.params, viewerAddress: viewerAddress as string | null })).rejects.toThrow('INVALID_ID')
  expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
})
it.each([{ sold: true, expected: 'CREATED_SOLD', viewerListing: false }, { acquired: true, expected: 'ACQUIRED', viewerListing: true },
  { expected: 'CREATED_HELD', viewerListing: true }])('keeps creator and holder identities distinct: $expected', async options => {
  const f = fixture({ ...options, listed: true }), result = await readCollectionPublicSnapshot(f.params)
  expect(result).toMatchObject({ relationship: options.expected, status: 'LISTED', isViewerListing: options.viewerListing, priceAtomic: '1000001',
    quote: { model: 'BASE_PLUS_FEES', platformFeeAtomic: '5001', totalPaymentAtomic: '1005002', available: true } })
  if (options.sold) expect(result.personalKioskCapId).toBeNull()
})
it('keeps a factual listing when secondary trading is paused and does not apply Soul floor to Right price', async () => {
  const f = fixture({ listed: true, floor: '99999999999999999999' })
  f.edit(f.deployment.marketConfigId, SoulPublicMarketConfigBcs, v => { v.secondary_enabled = false })
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ status: 'LISTED', floorPriceAtomic: '99999999999999999999',
    quote: { available: false, totalPaymentAtomic: '1005002' } })
})
it('preserves exact u64 supply and u128 floor strings above Number.MAX_SAFE_INTEGER', async () => {
  const f = fixture({ supply: '18446744073709551615', maxSupply: '18446744073709551615', floor: '99999999999999999999' })
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ currentSupply: '18446744073709551615', maxSupply: '18446744073709551615', floorPriceAtomic: '99999999999999999999' })
})
it.each(['PARTIAL', 'LIMIT_REACHED'] as const)('does not claim HELD from %s listing coverage', async status => {
  const f = fixture(); f.params.listingScan = { ...f.listingScan, status }
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ status: 'UNAVAILABLE', unavailableReason: 'LISTING_SCAN_INCOMPLETE' })
})
it.each([true, false])('reports unmatched %s reservation, never fabricated HELD', async exclusive => {
  const f = fixture(); f.marker(exclusive)
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED' })
})
it.each([true, false])('retains an unmatched native Kiosk reservation with a nonzero minimum: exclusive=%s', async exclusive => {
  const f = fixture(), markerId = f.marker(exclusive)
  f.edit(markerId, CollectionKioskListingFieldBcs, v => { v.value = '18446744073709551615' })
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED',
    listingId: null, priceAtomic: null, quote: null, isViewerListing: false })
})
it('does not erase inactive historical listings or count them as current', async () => {
  const f = fixture(), old = { ...f.listing, is_active: false, purchase_cap: null }
  f.params.listingScan = { ...f.listingScan, observations: [{ listing: old, objectVersion: '2', objectDigest: digest }] }
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ status: 'HELD', listingId: null })
})
it.each([
  ['direct Kiosk parent', (f: ReturnType<typeof fixture>) => { f.objects.get(f.r.id).owner.address = f.c.current_holder_kiosk_id }],
  ['wrong wrapper value', f => f.edit(f.wrapperId, KioskItemFieldBcs, v => { v.value = id(101) })],
  ['wrong wrapper owner', f => { f.objects.get(f.wrapperId).owner.address = id(101) }],
  ['wrong Right backpointer', f => f.edit(f.r.id, SoulPublicCollectionRightBcs, v => { v.collection_id = id(101) })],
  ['wrong Right creator', f => f.edit(f.r.id, SoulPublicCollectionRightBcs, v => { v.creator = id(101) })],
  ['wrong Kiosk wallet owner', f => f.edit(f.c.current_holder_kiosk_id, SoulPublicKioskBcs, v => { v.owner = id(101) })],
  ['missing floor is not None', f => { f.objects.delete(f.floorId) }],
  ['floor exceeds policy bound', f => f.edit(f.floorId, CollectionFloorFieldBcs, v => { v.value = '100000000000000000000' })],
  ['wrong root version', f => f.edit(f.c.id, SoulPublicCollectionBcs, v => { v.version = '2' })],
  ['supply exceeds maximum', f => f.edit(f.c.id, SoulPublicCollectionBcs, v => { v.current_supply = '2'; v.max_supply = '1' })],
  ['old Market config version', f => f.edit(f.deployment.marketConfigId, SoulPublicMarketConfigBcs, v => { v.version = '1' })],
  ['wrong personal cap owner', f => { f.objects.get(id(98)).owner.address = id(101) }],
  ['wrong registration Kiosk', f => f.edit(f.regId, CollectionKioskRegistrationFieldBcs, v => { v.value.kiosk_id = id(101) })],
  ['wrong wrapped owner cap', f => f.edit(id(98), CollectionPersonalKioskCapBcs, v => { v.cap.for = id(101) })],
  ['trailing BCS', f => { const raw = f.objects.get(f.r.id); raw.contents.value = new Uint8Array([...raw.contents.value, 0]) }],
] as Array<[string, (f: ReturnType<typeof fixture>) => void]>)('rejects %s', async (_name, change) => {
  const f = fixture(); change(f); await expect(readCollectionPublicSnapshot(f.params)).rejects.toThrow()
})
it('accepts a missing current personal cap only as absent action evidence', async () => {
  const f = fixture(); f.objects.delete(id(98))
  expect(await readCollectionPublicSnapshot(f.params)).toMatchObject({ status: 'HELD', personalKioskCapId: null })
})
it.each([
  ['wrong seller', (f: ReturnType<typeof fixture>) => { f.listing.seller = id(101) }],
  ['wrong collection', f => { f.listing.collection_id = id(101) }],
  ['wrong embedded purchase cap', f => { f.listing.purchase_cap.item_id = id(101) }],
  ['missing native reservation', f => { f.objects.delete(f.marker()) }],
  ['nonzero exclusive marker for a Market listing', f => f.edit(f.marker(), CollectionKioskListingFieldBcs, v => { v.value = '123' })],
  ['nonexclusive reservation also present', f => { f.marker(false) }],
  ['stale candidate version', f => { f.objects.get(f.listing.id).version = 3n }],
  ['ambiguous active listings', f => {
    const another = { ...f.listing, id: id(102), purchase_cap: { ...f.listing.purchase_cap, id: id(103) } }
    f.put(another.id, `${f.deployment.originalPackageId}::market::CollectionListing`, CollectionPublicListingBcs, another)
    f.params.listingScan = { ...f.listingScan, observations: [...f.listingScan.observations, { listing: another, objectVersion: '2', objectDigest: digest }] }
  }],
] as Array<[string, (f: ReturnType<typeof fixture>) => void]>)('rejects listing %s', async (_name, change) => {
  const f = fixture({ listed: true }); change(f)
  await expect(readCollectionPublicSnapshot(f.params)).rejects.toThrow()
})
it('rejects byte drift on the final wrapper reread even when version/digest are falsely unchanged', async () => {
  const f = fixture(), original = f.batchGetObjects.getMockImplementation()!; let count = 0
  f.batchGetObjects.mockImplementation(async args => {
    if (args.requests[0].objectId === f.wrapperId && ++count === 2) f.edit(f.wrapperId, KioskItemFieldBcs, v => { v.value = id(101) })
    return original(args)
  })
  await expect(readCollectionPublicSnapshot(f.params)).rejects.toThrow('CHANGED_RETRY')
})
it('checks initially absent reservation again before returning HELD', async () => {
  const f = fixture(), markerId = f.marker(); f.objects.delete(markerId)
  const original = f.batchGetObjects.getMockImplementation()!; let count = 0
  f.batchGetObjects.mockImplementation(async args => { if (args.requests[0].objectId === markerId && ++count === 2) f.marker(); return original(args) })
  await expect(readCollectionPublicSnapshot(f.params)).rejects.toThrow('CHANGED_RETRY')
})
it('rejects stale metadata and wrong chain or scan scope', async () => {
  const f = fixture()
  await expect(readCollectionPublicSnapshot({ ...f.params, expectedRoot: { objectVersion: '1', objectDigest: digest } })).rejects.toThrow('STALE_METADATA')
  await expect(readCollectionPublicSnapshot({ ...f.params, deployment: { ...f.deployment, chainIdentifier: '02020202' } })).rejects.toThrow('WRONG_CHAIN')
  await expect(readCollectionPublicSnapshot({ ...f.params, listingScan: { ...f.listingScan, source: { ...f.listingScan.source,
    scope: { ...f.listingScan.source.scope, type: `${f.deployment.originalPackageId}::market::SoulListing` } } } })).rejects.toThrow('LISTING_SCAN_INVALID')
})
it('candidate readers verify roots, Right backpointer and current Listing, treating only NOT_FOUND as absent', async () => {
  const f = fixture(), common = { client: f.client, deployment: f.deployment }
  expect(await readCollectionPublicRoot({ ...common, collectionId: f.c.id })).toMatchObject({ collection: { current_supply: '0' }, objectVersion: '2' })
  expect(await readCollectionRightCandidate({ ...common, rightId: f.r.id })).toBe(f.c.id)
  expect(await readCollectionListingCandidate({ ...common, listingId: f.listing.id })).toMatchObject({ listing: { is_active: true }, objectVersion: '2' })
  expect(await readCollectionListingCandidate({ ...common, listingId: id(110) })).toBeNull()
  f.batchGetObjects.mockResolvedValueOnce({ response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } })
  await expect(readCollectionListingCandidate({ ...common, listingId: id(110) })).rejects.toThrow('OBJECT_UNAVAILABLE')
})
