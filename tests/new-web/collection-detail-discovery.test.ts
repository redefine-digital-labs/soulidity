import { afterEach, expect, it, vi } from 'vitest'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import * as chainDiscovery from '../../packages/soulidity-sdk/src/chain-object-discovery'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  SOUL_PUBLIC_USDC_TYPE } from '../../packages/soulidity-sdk/src/soul-public-listing'
import { CollectionFloorFieldBcs, CollectionFloorKeyBcs } from '../../packages/soulidity-sdk/src/collection-floor-read'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { CollectionPublicListingBcs, CollectionKioskListingKeyBcs, CollectionKioskListingFieldBcs, CollectionKioskRegistryBcs,
  CollectionKioskOwnerKeyBcs, CollectionKioskRegistrationFieldBcs, CollectionPersonalKioskCapBcs,
  type CollectionPublicReadClient } from '../../packages/soulidity-sdk/src/collection-public-read'
import { createCollectionDetailDiscovery, type CollectionDetailDiscoveryOptions } from '../../packages/soulidity-sdk/src/collection-detail-discovery'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const genesis = toBase58(new Uint8Array(32).fill(1)), digest = toBase58(new Uint8Array(32).fill(2))
type Raw = { objectId: string; objectType: string; version: bigint; digest: string;
  owner: { kind: number; address?: string; version?: bigint }; contents: { value: Uint8Array } }
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

