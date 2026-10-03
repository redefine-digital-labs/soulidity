import { afterEach, expect, it, vi } from 'vitest'
import { composeChainSoulDetail, chainDateIso, compareChainInteger, formatChainTimestamp } from '../../web/lib/soulidity/soul-detail-model'
import { readBrowserSoulDetail } from '../../web/lib/soulidity/browser-soul-detail'
import { contentEnvelopeKey, encodeContentEnvelope } from '../../web/lib/soulidity/content-envelope'
import { contentEnvelopeFixture } from './fixtures/content-envelope'
import { SoulPublicMarketConfigBcs } from '../../packages/soulidity-sdk/src/soul-public-listing'
import { browserSoulDetailFixture, createBrowserSoulDetailModel as modelFixture, detailId as id, detailDigest as digest } from './fixtures/browser-soul-detail-fixture'

afterEach(() => { vi.unstubAllGlobals() })
async function serviceFixture() {
  const { f, input } = await modelFixture()
  const dependencies = {
    client: vi.fn(() => f.client), asset: vi.fn(async () => structuredClone(input.asset)),
    state: vi.fn(async () => structuredClone(input.state)),
    custody: vi.fn(async () => ({ listingId: f.listing.id, personalKioskCapId: id(76), stateVersion: '1', stateDigest: digest })),
    nativeListing: vi.fn(async () => undefined), listing: vi.fn(async () => structuredClone(input.listing)),
  }
  const params = { soulId: f.soul.id, viewerAddress: f.state.current_owner, config: f.config }
  return { f, input, dependencies, params, read: () => readBrowserSoulDetail(params, dependencies) }
}

