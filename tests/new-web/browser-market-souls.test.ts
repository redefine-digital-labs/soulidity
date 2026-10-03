import { afterEach, expect, it, vi } from 'vitest'
import * as sdk from '@soulidity/sdk'
import * as custody from '../../web/lib/soulidity/browser-soul-custody'
import { createBrowserMarketSouls } from '../../web/lib/soulidity/browser-market-souls'
import { marketSoulRawFixture, marketSoulPageFixture, id, deferred } from './fixtures/browser-market-souls'

afterEach(() => vi.restoreAllMocks())
it('composes public GraphQL→raw State/Soul→actual detail/custody/listing without a per-item global scan', async () => {
  const f = marketSoulRawFixture(), scanner = createBrowserMarketSouls(f.params, { fetch: f.fetcher })
  const listings = await scanner.next()
  expect(listings).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'PARTIAL', source: null, verifiedListingCandidates: 1, verifiedSoulCandidates: 0 })
  const result = await scanner.next()
  expect(result).toMatchObject({ phase: 'SOULS', candidateStatus: 'COMPLETE', verifiedSoulCandidates: 1,
    readConsistency: 'NON_ATOMIC_CURRENT_READSET', notAuthorization: true })
  expect(result.souls[0]).toMatchObject({ onChainId: f.soul.id, viewerAddress: null, isOwner: false, chainListingStatus: 'LISTED',
    listingObjectOnChainId: f.listing.id, listedPriceAtomic: '1000000' })
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  expect(result.listingSource.checkpoint).toBe(100); expect(result.source?.checkpoint).toBe(101)
  await expect(scanner.next()).rejects.toThrow('SCAN_ENDED')
})
it.each([true, false])('actual Collection membership includes listed=%s independently of Right holder', async listed => {
  const f = marketSoulRawFixture(listed), collection = f.collection()
  const scanner = createBrowserMarketSouls({ ...f.params, selection: { kind: 'COLLECTION', collectionId: collection.value.id } }, { fetch: f.fetcher })
  await scanner.next(); const result = await scanner.next()
  expect(result.souls).toHaveLength(1)
  expect(result.souls[0]).toMatchObject({ collectionOnChainId: collection.value.id, currentOwnerAddress: f.state.current_owner,
    chainListingStatus: listed ? 'LISTED' : 'HELD', listingStatus: listed ? 'floor-violation' : 'unlisted',
    collection: { currentHolderAddress: collection.value.current_holder, floorPriceAtomic: '2000000', maxSoulSupply: '18446744073709551615' } })
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('does not impose a latest-12/latest-50 cutoff and freezes cumulative page snapshots', async () => {
  const f = await marketSoulPageFixture(61)
  f.soulPages.splice(0, 1, f.assets.slice(0, 50).map(a => a.stateId), f.assets.slice(50).map(a => a.stateId))
  const scanner = createBrowserMarketSouls(f.params, f.dependencies)
  await scanner.next(); const first = await scanner.next(), final = await scanner.next()
  expect(first).toMatchObject({ candidateStatus: 'PARTIAL', verifiedSoulCandidates: 50 })
  expect(final).toMatchObject({ candidateStatus: 'COMPLETE', verifiedSoulCandidates: 61 })
  expect(first.souls).toHaveLength(50); expect(final.souls).toHaveLength(61)
  expect(Object.isFrozen(first.souls[0])).toBe(true); expect(f.fetcher).toHaveBeenCalledTimes(3)
  expect(new Set(f.detail.mock.calls.map(([args]) => (args as any).listingScan)).size).toBe(1)
})
it.each(['MARKET', 'COLLECTION'] as const)('raw-verifies all candidates before %s selection and counts excluded candidates', async kind => {
  const f = await marketSoulPageFixture(3), collectionId = id(500)
  f.assets[0].listedIndividually = false; f.assets[0].collectionId = collectionId
  f.details[0].chainListingStatus = 'HELD'; f.details[0].collectionOnChainId = collectionId
  const scanner = createBrowserMarketSouls({ ...f.params, selection: kind === 'MARKET' ? { kind } : { kind, collectionId } }, f.dependencies)
  await scanner.next(); const result = await scanner.next()
  expect(result.verifiedSoulCandidates).toBe(3); expect(f.asset).toHaveBeenCalledTimes(3)
  expect(result.souls.map(s => s.onChainId)).toEqual(kind === 'MARKET' ? f.assets.slice(1).map(a => a.soulId) : [f.assets[0].soulId])
})
it('four-worker terminal page failure commits nothing and retries its accepted cursor', async () => {
  const f = await marketSoulPageFixture(9), gate = deferred<void>()
  const original = f.asset.getMockImplementation()!; let active = 0, peak = 0
  f.asset.mockImplementation(async args => { active++; peak = Math.max(peak, active); await gate.promise; active--; return original(args) })
  const scanner = createBrowserMarketSouls(f.params, f.dependencies); await scanner.next()
  f.detail.mockRejectedValueOnce(new Error('detail offline'))
  const failed = scanner.next(); await vi.waitFor(() => expect(f.asset).toHaveBeenCalledTimes(4)); gate.resolve()
  await expect(failed).rejects.toThrow('detail offline'); expect(peak).toBe(4)
  const result = await scanner.next()
  expect(result).toMatchObject({ candidateStatus: 'COMPLETE', verifiedSoulCandidates: 9 }); expect(result.souls).toHaveLength(9)
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('caller cancellation during raw State reads preserves the terminal pending page; lifetime invalidates later use', async () => {
  const f = await marketSoulPageFixture(), gate = deferred<Awaited<ReturnType<typeof f.asset>>>()
  f.asset.mockImplementationOnce(() => gate.promise)
  const scanner = createBrowserMarketSouls(f.params, f.dependencies); await scanner.next()
  const caller = new AbortController(), work = scanner.next({ signal: caller.signal })
  await vi.waitFor(() => expect(f.asset).toHaveBeenCalledTimes(1))
  await expect(scanner.next()).rejects.toThrow('BUSY'); caller.abort(new Error('caller cancelled'))
  await expect(work).rejects.toThrow('caller cancelled')
  const result = await scanner.next(); expect(result.souls).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
  gate.resolve(f.assets[0]); f.lifetime.abort(new Error('scope replaced'))
  await expect(scanner.next()).rejects.toThrow('scope replaced')
})
it('retries a failed second discovery page with the same cursor and checkpoint', async () => {
  const f = await marketSoulPageFixture(2); f.soulPages.splice(0, 1, [f.assets[0].stateId], [f.assets[1].stateId])
  const scanner = createBrowserMarketSouls(f.params, f.dependencies); await scanner.next(); await scanner.next()
  f.fetcher.mockRejectedValueOnce(new Error('network unavailable'))
  await expect(scanner.next()).rejects.toThrow('GraphQL discovery transport failed')
  const final = await scanner.next(); expect(final.souls).toHaveLength(2)
  const calls = f.fetcher.mock.calls.slice(-2).map(([, options]) => JSON.parse(String(options?.body)).variables)
  expect(calls[0]).toEqual(calls[1]); expect(calls[1]).toMatchObject({ after: 'c1', checkpoint: 101 })
})
it.each(['LISTINGS', 'SOULS'] as const)('reports %s LIMIT_REACHED honestly with verified counts', async phase => {
  const f = await marketSoulPageFixture(2)
  if (phase === 'LISTINGS') f.listingPages.splice(0, 1, [id(700)], [id(701)])
  else f.soulPages.splice(0, 1, [f.assets[0].stateId], [f.assets[1].stateId])
  const scanner = createBrowserMarketSouls(f.params, { ...f.dependencies, limits: { pageSize: 1, maxPages: 1, maxObjects: 2 } })
  let result = await scanner.next(); if (phase === 'SOULS') result = await scanner.next()
  expect(result).toMatchObject({ phase, candidateStatus: 'LIMIT_REACHED', verifiedListingCandidates: phase === 'LISTINGS' ? 1 : 0,
    verifiedSoulCandidates: phase === 'SOULS' ? 1 : 0 })
  expect(result.souls).toHaveLength(phase === 'SOULS' ? 1 : 0)
  if (phase === 'LISTINGS') expect(f.asset).not.toHaveBeenCalled()
  await expect(scanner.next()).rejects.toThrow('SCAN_ENDED')
})
it.each(['onChainId', 'stateOnChainId', 'stateVersion', 'stateDigest', 'creatorAddress', 'currentOwnerAddress', 'currentKioskId',
  'collectionOnChainId', 'viewerAddress', 'originalPackageId', 'chainListingStatus', 'isOwner', 'isCreator'] as const)(
  'rejects changed detail relation %s without committing the page', async key => {
    const f = await marketSoulPageFixture(), saved = structuredClone(f.details[0])
    Object.assign(f.details[0], { [key]: typeof saved[key] === 'boolean' ? !saved[key] : key === 'chainListingStatus' ? 'HELD' : id(900) })
    const scanner = createBrowserMarketSouls(f.params, f.dependencies); await scanner.next()
    await expect(scanner.next()).rejects.toThrow('CHANGED_RESTART')
    Object.assign(f.details[0], saved); expect((await scanner.next()).souls).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
it('rejects duplicate Soul identities even when all their States are filtered out', async () => {
  const f = await marketSoulPageFixture(2); f.assets[1].soulId = f.assets[0].soulId
  f.assets.forEach(a => { a.listedIndividually = false })
  const scanner = createBrowserMarketSouls(f.params, f.dependencies); await scanner.next()
  await expect(scanner.next()).rejects.toThrow('DUPLICATE_SOUL'); expect(f.detail).not.toHaveBeenCalled()
})
it('captures configuration, viewer and selection at scanner creation', async () => {
  const f = await marketSoulPageFixture(), selection = { kind: 'COLLECTION' as const, collectionId: id(900) }
  f.assets[0].collectionId = selection.collectionId; f.details[0].collectionOnChainId = selection.collectionId
  const scanner = createBrowserMarketSouls({ ...f.params, selection }, f.dependencies)
  selection.collectionId = id(901); f.params.viewerAddress = null; f.config.native.soulidityOriginalPackageId = id(902)
  await scanner.next(); expect((await scanner.next()).souls).toHaveLength(1)
})
it.each(['vanished', 'repriced', 'inactive'] as const)('actual listed State with %s pre-scanned Listing fails instead of showing empty Market', async change => {
  const f = marketSoulRawFixture(), scanner = createBrowserMarketSouls(f.params, { fetch: f.fetcher }); await scanner.next()
  if (change === 'vanished') f.rows.delete(f.listing.id)
  else { if (change === 'repriced') f.listing.price = '3000000'; else f.listing.is_active = false; f.putListing() }
  await expect(scanner.next()).rejects.toThrow('CHANGED_RETRY'); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('actual held Souls are excluded from Market but raw object failures cannot be hidden as an empty result', async () => {
  const f = marketSoulRawFixture(false), scanner = createBrowserMarketSouls(f.params, { fetch: f.fetcher })
  await scanner.next(); const saved = f.rows.get(f.state.id); f.rows.delete(f.state.id)
  await expect(scanner.next()).rejects.toThrow(); f.rows.set(f.state.id, saved)
  const result = await scanner.next(); expect(result.souls).toEqual([]); expect(result.verifiedSoulCandidates).toBe(1)
})
it.each(['LISTINGS', 'SOULS'] as const)('retains %s discovery cursor accepted exactly as caller cancellation wins the handoff', async phase => {
  const f = await marketSoulPageFixture(), caller = new AbortController(), original = sdk.createChainObjectDiscovery
  let cancelled = false
  vi.spyOn(sdk, 'createChainObjectDiscovery').mockImplementation(options => {
    const reader = original(options)
    return { async next(args) { const page = await reader.next(args)
      if (!cancelled && options.scope.type.endsWith(phase === 'LISTINGS' ? '::SoulListing' : '::SoulState')) {
        cancelled = true; caller.abort(new Error('cursor handoff cancelled'))
      }
      return page
    } }
  })
  const scanner = createBrowserMarketSouls(f.params, f.dependencies)
  if (phase === 'SOULS') await scanner.next()
  await expect(scanner.next({ signal: caller.signal })).rejects.toThrow('cursor handoff cancelled')
  let result = await scanner.next(); if (phase === 'LISTINGS') result = await scanner.next()
  expect(result.souls).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it('retains a completed opaque Listing token when cancellation wins its outer phase handoff', async () => {
  const f = await marketSoulPageFixture(), caller = new AbortController(), original = custody.createBrowserSoulListingDiscovery
  vi.spyOn(custody, 'createBrowserSoulListingDiscovery').mockImplementation((params, deps) => {
    const reader = original(params, deps)
    return { async next(args) { const page = await reader.next(args); caller.abort(new Error('listing phase handoff cancelled')); return page } }
  })
  const scanner = createBrowserMarketSouls(f.params, f.dependencies)
  await expect(scanner.next({ signal: caller.signal })).rejects.toThrow('listing phase handoff cancelled')
  expect(await scanner.next()).toMatchObject({ phase: 'LISTINGS', candidateStatus: 'PARTIAL' })
  expect((await scanner.next()).souls).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it.each(['LISTINGS', 'SOULS'] as const)('whole-page deadline bounds uncooperative %s raw reads and allows the same-page retry', async phase => {
  const f = await marketSoulPageFixture(), timeout = new AbortController(), original = AbortSignal.timeout
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 120000 ? timeout.signal : original(ms))
  if (phase === 'LISTINGS') { f.listingPages[0] = [id(800)]; f.batch.mockImplementationOnce(() => new Promise(() => {}) as any) }
  else f.asset.mockImplementationOnce(() => new Promise(() => {}))
  const scanner = createBrowserMarketSouls(f.params, f.dependencies); if (phase === 'SOULS') await scanner.next()
  const work = scanner.next(), failed = expect(work).rejects.toThrow('whole page deadline')
  await vi.waitFor(() => expect(phase === 'LISTINGS' ? f.batch : f.asset).toHaveBeenCalled())
  timeout.abort(new Error('whole page deadline')); await failed
  vi.mocked(AbortSignal.timeout).mockImplementation(ms => original(ms))
  let result = await scanner.next(); if (phase === 'LISTINGS') result = await scanner.next()
  expect(result.souls).toHaveLength(1); expect(f.fetcher).toHaveBeenCalledTimes(2)
})
it.each(['checkpoint', 'duplicate'] as const)('does not accept a later malformed %s State discovery page', async fault => {
  const f = await marketSoulPageFixture(2); f.soulPages.splice(0, 1, [f.assets[0].stateId], [f.assets[1].stateId])
  const scanner = createBrowserMarketSouls(f.params, f.dependencies); await scanner.next(); const first = await scanner.next()
  if (fault === 'checkpoint') f.checkpoints.souls++
  else f.soulPages[1] = [f.assets[0].stateId]
  await expect(scanner.next()).rejects.toThrow(fault === 'checkpoint' ? 'changed the scan checkpoint' : 'repeated an object')
  expect(first.souls).toHaveLength(1); expect(f.asset).toHaveBeenCalledTimes(1)
  f.checkpoints.souls = 101; f.soulPages[1] = [f.assets[1].stateId]
  expect((await scanner.next()).souls).toHaveLength(2)
})