// Actual GraphQL scanner and all canonical current raw readers execute below.
// Only the public network transport is controlled; these are not VM/live proofs.
function fixture(listed = true) {
  const deployment = { originalPackageId: id(90), chainIdentifier: '01010101', marketConfigId: id(94), paymentCoinType: SOUL_PUBLIC_USDC_TYPE,
    kioskRegistryId: id(95), personalKioskTypePackageId: id(96) }, pkg = deployment.originalPackageId
  const c = { id: id(10), version: '1', creator: id(91), extra_royalty_bps: 125, tradeable: true, current_holder: id(93),
    current_holder_kiosk_id: id(11), right_id: id(12), max_supply: '18446744073709551615', current_supply: '9007199254740993' }
  const right = { id: c.right_id, version: '1', collection_id: c.id, creator: c.creator, name: 'Known Collection', description: 'Raw public detail', image_url: '' }
  const listing = { id: id(13), version: '1', collection_id: c.id, right_id: right.id, seller: c.current_holder, seller_kiosk_id: c.current_holder_kiosk_id,
    price: '9007199254740993', purchase_cap: { id: id(14), kiosk_id: c.current_holder_kiosk_id, item_id: right.id, min_price: '0' }, is_active: true }
  const rows = new Map<string, Raw>()
  function put(objectId: string, type: string, codec: Codec, value: any, owner: Raw['owner'] = { kind: 3, version: 1n }) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 2n, digest, owner, contents: { value: codec.serialize(value).toBytes() } })
  }
  function edit(objectId: string, codec: Codec, change: (value: any) => void) {
    const raw = rows.get(objectId)!, value = codec.parse(raw.contents.value); change(value); raw.contents.value = codec.serialize(value).toBytes()
  }
  put(c.id, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs, c)
  put(c.current_holder_kiosk_id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs,
    { id: c.current_holder_kiosk_id, profits: '0', owner: c.current_holder, item_count: 1, allow_extensions: true })
  const wrapperId = deriveKioskItemFieldId(c.current_holder_kiosk_id, right.id)
  put(wrapperId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs, { id: wrapperId, name: { name: { id: right.id } }, value: right.id }, { kind: 2, address: c.current_holder_kiosk_id })
  put(right.id, `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs, right, { kind: 2, address: wrapperId })
  const floorType = `${pkg}::collection::FloorPolicyKeyV1`, floorId = deriveDynamicFieldID(c.id, floorType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
  put(floorId, `0x2::dynamic_field::Field<${floorType},0x1::option::Option<u128>>`, CollectionFloorFieldBcs,
    { id: floorId, name: { version: 1 }, value: '99999999999999999999' }, { kind: 2, address: c.id })
  put(deployment.marketConfigId, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs, { id: deployment.marketConfigId, version: '2',
    legacy_config_id: id(0), fee_recipient: id(97), platform_fee_bps: 50, primary_enabled: true, secondary_enabled: true })
  const markerName = { id: right.id, is_exclusive: true }, markerId = deriveDynamicFieldID(c.current_holder_kiosk_id,
    '0x2::kiosk::Listing', CollectionKioskListingKeyBcs.serialize(markerName).toBytes())
  function publishListing() {
    put(listing.id, `${pkg}::market::CollectionListing`, CollectionPublicListingBcs, listing)
    put(markerId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', CollectionKioskListingFieldBcs,
      { id: markerId, name: markerName, value: '0' }, { kind: 2, address: c.current_holder_kiosk_id })
  }
  if (listed) publishListing()
  put(deployment.kioskRegistryId, `${pkg}::market::KioskRegistry`, CollectionKioskRegistryBcs, { id: deployment.kioskRegistryId, version: '1' })
  const ownerType = `${pkg}::market::PersonalKioskOwnerKey`, regId = deriveDynamicFieldID(deployment.kioskRegistryId, ownerType,
    CollectionKioskOwnerKeyBcs.serialize({ owner: c.current_holder }).toBytes()), capId = id(98)
  put(regId, `0x2::dynamic_field::Field<${ownerType},${pkg}::market::PersonalKioskRegistration>`, CollectionKioskRegistrationFieldBcs,
    { id: regId, name: { owner: c.current_holder }, value: { version: '1', kiosk_id: c.current_holder_kiosk_id, kiosk_cap_id: capId } }, { kind: 2, address: deployment.kioskRegistryId })
  put(capId, `${deployment.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`, CollectionPersonalKioskCapBcs,
    { id: capId, cap: { id: id(99), for: c.current_holder_kiosk_id } }, { kind: 1, address: c.current_holder })
  const batch = vi.fn(async ({ requests }: { requests: Array<{ objectId: string }> }) => ({ response: {
    objects: requests.map(({ objectId }) => ({ result: rows.has(objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } }))
  const chain = vi.fn(async () => ({ chainIdentifier: genesis }))
  const client = { core: { getChainIdentifier: chain }, ledgerService: { batchGetObjects: batch } } as unknown as CollectionPublicReadClient
  const pages = [{ ids: listed ? [listing.id] : [], more: false, checkpoint: 100 }]
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, args) => {
    const v = JSON.parse(String(args?.body)).variables, index = v.after === null ? 0 : Number(v.after.slice(1)), page = pages[index]
    if (!page) throw new Error('fixture received unexpected candidate query')
    return new Response(JSON.stringify({ data: { chainIdentifier: genesis, checkpoint: { sequenceNumber: page.checkpoint,
      query: { objects: { nodes: page.ids.map(address => ({ address })), pageInfo: { hasNextPage: page.more, endCursor: page.ids.length ? `c${index + 1}` : null } } } } } }))
  })
  const options: CollectionDetailDiscoveryOptions = { client, deployment, collectionId: c.id, viewerAddress: null,
    discovery: { endpoint: 'https://graphql.example.com/', pageSize: 50, maxPages: 20, maxObjects: 1000, timeoutMs: 1000, fetch: fetcher } }
  const requests = () => fetcher.mock.calls.map(([, args]) => JSON.parse(String(args?.body)).variables)
  return { options, deployment, c, right, listing, rows, put, edit, publishListing, wrapperId, floorId, markerId, regId, capId,
    batch, chain, fetcher, pages, requests, scan: () => createCollectionDetailDiscovery(options) }
}
afterEach(() => vi.restoreAllMocks())

it('scans Listing pages once, then reads only the known Collection with exact anonymous raw custody/quote', async () => {
  const f = fixture(); f.pages.splice(0, 1, { ids: [id(500)], more: true, checkpoint: 100 }, { ids: [f.listing.id], more: false, checkpoint: 100 })
  const scan = f.scan(), first = await scan.next(), lastListing = await scan.next()
  expect(first).toMatchObject({ collection: null, phase: 'LISTINGS', candidateStatus: 'PARTIAL', verifiedListingCandidates: 1 })
  expect(lastListing).toMatchObject({ collection: null, phase: 'LISTINGS', candidateStatus: 'PARTIAL', verifiedListingCandidates: 2 })
  expect(f.batch.mock.calls.some(([args]) => args.requests[0].objectId === f.c.id)).toBe(false)
  const result = await scan.next()
  expect(result).toMatchObject({ phase: 'COLLECTION', candidateStatus: 'COMPLETE', verifiedListingCandidates: 2,
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true,
    collection: { collectionId: f.c.id, status: 'LISTED', relationship: 'UNRELATED', personalKioskCapId: null, isViewerListing: false,
      currentSupply: '9007199254740993', maxSupply: '18446744073709551615', floorPriceAtomic: '99999999999999999999',
      priceAtomic: '9007199254740993', quote: { model: 'BASE_PLUS_FEES', totalPaymentAtomic: '9052235251014698' }, createdAtMs: null, updatedAtMs: null } })
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  expect(f.requests().every(v => v.filter.type === `${f.deployment.originalPackageId}::market::CollectionListing` && v.filter.ownerKind === 'SHARED')).toBe(true)
  expect(f.batch.mock.calls.some(([args]) => [f.deployment.kioskRegistryId, f.regId, f.capId].includes(args.requests[0].objectId))).toBe(false)
  expect(Object.isFrozen(result.collection!.quote)).toBe(true); expect(first.collection).toBeNull()
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
})
it.each([true, false])('a complete empty Listing scan still hydrates the known tradeable=%s root, not empty detail', async tradeable => {
  const f = fixture(false); f.edit(f.c.id, SoulPublicCollectionBcs, c => { c.tradeable = tradeable }); const scan = f.scan()
  expect(await scan.next()).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'PARTIAL', collection: null })
  expect(await scan.next()).toMatchObject({ candidateStatus: 'COMPLETE', collection: { collectionId: f.c.id, status: 'HELD', rightTradeable: tradeable } })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it.each(['creator', 'holder'] as const)('connected %s identity remains distinct and only holder obtains cap', async who => {
  const f = fixture(); f.options.viewerAddress = who === 'creator' ? f.c.creator : f.c.current_holder; const scan = f.scan(); await scan.next()
  expect((await scan.next()).collection).toMatchObject({ relationship: who === 'creator' ? 'CREATED_SOLD' : 'ACQUIRED',
    personalKioskCapId: who === 'creator' ? null : f.capId, isViewerListing: who === 'holder' })
})
it.each(['listing', 'root', 'wrapper', 'floor'] as const)('raw %s failure is retryable without rescanning or a false empty success', async part => {
  const f = fixture(), scan = f.scan(); if (part !== 'listing') await scan.next()
  const key = part === 'listing' ? f.listing.id : part === 'root' ? f.c.id : part === 'wrapper' ? f.wrapperId : f.floorId
  const saved = structuredClone(f.rows.get(key)!); f.rows.get(key)!.contents.value = new Uint8Array([0])
  await expect(scan.next()).rejects.toThrow(); const fetchCount = f.fetcher.mock.calls.length; f.rows.set(key, saved)
  const recovered = await scan.next(); expect(f.fetcher).toHaveBeenCalledTimes(fetchCount)
  expect(recovered).toMatchObject(part === 'listing' ? { phase: 'LISTINGS', collection: null, verifiedListingCandidates: 1 } : { phase: 'COLLECTION', candidateStatus: 'COMPLETE', collection: { collectionId: f.c.id } })
})
it('missing root is an error and its same-ID retry does not query all roots', async () => {
  const f = fixture(false), scan = f.scan(); await scan.next(); const saved = f.rows.get(f.c.id)!; f.rows.delete(f.c.id)
  await expect(scan.next()).rejects.toThrow('OBJECT_UNAVAILABLE'); f.rows.set(f.c.id, saved)
  expect((await scan.next()).collection!.collectionId).toBe(f.c.id); expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('root changes between preliminary raw and full snapshot require a current same-ID retry', async () => {
  const f = fixture(), scan = f.scan(); await scan.next(); const original = f.batch.getMockImplementation()!; let reads = 0
  f.batch.mockImplementation(async args => { if (args.requests[0].objectId === f.c.id && ++reads === 3) f.rows.get(f.c.id)!.version = 3n; return original(args) })
  await expect(scan.next()).rejects.toThrow('STALE_METADATA')
  expect((await scan.next()).collection!.collectionVersion).toBe('3'); expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('listing created after an empty checkpoint is unavailable rather than falsely held', async () => {
  const f = fixture(false), scan = f.scan(); await scan.next(); f.publishListing()
  expect((await scan.next()).collection).toMatchObject({ status: 'UNAVAILABLE', unavailableReason: 'RESERVATION_UNMATCHED', quote: null })
})
it.each(['deleted', 'repriced', 'inactive'] as const)('a %s Listing since the scan cannot produce stale current detail', async change => {
  const f = fixture(), scan = f.scan(); await scan.next()
  if (change === 'deleted') f.rows.delete(f.listing.id)
  else f.edit(f.listing.id, CollectionPublicListingBcs, l => { if (change === 'repriced') l.price = '1'; else { l.is_active = false; l.purchase_cap = null } })
  await expect(scan.next()).rejects.toThrow(change === 'deleted' ? 'OBJECT_UNAVAILABLE' : 'STALE_LISTING_SCAN')
})
it('a limit is terminal incomplete data and never triggers a root read', async () => {
  const f = fixture(); f.options.discovery.maxPages = 1; f.pages[0].more = true; const scan = f.scan()
  expect(await scan.next()).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'LIMIT_REACHED', collection: null, verifiedListingCandidates: 1 })
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
  expect(f.batch.mock.calls.some(([args]) => args.requests[0].objectId === f.c.id)).toBe(false)
})
it('captures client/deployment/viewer/ID/discovery before any await', async () => {
  const f = fixture(), scan = f.scan(); f.options.collectionId = id(888); f.options.viewerAddress = f.c.current_holder
  f.options.client = {} as CollectionPublicReadClient; f.options.deployment.originalPackageId = id(889)
  f.options.discovery.endpoint = 'https://different.example.com/'; f.options.discovery.fetch = vi.fn(); f.options.discovery.maxPages = 1
  await scan.next(); const result = await scan.next()
  expect(result).toMatchObject({ collection: { collectionId: f.c.id, relationship: 'UNRELATED' }, listingSource: { endpoint: 'https://graphql.example.com/', scope: { packageId: id(90) } } })
})
it.each([undefined, '', id(0), '0x1', 1, false])('invalid collection ID %s is rejected before network access', value => {
  const f = fixture(); f.options.collectionId = value as string
  expect(() => f.scan()).toThrow('INPUT_INVALID'); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.chain).not.toHaveBeenCalled()
})
it.each([undefined, '', id(0), '0x1', 1, false])('invalid non-null viewer %s is rejected before network access', value => {
  const f = fixture(); f.options.viewerAddress = value as string
  expect(() => f.scan()).toThrow('INPUT_INVALID'); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.chain).not.toHaveBeenCalled()
})
it('retries a failed later GraphQL page at exactly its prior checkpoint and cursor', async () => {
  const f = fixture(); f.pages.splice(0, 1, { ids: [id(500)], more: true, checkpoint: 100 }, { ids: [f.listing.id], more: false, checkpoint: 100 }); const scan = f.scan()
  await scan.next(); f.fetcher.mockRejectedValueOnce(new Error('offline')); await expect(scan.next()).rejects.toThrow('transport failed')
  expect(await scan.next()).toMatchObject({ verifiedListingCandidates: 2 }); expect(f.requests().slice(-2)[0]).toEqual(f.requests().slice(-2)[1])
  expect(f.requests().at(-1)).toMatchObject({ after: 'c1', checkpoint: 100 }); expect((await scan.next()).collection!.collectionId).toBe(f.c.id)
})
it('terminal cursor handoff cancellation retains accepted page without refetching', async () => {
  const f = fixture(), caller = new AbortController(), create = chainDiscovery.createChainObjectDiscovery
  vi.spyOn(chainDiscovery, 'createChainObjectDiscovery').mockImplementation(options => {
    const original = create(options); return { async next(args) { const page = await original.next(args); caller.abort(new Error('handoff cancelled')); return page } }
  })
  const scan = f.scan(); await expect(scan.next({ signal: caller.signal })).rejects.toThrow('handoff cancelled')
  expect(await scan.next()).toMatchObject({ phase: 'LISTINGS', verifiedListingCandidates: 1 })
  expect((await scan.next()).collection!.collectionId).toBe(f.c.id); expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it.each(['LISTINGS', 'COLLECTION'] as const)('caller cancellation during %s ignored raw transport cannot commit late data', async phase => {
  const f = fixture(), scan = f.scan(), caller = new AbortController(); if (phase === 'COLLECTION') await scan.next()
  const entered = deferred<void>(), gate = deferred<void>(), original = f.batch.getMockImplementation()!
  f.batch.mockImplementationOnce(async args => { entered.resolve(); await gate.promise; return original(args) })
  const work = scan.next({ signal: caller.signal }), rejected = expect(work).rejects.toThrow('cancelled'); await entered.promise
  await expect(scan.next()).rejects.toThrow('BUSY'); caller.abort(new Error('cancelled')); await rejected
  const result = await scan.next(); gate.resolve(); await Promise.resolve()
  expect(result).toMatchObject(phase === 'LISTINGS' ? { collection: null, verifiedListingCandidates: 1 } : { candidateStatus: 'COMPLETE', collection: { collectionId: f.c.id } })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('lifetime cancellation permanently retires the captured session', async () => {
  const f = fixture(), lifetime = new AbortController(); f.options.signal = lifetime.signal; const scan = f.scan(); await scan.next()
  const entered = deferred<void>(); f.batch.mockImplementationOnce(async () => { entered.resolve(); return new Promise(() => {}) })
  const work = scan.next(), rejected = expect(work).rejects.toThrow('replaced'); await entered.promise; lifetime.abort(new Error('replaced')); await rejected
  await expect(scan.next()).rejects.toThrow('replaced'); expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it.each(['LISTINGS', 'COLLECTION'] as const)('bounded %s read timeout remains retryable without advancing discovery', async phase => {
  const f = fixture(), scan = f.scan(); if (phase === 'COLLECTION') await scan.next()
  const timeout = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 40000 ? timeout.signal : nativeTimeout(ms))
  const entered = deferred<void>(); f.batch.mockImplementationOnce(async () => { entered.resolve(); return new Promise(() => {}) })
  const work = scan.next(), rejected = expect(work).rejects.toThrow('timed out'); await entered.promise
  timeout.abort(new DOMException('timed out', 'TimeoutError')); await rejected; spy.mockRestore()
  expect(await scan.next()).toMatchObject(phase === 'LISTINGS' ? { verifiedListingCandidates: 1 } : { candidateStatus: 'COMPLETE' })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('four listing workers commit together and late siblings cannot contaminate a retry', async () => {
  const f = fixture(), ids = [f.listing.id, ...Array.from({ length: 6 }, (_, i) => id(500 + i))]
  f.pages[0].ids = ids
  const scan = f.scan(), original = f.batch.getMockImplementation()!, gate = deferred<void>(), late = deferred<void>(), entered = deferred<void>()
  let active = 0, peak = 0, started = 0
  f.batch.mockImplementation(async args => {
    const attempt = started++; active++; peak = Math.max(peak, active)
    if (attempt < 4) { if (attempt === 3) entered.resolve(); await gate.promise }
    try {
      if (attempt === 0) { await late.promise; return original(args) }
      if (attempt === 1) throw new Error('raw sibling failed')
      return await original(args)
    } finally { active-- }
  })
  const work = scan.next(), rejected = expect(work).rejects.toThrow('raw sibling failed'); await entered.promise
  expect(peak).toBe(4); gate.resolve(); await rejected
  f.batch.mockImplementation(original); const result = await scan.next(); late.resolve(); await Promise.resolve()
  expect(result).toMatchObject({ phase: 'LISTINGS', collection: null, verifiedListingCandidates: 7 })
  expect((await scan.next()).collection!.collectionId).toBe(f.c.id); expect(f.fetcher).toHaveBeenCalledTimes(1)
})