it('ordinary compose preserves typed chain observations and has no retired SQL identity/history/price guesses', async () => {
  const { input, compose } = await modelFixture(), result = compose()
  expect(result).toMatchObject({ onChainId: input.asset.soulId, stateOnChainId: input.asset.stateId,
    contentOnChainId: input.asset.contentId, currentKioskCapOnChainId: id(76), currentOwnershipEpoch: '2',
    isOwner: true, isCreator: false, notAuthorization: true, observedAtMs: '1000', activeSpriteVersionIndex: '0',
    listingObjectOnChainId: id(70), listedPriceAtomic: '1000000' })
  expect(result.paidAccessKindConfigs[0].priceAtomic).toBe('9007199254740993')
  expect(result.paidAccessKindConfigs[0].durationMs).toBe('0')
  expect(result.contentVersions).toHaveLength(3); expect(result.activeGrants).toHaveLength(1)
  expect(result.unavailable).toEqual(input.state.unavailable)
  for (const field of ['id', 'updatedAt', 'grantHistory', 'readme', 'memberId']) expect(result).not.toHaveProperty(field)
  for (const row of result.paidAccessEntries) {
    for (const field of ['price', 'priceAtomic', 'createdAt', 'createdAtMs', 'purchasedAt']) expect(row).not.toHaveProperty(field)
  }
  expect(Object.isFrozen(result.contentVersions[0])).toBe(true)
  // Deliberately bypass the readonly type to test isolation from caller mutation.
  ;(input.asset.publicPreview.tags as string[]).push('mutated'); expect(result.tags).not.toContain('mutated')
})
it('u64 epochs, capacities, supply, prices and out-of-calendar times are lossless strings', async () => {
  const { input, compose } = await modelFixture(), max = '18446744073709551615', precise = '9007199254740993'
  input.asset.ownershipEpoch = precise; input.state.ownershipEpoch = precise
  input.state.grantCapacity = max; input.state.activeGrantCount = precise
  input.asset.createdAtMs = max; input.state.contentVersions[0].slot.created_at_ms = max
  input.state.grants[0].slot.expires_at_ms = max; input.state.grants[0].slot.ownership_epoch_snapshot = precise
  input.state.paidAccessKindConfigs[0].config.price_atomic = max
  input.state.paidAccessKindConfigs[0].config.duration_ms = max
  input.state.paidAccessEntries[0].entry.expires_at_ms = max
  input.listing.price = precise; input.listing.quote!.totalPayment = max
  const result = compose()
  expect(result.currentOwnershipEpoch).toBe(precise); expect(result.grantCapacity).toBe(max); expect(result.activeGrantCount).toBe(precise)
  expect(result.createdAtMs).toBe(max); expect(result.createdAt).toBeNull()
  expect(result.contentVersions[0]).toMatchObject({ createdAtMs: max, createdAt: null })
  expect(result.activeGrants[0]).toMatchObject({ expiresAtMs: max, expiresAt: null, ownershipEpochSnapshot: precise })
  expect(result.paidAccessKindConfigs[0]).toMatchObject({ priceAtomic: max, durationMs: max })
  expect(result.paidAccessEntries[0].expiresAtMs).toBe(max)
  expect(result.quote).toMatchObject({ priceAtomic: precise, totalAtomic: max })
})
it.each([false, true])('collection raw display/supply are lossless and below-floor=%s never claims chain delisting', async belowFloor => {
  const { input, compose } = await modelFixture()
  input.asset.collectionId = id(90)
  input.listing.collection = { id: id(90), rightId: id(91), creator: input.asset.creator, currentHolder: id(92),
    holderKioskId: id(93), name: '系列 🌙', description: 'Original\nDescription', imageUrl: 'walrus://collection',
    maxSupply: '18446744073709551615', currentSupply: '9007199254740993', extraRoyaltyBps: 100,
    rightTradeable: false, floor: { status: 'VERIFIED', floorPriceAtomic: '99999999999999999999', belowFloor } }
  const result = compose()
  expect(result.collection).toEqual({ onChainId: id(90), rightOnChainId: id(91), name: '系列 🌙', description: 'Original\nDescription',
    imageUrl: 'walrus://collection', creatorAddress: input.asset.creator, currentHolderAddress: id(92), currentHolderKioskId: id(93),
    extraRoyaltyBps: 100, tradeable: false, floorPriceAtomic: '99999999999999999999', belowFloor,
    maxSoulSupply: '18446744073709551615', currentSoulSupply: '9007199254740993' })
  expect(result.chainListingStatus).toBe('LISTED'); expect(result.listingStatus).toBe(belowFloor ? 'floor-violation' : 'listed')
  expect(result.listingObjectOnChainId).toBe(id(70)); expect(result.listedPriceAtomic).toBe('1000000')
  expect(result.quote).not.toBeNull()
})
it('held collection has no invented quote, preserves null unlimited supply and zero floor', async () => {
  const { input, compose } = await modelFixture(false)
  input.asset.collectionId = id(90)
  input.listing.collection = { id: id(90), rightId: id(91), creator: input.asset.creator, currentHolder: id(92),
    holderKioskId: id(93), name: '', description: '', imageUrl: '', maxSupply: null, currentSupply: '1',
    extraRoyaltyBps: 0, rightTradeable: false, floor: { status: 'VERIFIED', floorPriceAtomic: '0', belowFloor: null } }
  const result = compose(); expect(result.collection).toMatchObject({ maxSoulSupply: null, floorPriceAtomic: '0', belowFloor: null })
  expect(result.chainListingStatus).toBe('HELD'); expect(result.listingStatus).toBe('unlisted'); expect(result.quote).toBeNull()
})
it.each([null, 0, 300])('source royalty %s remains distinct instead of truthy/falsy defaults', async sourceRoyaltyBps => {
  const { input, compose } = await modelFixture(); input.listing.sourceRoyaltyBps = sourceRoyaltyBps
  expect(compose().sourceRoyaltyBps).toBe(sourceRoyaltyBps); expect(compose().quote?.makerRoyaltyBps).toBe(sourceRoyaltyBps)
})
it.each([true, false, null])('native fee policy %s controls checkout but not observed gross price or royalties', async matches => {
  const { input, compose } = await modelFixture()
  input.asset.provenanceKind = 3; input.listing.sourceRoyaltyBps = 250
  input.listing.market.nativeFeePolicyMatches = matches
  input.listing.quote = { model: 'GROSS_INCLUSIVE', platformFee: '25000', creatorRoyalty: '50000',
    collectionRoyalty: '0', makerSourceRoyalty: '25000', totalPayment: '1000000' }
  const result = compose()
  expect(result.purchaseAvailable).toBe(matches === true)
  expect(result).toMatchObject({ sourceRoyaltyBps: 250, chainListingStatus: 'LISTED', listedPriceAtomic: '1000000',
    quote: { model: 'GROSS_INCLUSIVE', totalAtomic: '1000000', makerRoyaltyBps: 250, makerSourceRoyaltyAtomic: '25000' } })
})
it.each([['0', '1970-01-01T00:00:00.000Z'], ['8640000000000000', '+275760-09-13T00:00:00.000Z'], ['8640000000000001', null]])('exact chain date %s uses calendar limits, not numeric rounding', (ms, iso) => {
  expect(chainDateIso(ms!)).toBe(iso)
})
it.each(['-1', '01', '1.5', '18446744073709551616', 'NaN'])('invalid chain timestamp %s fails visibly', value => {
  expect(() => chainDateIso(value)).toThrow('SOUL_DETAIL_DATE_INVALID')
})
it('chain sorting and unavailable date formatting do not force a Date or lossy Number', () => {
  expect(compareChainInteger('9007199254740993', '9007199254740992')).toBe(1)
  expect(compareChainInteger('18446744073709551615', '18446744073709551615')).toBe(0)
  expect(formatChainTimestamp(null)).toMatch(/not recorded/i)
  expect(formatChainTimestamp('18446744073709551615')).toContain('18446744073709551615 ms')
})
it('deleted and purged booleans survive without fabricated deletion times or filtering', async () => {
  const { input, compose } = await modelFixture()
  input.state.contentVersions[1].slot.deleted = true
  input.state.contentVersions[2].slot.deleted = true; input.state.contentVersions[2].slot.purged = true
  const result = compose(); expect(result.contentVersions).toHaveLength(3)
  expect(result.contentVersions[1]).toMatchObject({ deleted: true, purged: false })
  expect(result.contentVersions[2]).toMatchObject({ deleted: true, purged: true })
  for (const row of result.contentVersions) { expect(row).not.toHaveProperty('deletedAt'); expect(row).not.toHaveProperty('purgedAt') }
})
it.each([[true, true, 'active'], [true, false, 'expired'], [false, true, 'invalidated']])('grant observation current=%s/unexpired=%s preserves %s status', async (current, unexpired, status) => {
  const { input, compose } = await modelFixture()
  input.currentKioskCapId = null; input.viewerAddress = input.state.grants[0].slot.grantee
  input.state.grants[0].currentEpoch = current as boolean; input.state.grants[0].unexpiredAtObservation = unexpired as boolean
  if (!current) input.state.grants[0].grant = null
  const result = compose(); expect(result.activeGrants[0].status).toBe(status)
  expect(result.isGrantedAgent).toBe(status === 'active')
  if (!current) expect(result.activeGrants[0].issuedByAddress).toBeNull()
})
it.each(['soulId', 'stateId', 'stateVersion', 'stateDigest', 'currentOwner', 'creator'])('detail and listing %s cannot be joined across asset snapshots', async key => {
  for (const source of ['state', 'listing'] as const) {
    const { input, compose } = await modelFixture(); (input[source] as any)[key] = key === 'stateVersion' ? '2' : id(99)
    expect(compose).toThrow('SOUL_DETAIL_SNAPSHOT_MISMATCH')
  }
})
it.each(['content', 'epoch', 'kiosk', 'listed', 'collection', 'visitor-cap'])('compose rejects cross-snapshot %s mismatch', async key => {
  const { input, compose } = await modelFixture()
  if (key === 'content') input.state.contentId = id(99)
  if (key === 'epoch') input.state.ownershipEpoch = '3'
  if (key === 'kiosk') input.listing.kioskId = id(99)
  if (key === 'listed') input.asset.listedIndividually = false
  if (key === 'collection') input.asset.collectionId = id(99)
  if (key === 'visitor-cap') input.viewerAddress = id(99)
  expect(compose).toThrow('SOUL_DETAIL_SNAPSHOT_MISMATCH')
})
it('missing envelopes remain pending evidence, never an invented sidecar', async () => {
  const { compose } = await modelFixture()
  expect(compose().contentVersions.every(row => row.envelopeStatus === 'MISSING' && row.sealSidecar === null)).toBe(true)
})
it('present envelope uses the actual encrypted-object codec and exact full content tuple', async () => {
  const { input, compose } = await modelFixture(), envelope = contentEnvelopeFixture()
  input.originalPackageId = id(6)
  const text = encodeContentEnvelope(envelope, id(6))
  input.state.config.push({ key: contentEnvelopeKey(envelope), valueBytes: [...new TextEncoder().encode(text)], valueUtf8: text })
  expect(compose().contentVersions[0]).toMatchObject({ envelopeStatus: 'VERIFIED', sealSidecar: envelope.sidecar })
  expect(compose().contentVersions[1].envelopeStatus).toBe('MISSING')
})
it.each(['private-key', 'wrong-blob', 'wrong-package', 'malformed', 'noncanonical', 'invalid-utf8', 'duplicate-key'])('present but %s envelope fails, never downgraded to missing', async key => {
  const { input, compose } = await modelFixture(), envelope = contentEnvelopeFixture()
  input.originalPackageId = id(6)
  let text: string | null = encodeContentEnvelope(envelope, id(6))
  if (key === 'private-key') { const bad = JSON.parse(text); bad.sidecar.dek = 'PRIVATE'; text = JSON.stringify(bad) }
  if (key === 'wrong-blob') { const bad = JSON.parse(text); bad.blobObjectId = id(99); text = JSON.stringify(bad) }
  if (key === 'wrong-package') input.originalPackageId = id(99)
  if (key === 'malformed') text = '{}'
  if (key === 'noncanonical') text += '\n'
  if (key === 'invalid-utf8') text = null
  const row = { key: contentEnvelopeKey(envelope), valueBytes: [], valueUtf8: text }; input.state.config.push(row)
  if (key === 'duplicate-key') input.state.config.push(row)
  expect(compose).toThrow()
})

