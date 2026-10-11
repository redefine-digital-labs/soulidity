import { afterEach, expect, it, vi } from 'vitest'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  SOUL_PUBLIC_USDC_TYPE } from '../../packages/soulidity-sdk/src/soul-public-listing'
import { CollectionFloorFieldBcs, CollectionFloorKeyBcs } from '../../packages/soulidity-sdk/src/collection-floor-read'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { CollectionPublicListingBcs, CollectionKioskListingKeyBcs, CollectionKioskListingFieldBcs,
  type CollectionPublicReadClient } from '../../packages/soulidity-sdk/src/collection-public-read'
import { createCollectionMarketDiscovery, type CollectionMarketDiscoveryOptions } from '../../packages/soulidity-sdk/src/collection-market-discovery'
import * as chainDiscovery from '../../packages/soulidity-sdk/src/chain-object-discovery'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const genesis = toBase58(new Uint8Array(32).fill(1)), digest = toBase58(new Uint8Array(32).fill(2)), viewer = id(91)
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
type Raw = { objectId: string; objectType: string; version: bigint; digest: string;
  owner: { kind: number; version?: bigint; address?: string }; contents: { value: Uint8Array } }
type Page = { ids: string[]; more: boolean; checkpoint?: number }
// Controlled transport only: actual GraphQL scanner, BCS candidate readers and
// full current snapshots run unmocked. These are not live-chain/VM proof fixtures.
function fixture() {
  const deployment = { originalPackageId: id(90), chainIdentifier: '01010101', marketConfigId: id(94), paymentCoinType: SOUL_PUBLIC_USDC_TYPE,
    kioskRegistryId: id(95), personalKioskTypePackageId: id(96) }
  const pkg = deployment.originalPackageId, objects = new Map<string, Raw>()
  function put(objectId: string, type: string, codec: Codec, value: any, kind = 3, owner?: string) {
    objects.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 2n, digest,
      owner: { kind, ...(kind === 3 ? { version: 1n } : {}), ...(owner ? { address: owner } : {}) }, contents: { value: codec.serialize(value).toBytes() } })
  }
  function edit(objectId: string, codec: Codec, change: (value: any) => void) {
    const raw = objects.get(objectId)!, value = codec.parse(raw.contents.value); change(value); raw.contents.value = codec.serialize(value).toBytes()
  }
  put(deployment.marketConfigId, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs,
    { id: deployment.marketConfigId, version: '2', legacy_config_id: id(0), fee_recipient: id(97), platform_fee_bps: 50, primary_enabled: true, secondary_enabled: true })
  function add(n: number, options: { listed?: boolean; tradeable?: boolean; reserved?: boolean; creator?: string; holder?: string; supply?: string; floor?: string | null } = {}) {
    const collectionId = id(1000 + n * 10), kioskId = id(1001 + n * 10), rightId = id(1002 + n * 10), listingId = id(1003 + n * 10)
    const creator = options.creator ?? id(92), holder = options.holder ?? id(93)
    const c = { id: collectionId, version: '1', creator, extra_royalty_bps: 500, tradeable: options.tradeable ?? true,
      current_holder: holder, current_holder_kiosk_id: kioskId, right_id: rightId, max_supply: null, current_supply: options.supply ?? '0' }
    put(collectionId, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs, c)
    put(kioskId, '0x2::kiosk::Kiosk', SoulPublicKioskBcs, { id: kioskId, profits: '0', owner: holder, item_count: 1, allow_extensions: true })
    const wrapperId = deriveKioskItemFieldId(kioskId, rightId)
    put(wrapperId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs, { id: wrapperId, name: { name: { id: rightId } }, value: rightId }, 2, kioskId)
    put(rightId, `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs,
      { id: rightId, version: '1', collection_id: collectionId, creator, name: `Collection ${n}`, description: 'Public', image_url: '' }, 2, wrapperId)
    const floorType = `${pkg}::collection::FloorPolicyKeyV1`, floorId = deriveDynamicFieldID(collectionId, floorType, CollectionFloorKeyBcs.serialize({ version: 1 }).toBytes())
    put(floorId, `0x2::dynamic_field::Field<${floorType},0x1::option::Option<u128>>`, CollectionFloorFieldBcs,
      { id: floorId, name: { version: 1 }, value: options.floor ?? null }, 2, collectionId)
    const markerName = { id: rightId, is_exclusive: true }, markerId = deriveDynamicFieldID(kioskId, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs.serialize(markerName).toBytes())
    if (options.listed || options.reserved) put(markerId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', CollectionKioskListingFieldBcs,
      { id: markerId, name: markerName, value: options.listed ? '0' : '9007199254740993' }, 2, kioskId)
    if (options.listed) put(listingId, `${pkg}::market::CollectionListing`, CollectionPublicListingBcs,
      { id: listingId, version: '1', collection_id: collectionId, right_id: rightId, seller: holder, seller_kiosk_id: kioskId,
        price: '1000001', purchase_cap: { id: id(1004 + n * 10), kiosk_id: kioskId, item_id: rightId, min_price: '0' }, is_active: true })
    return { collectionId, kioskId, rightId, listingId, wrapperId, floorId, markerId }
  }
  const batch = vi.fn(async ({ requests }: { requests: Array<{ objectId: string }> }) => ({ response: {
    objects: requests.map(({ objectId }) => ({ result: objects.has(objectId) ? { oneofKind: 'object', object: structuredClone(objects.get(objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } }))
  const chain = vi.fn(async () => ({ chainIdentifier: genesis }))
  const client = { core: { getChainIdentifier: chain }, ledgerService: { batchGetObjects: batch } } as unknown as CollectionPublicReadClient
  const fetcher = vi.fn<typeof fetch>()
  function pages(...rows: Page[]) { rows.forEach((page, i) => fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: { chainIdentifier: genesis,
    checkpoint: { sequenceNumber: page.checkpoint ?? 100, query: { objects: { nodes: page.ids.map(address => ({ address })),
      pageInfo: { hasNextPage: page.more, endCursor: page.ids.length ? `opaque:${i}` : null } } } } } })))) }
  const options: CollectionMarketDiscoveryOptions = { client, deployment, viewerAddress: null,
    discovery: { endpoint: 'https://graphql.example.com/graphql', pageSize: 50, maxPages: 20, maxObjects: 1000, timeoutMs: 1000, fetch: fetcher } }
  const requests = () => fetcher.mock.calls.map(([, args]) => JSON.parse(args!.body as string).variables)
  return { options, deployment, objects, put, edit, add, batch, chain, fetcher, pages, requests,
    scan: () => createCollectionMarketDiscovery(options) }
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('composes all raw public roots, exact prices and two checkpoint scans without owner-cap reads or per-item scans', async () => {
  const f = fixture(), a = f.add(1, { listed: true }), b = f.add(2, { tradeable: false }), c = f.add(3, { reserved: true })
  f.pages({ ids: [a.listingId], more: true }, { ids: [id(9999)], more: false },
    { ids: [a.collectionId, b.collectionId], more: true, checkpoint: 105 }, { ids: [c.collectionId], more: false, checkpoint: 105 })
  const scan = f.scan()
  expect(await scan.next()).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'PARTIAL', verifiedListingCandidates: 1, collections: [] })
  expect(await scan.next()).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'PARTIAL', listingStatus: 'COMPLETE', verifiedListingCandidates: 2 })
  const first = await scan.next(); expect(first.collections).toHaveLength(2)
  const last = await scan.next()
  expect(last).toMatchObject({ phase: 'COLLECTIONS', candidateStatus: 'COMPLETE', verifiedCollectionCandidates: 3,
    listingSource: { checkpoint: 100 }, collectionSource: { checkpoint: 105 }, readConsistency: 'NON_ATOMIC_CURRENT_READSET', notTransactionAuthorization: true })
  expect(last.collections.map(c => c.status)).toEqual(['LISTED', 'HELD', 'UNAVAILABLE'])
  expect(last.collections[0]).toMatchObject({ priceAtomic: '1000001', quote: { totalPaymentAtomic: '1005002', available: true } })
  expect(last.collections[1].rightTradeable).toBe(false)
  expect(last.collections[2].unavailableReason).toBe('RESERVATION_UNMATCHED')
  expect(last.collections.every(c => c.relationship === 'UNRELATED' && c.personalKioskCapId === null && !c.isViewerListing)).toBe(true)
  expect(f.batch.mock.calls.some(([args]) => args.requests[0].objectId === f.deployment.kioskRegistryId)).toBe(false)
  expect(f.requests().map(v => v.filter)).toEqual([
    ...Array(2).fill({ type: `${f.deployment.originalPackageId}::market::CollectionListing`, ownerKind: 'SHARED' }),
    ...Array(2).fill({ type: `${f.deployment.originalPackageId}::collection::SoulCollection`, ownerKind: 'SHARED' })])
  expect(f.requests()[2]).toMatchObject({ checkpoint: null, after: null }); expect(f.requests()[3]).toMatchObject({ checkpoint: 105, after: 'opaque:2' })
  expect(first.collections).toHaveLength(2); expect(Object.isFrozen(last.collections[0].quote)).toBe(true)
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('connected viewer retains unrelated and created-sold roots, not only their portfolio or for-sale items', async () => {
  const f = fixture(), a = f.add(1), b = f.add(2, { creator: viewer, listed: true })
  f.options.viewerAddress = viewer; f.pages({ ids: [b.listingId], more: false }, { ids: [a.collectionId, b.collectionId], more: false })
  const scan = f.scan(); await scan.next()
  expect((await scan.next()).collections.map(c => c.relationship)).toEqual(['UNRELATED', 'CREATED_SOLD'])
})
it('retains more than twelve roots and exact supply/floor without invented dates', async () => {
  const f = fixture(), roots = Array.from({ length: 15 }, (_, i) => f.add(i + 1, { supply: '18446744073709551615', floor: '99999999999999999999' }).collectionId)
  f.pages({ ids: [], more: false }, { ids: roots.slice(0, 10), more: true }, { ids: roots.slice(10), more: false })
  const scan = f.scan(); await scan.next(); await scan.next(); const result = await scan.next()
  expect(result.collections).toHaveLength(15)
  expect(result.collections.every(c => c.currentSupply === '18446744073709551615' && c.floorPriceAtomic === '99999999999999999999'
    && c.createdAtMs === null && c.updatedAtMs === null && c.dateEvidence === 'UNAVAILABLE')).toBe(true)
})
it('two complete empty candidate scans, and only these, establish an empty candidate result', async () => {
  const f = fixture(); f.pages({ ids: [], more: false }, { ids: [], more: false }); const scan = f.scan()
  expect(await scan.next()).toMatchObject({ candidateStatus: 'PARTIAL', collectionSource: null })
  expect(await scan.next()).toMatchObject({ candidateStatus: 'COMPLETE', verifiedListingCandidates: 0, verifiedCollectionCandidates: 0, collections: [] })
})
it.each(['LISTINGS', 'COLLECTIONS'] as const)('retains the accepted failed terminal %s page for raw retry', async phase => {
  const f = fixture(), a = f.add(1, { listed: true }), b = f.add(2, { listed: true })
  f.pages({ ids: [a.listingId, b.listingId], more: false }, { ids: [a.collectionId, b.collectionId], more: false })
  const scan = f.scan(), target = phase === 'LISTINGS' ? b.listingId : b.wrapperId, original = structuredClone(f.objects.get(target)!)
  if (phase === 'COLLECTIONS') await scan.next()
  f.objects.get(target)!.contents.value = new Uint8Array([0])
  await expect(scan.next()).rejects.toThrow(); const fetchCount = f.fetcher.mock.calls.length
  f.objects.set(target, original); const recovered = await scan.next()
  expect(f.fetcher).toHaveBeenCalledTimes(fetchCount)
  expect(recovered).toMatchObject(phase === 'LISTINGS' ? { verifiedListingCandidates: 2, collections: [], listingStatus: 'COMPLETE' }
    : { verifiedCollectionCandidates: 2, candidateStatus: 'COMPLETE' })
  if (phase === 'COLLECTIONS') expect(recovered.collections).toHaveLength(2)
})
it('does not commit partial raw page results or mutate an earlier returned page', async () => {
  const f = fixture(), a = f.add(1), b = f.add(2), c = f.add(3)
  f.pages({ ids: [], more: false }, { ids: [a.collectionId], more: true }, { ids: [b.collectionId, c.collectionId], more: false })
  const scan = f.scan(); await scan.next(); const first = await scan.next()
  const original = structuredClone(f.objects.get(c.rightId)!); f.objects.get(c.rightId)!.owner.address = c.kioskId
  await expect(scan.next()).rejects.toThrow('CUSTODY_MISMATCH')
  expect(first.collections.map(c => c.collectionId)).toEqual([a.collectionId]); expect(first.verifiedCollectionCandidates).toBe(1)
  f.objects.set(c.rightId, original); expect((await scan.next()).verifiedCollectionCandidates).toBe(3)
  expect(f.fetcher).toHaveBeenCalledTimes(3)
})
it('expectedRoot rejects root drift between raw root filtering and full snapshot', async () => {
  const f = fixture(), a = f.add(1), original = f.batch.getMockImplementation()!; let count = 0
  f.pages({ ids: [], more: false }, { ids: [a.collectionId], more: false }); const scan = f.scan(); await scan.next()
  f.batch.mockImplementation(async args => {
    if (args.requests[0].objectId === a.collectionId && ++count === 3) f.objects.get(a.collectionId)!.version = 3n
    return original(args)
  })
  await expect(scan.next()).rejects.toThrow('STALE_METADATA')
  expect((await scan.next()).collections[0].collectionVersion).toBe('3'); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('revalidates a matching Listing against the completed shared scan, not stale candidate content', async () => {
  const f = fixture(), a = f.add(1, { listed: true }); f.pages({ ids: [a.listingId], more: false }, { ids: [a.collectionId], more: false })
  const scan = f.scan(); await scan.next(); f.objects.get(a.listingId)!.version = 3n
  await expect(scan.next()).rejects.toThrow('STALE_LISTING_SCAN')
})
it.each(['LISTINGS', 'COLLECTIONS'] as const)('%s limit remains incomplete and does not continue behind the caller', async phase => {
  const f = fixture(), a = f.add(1, { listed: phase === 'LISTINGS' }); f.options.discovery.maxPages = 1
  f.pages(...(phase === 'COLLECTIONS' ? [{ ids: [], more: false }] : []),
    { ids: [phase === 'LISTINGS' ? a.listingId : a.collectionId], more: true })
  const scan = f.scan(); if (phase === 'COLLECTIONS') await scan.next()
  expect(await scan.next()).toMatchObject({ phase, candidateStatus: 'LIMIT_REACHED', ...(phase === 'LISTINGS' ? { collections: [], collectionSource: null } : { verifiedCollectionCandidates: 1 }) })
  await expect(scan.next()).rejects.toThrow('SCAN_ENDED')
})
it('frozen construction inputs survive caller mutation and returned values cannot alter later results', async () => {
  const f = fixture(), a = f.add(1), b = f.add(2)
  f.pages({ ids: [], more: false }, { ids: [a.collectionId], more: true }, { ids: [b.collectionId], more: false }); const scan = f.scan()
  f.options.viewerAddress = id(93); f.options.deployment.originalPackageId = id(777)
  f.options.client = {} as CollectionPublicReadClient
  f.options.discovery.endpoint = 'https://other.example.com/graphql'; f.options.discovery.fetch = vi.fn(); f.options.discovery.maxPages = 1
  const listing = await scan.next(); expect(Object.isFrozen(listing.listingSource.scope.owner)).toBe(true)
  const first = await scan.next(); expect(first.candidateStatus).toBe('PARTIAL')
  const result = await scan.next(); expect(result.collections[0].relationship).toBe('UNRELATED'); expect(result.collections).toHaveLength(2)
  expect(result.listingSource.endpoint).toBe('https://graphql.example.com/graphql'); expect(result.listingSource.scope.packageId).toBe(id(90))
  expect(first.collections).toHaveLength(1)
})
it.each([undefined, '', id(0), '0x1', 3, false])('rejects malformed non-null viewer %s before network reads', value => {
  const f = fixture(); f.options.viewerAddress = value as string | null
  expect(() => f.scan()).toThrow('INPUT_INVALID'); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.chain).not.toHaveBeenCalled()
})
it('wrong chain and GraphQL errors are retryable errors, not empty market success', async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: { chainIdentifier: toBase58(new Uint8Array(32).fill(2)) } })))
  f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'unavailable' }] })))
  f.pages({ ids: [], more: false }); const scan = f.scan()
  await expect(scan.next()).rejects.toThrow('network'); await expect(scan.next()).rejects.toThrow('GraphQL')
  expect(await scan.next()).toMatchObject({ candidateStatus: 'PARTIAL' })
  expect(f.requests().every(v => v.after === null && v.checkpoint === null)).toBe(true)
})
it('four raw workers bound concurrency and concurrent next is rejected', async () => {
  const f = fixture(), roots = Array.from({ length: 8 }, (_, i) => f.add(i + 1, { listed: true }))
  f.pages({ ids: roots.map(a => a.listingId), more: false }); const scan = f.scan(), original = f.batch.getMockImplementation()!
  let release!: () => void, active = 0, maximum = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  f.batch.mockImplementation(async args => { active++; maximum = Math.max(maximum, active); await gate; try { return await original(args) } finally { active-- } })
  const work = scan.next(); await vi.waitFor(() => expect(active).toBe(4)); await expect(scan.next()).rejects.toThrow('BUSY')
  release(); expect((await work).verifiedListingCandidates).toBe(8); expect(maximum).toBe(4)
})
it.each(['caller', 'lifetime'] as const)('%s cancellation bounds ignored transport and late results cannot commit', async kind => {
  const f = fixture(), a = f.add(1), cancel = new AbortController(); if (kind === 'lifetime') f.options.signal = cancel.signal
  f.pages({ ids: [], more: false }, { ids: [a.collectionId], more: false }); const scan = f.scan(); await scan.next()
  const original = f.batch.getMockImplementation()!; let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  f.batch.mockImplementationOnce(async args => { entered(); await new Promise<void>(resolve => { release = resolve }); return original(args) })
  const work = scan.next(kind === 'caller' ? { signal: cancel.signal } : undefined)
  const rejected = expect(work).rejects.toThrow('cancelled'); await started; cancel.abort(new Error('cancelled')); await rejected
  if (kind === 'caller') {
    const recovered = await scan.next(); expect(recovered).toMatchObject({ candidateStatus: 'COMPLETE', verifiedCollectionCandidates: 1 })
    release(); await Promise.resolve(); expect(recovered.collections).toHaveLength(1)
  } else { await expect(scan.next()).rejects.toThrow('cancelled'); release() }
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('an already cancelled call does not fetch or consume a candidate page', async () => {
  const f = fixture(); f.pages({ ids: [], more: false }); const scan = f.scan(), controller = new AbortController(); controller.abort(new Error('cancelled'))
  await expect(scan.next({ signal: controller.signal })).rejects.toThrow('cancelled'); expect(f.fetcher).not.toHaveBeenCalled()
  expect(await scan.next()).toMatchObject({ listingStatus: 'COMPLETE' })
})
it.each(['LISTINGS', 'COLLECTIONS'] as const)('cancellation at the accepted %s cursor handoff latches even a terminal page', async phase => {
  const f = fixture(), a = f.add(1, { listed: true }), controller = new AbortController()
  f.pages({ ids: [a.listingId], more: false }, { ids: [a.collectionId], more: false })
  const create = chainDiscovery.createChainObjectDiscovery
  let cancelled = false
  vi.spyOn(chainDiscovery, 'createChainObjectDiscovery').mockImplementation(options => {
    const scanner = create(options)
    return { next: async params => {
      const page = await scanner.next(params)
      if (!cancelled && options.scope.type.endsWith(phase === 'LISTINGS' ? '::CollectionListing' : '::SoulCollection')) {
        cancelled = true; controller.abort(new Error('handoff cancelled'))
      }
      return page
    } }
  })
  const scan = f.scan(); if (phase === 'COLLECTIONS') await scan.next()
  await expect(scan.next({ signal: controller.signal })).rejects.toThrow('handoff cancelled')
  const fetchCount = f.fetcher.mock.calls.length, result = await scan.next()
  expect(f.fetcher).toHaveBeenCalledTimes(fetchCount)
  expect(result).toMatchObject(phase === 'LISTINGS' ? { listingStatus: 'COMPLETE', verifiedListingCandidates: 1 }
    : { candidateStatus: 'COMPLETE', verifiedCollectionCandidates: 1 })
})
it('a missing Collection root is a retryable raw failure, not silently omitted from complete candidates', async () => {
  const f = fixture(), a = f.add(1), original = f.objects.get(a.collectionId)!
  f.pages({ ids: [], more: false }, { ids: [a.collectionId], more: false }); const scan = f.scan(); await scan.next()
  f.objects.delete(a.collectionId); await expect(scan.next()).rejects.toThrow('OBJECT_UNAVAILABLE')
  f.objects.set(a.collectionId, original); expect((await scan.next()).collections).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('an unavailable listing candidate is not equivalent to the explicitly permitted NOT_FOUND result', async () => {
  const f = fixture(); f.pages({ ids: [id(9999)], more: false }); const scan = f.scan()
  f.batch.mockResolvedValueOnce({ response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } })
  await expect(scan.next()).rejects.toThrow('OBJECT_UNAVAILABLE')
  expect(await scan.next()).toMatchObject({ listingStatus: 'COMPLETE', verifiedListingCandidates: 1 })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('raw timeout retains the accepted terminal candidate page for retry', async () => {
  const f = fixture(), a = f.add(1, { listed: true }); f.pages({ ids: [a.listingId], more: false }); const scan = f.scan()
  const timeout = new AbortController(), nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
  const controlled = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 40000 ? timeout.signal : nativeTimeout(ms))
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve })
  f.batch.mockImplementationOnce(async () => { entered(); return new Promise(() => {}) })
  const work = scan.next(), rejected = expect(work).rejects.toThrow('timed out'); await started
  timeout.abort(new DOMException('timed out', 'TimeoutError')); await rejected; controlled.mockRestore()
  expect(await scan.next()).toMatchObject({ verifiedListingCandidates: 1, listingStatus: 'COMPLETE' })
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