it('service propagates exact State references, viewer scope, discovered IDs and a shared abort signal', async () => {
  const f = await serviceFixture(), result = await f.read()
  expect(result.onChainId).toBe(f.f.soul.id); expect(f.dependencies.asset).toHaveBeenCalledTimes(2)
  expect(f.dependencies.state).toHaveBeenCalledWith(expect.objectContaining({ stateId: f.input.asset.stateId,
    expectedState: { version: '1', digest }, viewerAddresses: [f.input.asset.currentOwner] }))
  expect(f.dependencies.custody).toHaveBeenCalledWith(expect.objectContaining({ snapshot: f.input.asset,
    viewer: f.input.asset.currentOwner, discovery: { endpoint: f.f.config.discoveryEndpoint, pageSize: 50, maxPages: 40, maxObjects: 2000 } }))
  expect(f.dependencies.listing).toHaveBeenCalledWith(expect.objectContaining({ listingId: f.f.listing.id,
    expectedState: { version: '1', digest }, stateId: f.f.state.id }))
  const signal = (f.dependencies.asset.mock.calls[0] as any)[0].signal
  for (const spy of [f.dependencies.state, f.dependencies.custody, f.dependencies.listing]) expect((spy.mock.calls[0] as any)[0].signal).toBe(signal)
})
it.each(['asset', 'state', 'custody', 'nativeListing', 'listing'])('service %s failure is retained, never []/unlisted/empty fallback', async key => {
  const f = await serviceFixture(), error = new Error(`actual ${key} unavailable`)
  ;(f.dependencies[key as keyof typeof f.dependencies] as any).mockRejectedValueOnce(error)
  await expect(f.read()).rejects.toBe(error)
})
it.each(['name', 'stateVersion', 'currentOwner', 'publicPreview'])('final public reread %s drift fails the whole composition', async key => {
  const f = await serviceFixture(), changed = structuredClone(f.input.asset)
  if (key === 'name') changed.name += '!'
  if (key === 'stateVersion') changed.stateVersion = '2'
  if (key === 'currentOwner') changed.currentOwner = id(99)
  if (key === 'publicPreview') (changed.publicPreview.tags as string[]).push('new')
  f.dependencies.asset.mockResolvedValueOnce(f.input.asset).mockResolvedValueOnce(changed)
  await expect(f.read()).rejects.toThrow('SOUL_DETAIL_CHANGED_RETRY')
})
it('custody reference drift is rejected before the listing reader', async () => {
  const f = await serviceFixture(); f.dependencies.custody.mockResolvedValueOnce({ listingId: id(70), personalKioskCapId: id(76), stateVersion: '2', stateDigest: digest })
  await expect(f.read()).rejects.toThrow('SOUL_DETAIL_CUSTODY_CHANGED'); expect(f.dependencies.listing).not.toHaveBeenCalled()
})
it.each(['before', 'after-asset', 'after-components', 'after-final'])('wallet switch %s cannot publish old owner scope or cap', async phase => {
  const f = await serviceFixture(); let viewer = f.params.viewerAddress
  if (phase === 'before') viewer = id(99)
  if (phase === 'after-asset') f.dependencies.asset.mockImplementationOnce(async () => { viewer = id(99); return f.input.asset })
  if (phase === 'after-components') f.dependencies.state.mockImplementationOnce(async () => { viewer = id(99); return f.input.state })
  if (phase === 'after-final') f.dependencies.asset.mockResolvedValueOnce(f.input.asset).mockImplementationOnce(async () => { viewer = id(99); return f.input.asset })
  await expect(readBrowserSoulDetail({ ...f.params, getViewerAddress: () => viewer }, f.dependencies)).rejects.toThrow('SOUL_DETAIL_VIEWER_CHANGED')
})
it('service cancellation bounds a noncompliant component promise and prevents later listing/final reads', async () => {
  const f = await serviceFixture(); let resolve!: (value: typeof f.input.state) => void
  f.dependencies.state.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const controller = new AbortController(), promise = readBrowserSoulDetail({ ...f.params, signal: controller.signal }, f.dependencies)
  await vi.waitFor(() => expect(f.dependencies.state).toHaveBeenCalledTimes(1)); controller.abort(new Error('cancelled'))
  await expect(promise).rejects.toThrow('cancelled'); resolve(f.input.state); await Promise.resolve()
  expect(f.dependencies.listing).not.toHaveBeenCalled(); expect(f.dependencies.asset).toHaveBeenCalledTimes(1)
})
it('service snapshots release fields before awaiting and no later input mutation redirects a reader', async () => {
  const f = await serviceFixture(); const promise = f.read(); f.params.config.marketConfigId = id(99); f.params.config.kindRegistryId = id(98)
  await promise
  expect(f.dependencies.listing).toHaveBeenCalledWith(expect.objectContaining({ deployment: expect.objectContaining({ marketConfigId: id(72) }) }))
  expect(f.dependencies.state).toHaveBeenCalledWith(expect.objectContaining({ deployment: expect.objectContaining({ kindRegistryId: id(30) }) }))
})

it('integrated ordinary deep link uses every actual raw reader from immutable Soul pointer to composed listed owner detail', async () => {
  const f = browserSoulDetailFixture(); vi.stubGlobal('fetch', f.fetcher)
  const result = await readBrowserSoulDetail({ soulId: f.soul.id, viewerAddress: f.state.current_owner,
    getViewerAddress: () => f.state.current_owner, config: f.config }, { client: () => f.client })
  expect(result).toMatchObject({ onChainId: f.soul.id, stateOnChainId: f.state.id, name: f.soul.name,
    currentKioskCapOnChainId: id(76), listedPriceAtomic: '1000000', listingObjectOnChainId: f.listing.id,
    quote: { model: 'BASE_PLUS_FEES', platformFeeAtomic: '25000', creatorRoyaltyAtomic: '50000', totalAtomic: '1075000' },
    purchaseAvailable: true, isOwner: true, paidEntriesScope: 'ALL_BUYERS' })
  expect(result.contentVersions).toHaveLength(3); expect(result.activeGrants[0].onChainId).toBe(f.grant.id)
  expect(result.paidAccessEntries[0].buyerAddress).toBe(f.grant.grantee)
  expect(result.paidAccessKindConfigs[0].priceAtomic).toBe('9007199254740993')
  expect(f.get.mock.calls[0][0].objectId).toBe(f.pointerId)
  expect(f.list).toHaveBeenCalled(); expect(f.batch).toHaveBeenCalled(); expect(f.fetcher).toHaveBeenCalledTimes(1)
  expect(f.batch.mock.calls.some(([args]) => args.requests?.[0]?.objectId === id(76))).toBe(true)
  expect(f.get.mock.calls.filter(([args]) => args.objectId === f.pointerId)).toHaveLength(4)
})
it('integrated held visitor uses exact viewers-only scope without GraphQL or owner cap reads', async () => {
  const f = browserSoulDetailFixture(false); vi.stubGlobal('fetch', f.fetcher)
  const result = await readBrowserSoulDetail({ soulId: f.soul.id, viewerAddress: null, config: { ...f.config, discoveryEndpoint: null } }, { client: () => f.client })
  expect(result).toMatchObject({ currentKioskCapOnChainId: null, listingObjectOnChainId: null, listedPriceAtomic: null,
    quote: null, isOwner: false, paidEntriesScope: 'VIEWER_ADDRESSES_ONLY', paidAccessEntries: [] })
  expect(f.fetcher).not.toHaveBeenCalled()
  expect(f.batch.mock.calls.some(([args]) => args.requests?.[0]?.objectId === id(76))).toBe(false)
})
it('integrated paused secondary market retains the actual listing price and additive quote without offering checkout', async () => {
  const f = browserSoulDetailFixture(); vi.stubGlobal('fetch', f.fetcher)
  f.put(f.config.marketConfigId, `${f.config.native.soulidityOriginalPackageId}::market::MarketConfigV2`,
    SoulPublicMarketConfigBcs.serialize({ id: f.config.marketConfigId, version: '2', legacy_config_id: id(0),
      fee_recipient: id(75), platform_fee_bps: 250, primary_enabled: true, secondary_enabled: false }).toBytes())
  const result = await readBrowserSoulDetail({ soulId: f.soul.id, viewerAddress: null, config: f.config }, { client: () => f.client })
  expect(result).toMatchObject({ purchaseAvailable: false, chainListingStatus: 'LISTED', listedPriceAtomic: '1000000',
    quote: { model: 'BASE_PLUS_FEES', platformFeeAtomic: '25000', creatorRoyaltyAtomic: '50000', totalAtomic: '1075000' } })
})
it('integrated missing current grant object does not silently disappear from detail', async () => {
  const f = browserSoulDetailFixture(); vi.stubGlobal('fetch', f.fetcher); f.rows.delete(f.grant.id)
  await expect(readBrowserSoulDetail({ soulId: f.soul.id, viewerAddress: f.state.current_owner, config: f.config }, { client: () => f.client })).rejects.toThrow('OBJECT_UNAVAILABLE')
})
