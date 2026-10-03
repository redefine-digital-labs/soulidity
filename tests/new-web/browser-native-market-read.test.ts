import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { getBrowserNativeMarketCancelConfig, getBrowserNativeMarketConfig, readBrowserNativeMarketBuy,
  readBrowserNativeMarketCancel, readBrowserNativeMarketList } from '../../web/lib/animacraft/browser-native-market-read'
import { nativeMarketBuyFixture, bid as id, capOrigin } from './fixtures/native-market-buy'
import { nativeMarketListFixture } from './fixtures/native-market-list'
import { NativeMarketConfigBcs, NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { NativeBuyPolicyBcs } from '../../web/lib/animacraft/native-market-buy-snapshot'
import { NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { NativeCancelPersonalKioskCapBcs } from '../../web/lib/animacraft/native-market-cancel-snapshot'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function env(f = nativeMarketBuyFixture()) {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: f.target.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: f.target.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(f.target),
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: f.target.soulidityOriginalPackageId,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: f.config.marketConfigV2Id,
    NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: f.config.kioskRegistryId,
    NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: f.config.soulTransferPolicyId,
    NEXT_PUBLIC_KIOSK_PACKAGE_ID: f.config.kioskPackageId,
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: f.config.paymentCoinType,
  })) vi.stubEnv(key, value)
  return f
}
function fixture(mode: 'buy' | 'list' | 'cancel', listed = mode !== 'list') {
  const f = nativeMarketListFixture(listed)
  const factory = vi.fn((_signal: AbortSignal) => f.client)
  const config = { target: f.target, buyTarget: f.config }
  const input = { soulId: id(12), stateId: id(14), listingId: id(33), config }
  const read = (signal?: AbortSignal) => mode === 'buy'
    ? readBrowserNativeMarketBuy({ ...input, buyer: id(50), signal }, { client: factory })
    : mode === 'list' ? readBrowserNativeMarketList({ ...input, kioskCapId: id(70), signal }, { client: factory })
      : readBrowserNativeMarketCancel({ ...input, config: { target: config.target }, kioskCapId: id(70), signal }, { client: factory })
  // Buy has a different public lookup owner from the seller. Existing cap
  // discovery fixture pages are replaced by this buyer's actual registration.
  if (mode === 'buy') {
    f.pages[0] = []
    const buy = f as ReturnType<typeof nativeMarketListFixture>
    // This helper's register is the seller registration; buyer with no cap is
    // a valid explicit CREATE readiness result, not a fabricated holding.
    expect(buy.buyer).toBe(id(50))
  }
  return { ...f, input, config, factory, read }
}

it('loads only explicit public configuration and freezes the complete captured tuple', () => {
  const f = env(), config = getBrowserNativeMarketConfig()
  expect(config).toEqual({ target: f.target, buyTarget: f.config })
  expect(Object.isFrozen(config) && Object.isFrozen(config.target.expectedNativeBinding) && Object.isFrozen(config.buyTarget)).toBe(true)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', id(99))
  expect(config.buyTarget.marketConfigV2Id).toBe(id(30))
})
it.each(['NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE'])('fails closed for missing %s', key => {
  env(); vi.stubEnv(key, '')
  vi.stubEnv('ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(nativeMarketBuyFixture().target))
  expect(() => getBrowserNativeMarketConfig()).toThrow()
})
it('rejects wrong network/package/payment configuration', () => {
  env(); vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'testnet'); expect(() => getBrowserNativeMarketConfig()).toThrow()
  env(); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID', id(99)); expect(() => getBrowserNativeMarketConfig()).toThrow()
  env(); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE', '0x2::sui::SUI'); expect(() => getBrowserNativeMarketConfig()).toThrow()
})
it('cancel configuration does not depend on Buy-only policy/currency/config fields', () => {
  const f = env()
  for (const key of ['NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
    'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
    'NEXT_PUBLIC_KIOSK_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE']) vi.stubEnv(key, '')
  expect(getBrowserNativeMarketCancelConfig()).toEqual({ target: f.target })
  expect(() => getBrowserNativeMarketConfig()).toThrow()
})

it.each(['buy', 'list', 'cancel'] as const)('%s invokes actual raw readers without HTTP API or SQL', async mode => {
  const f = fixture(mode), fetcher = vi.fn(() => { throw new Error('No owned API permitted') })
  vi.stubGlobal('fetch', fetcher)
  expect(await f.read()).toMatchObject({ schema: `native-market-${mode}-v1`, soulId: id(12), stateId: id(14),
    release: { writesEnabled: false, soulidityCallablePackageId: id(5) } })
  expect(f.factory).toHaveBeenCalledOnce(); expect(f.factory.mock.calls[0]).toEqual([expect.any(AbortSignal)])
  expect(fetcher).not.toHaveBeenCalled()
  const source = readFileSync('web/lib/animacraft/browser-native-market-read.ts', 'utf8')
  expect(source).not.toContain('/api/'); expect(source).not.toContain('repository'); expect(source).not.toContain('listOwnedPersonalKioskCaps')
})
it('returns exact buyer readiness, including CREATE when actual cap discovery is empty', async () => {
  const f = fixture('buy')
  expect(await f.read()).toMatchObject({ buyer: id(50), buyerKioskId: null, buyerKioskCapId: null,
    listingId: id(33), priceAtomic: '10001', purchaseAvailable: true })
})
it('preserves held list and exact active reprice facts without guessing a new listing', async () => {
  const held = fixture('list')
  expect(await held.read()).toMatchObject({ listed: false, listingId: null, listAvailable: true, repriceAvailable: false })
  const listed = fixture('list', true)
  expect(await listed.read()).toMatchObject({ listed: true, listingId: id(33), kioskCapId: id(70), repriceAvailable: true })
})
it.each(['buy', 'list'] as const)('%s retains paused/wrong-fee facts without enabling actions', async mode => {
  const f = fixture(mode, true)
  f.edit(id(30), NativeMarketConfigBcs, row => { row.secondary_enabled = false; row.platform_fee_bps = 251 })
  const snapshot = await f.read()
  expect(snapshot).toMatchObject(mode === 'buy' ? { purchaseAvailable: false } : { listAvailable: false, repriceAvailable: false })
})
it('cancel reads a saved inactive listing even when a later listing is current; no fee/policy read occurs', async () => {
  const f = fixture('cancel')
  f.edit(id(33), NativeMarketListingBcs, row => { row.is_active = false; row.purchase_cap = null; row.seller = id(99) })
  for (const objectId of [id(30), id(31), id(32), id(44)]) f.objects.delete(objectId)
  expect(await f.read()).toMatchObject({ listingId: id(33), listed: true, listingActive: false, kioskCapId: id(70) })
  expect(f.calls.some(row => [id(30), id(31), id(32), id(44)].includes(row.objectId))).toBe(false)
})
it('cancel preserves a completed cancellation with no current listing', async () => {
  const f = fixture('cancel')
  f.edit(id(33), NativeMarketListingBcs, row => { row.is_active = false; row.purchase_cap = null })
  f.edit(id(14), NativeSoulStateBcs, row => { row.is_listed = false })
  expect(await f.read()).toMatchObject({ listed: false, listingActive: false, listingId: id(33) })
})
it.each(['buy', 'list', 'cancel'] as const)('%s does not replace a provided foreign listing hint', async mode => {
  const f = fixture(mode, true); f.input.listingId = id(99)
  await expect(f.read()).rejects.toThrow()
  expect(f.calls.some(row => row.objectId === id(99))).toBe(true)
})
it.each(['list', 'cancel'] as const)('%s does not replace a saved cap that controls another Kiosk', async mode => {
  const f = fixture(mode)
  f.edit(id(70), NativeCancelPersonalKioskCapBcs, cap => { cap.cap.for = id(99) })
  await expect(f.read()).rejects.toThrow()
})
it.each(['buy', 'list', 'cancel'] as const)('%s rejects wrong Soul/State/release identity', async mode => {
  const f = fixture(mode)
  f.edit(id(14), NativeSoulStateBcs, state => { state.soul_id = id(99) })
  await expect(f.read()).rejects.toThrow()
  const g = fixture(mode); g.target.soulidityCallableDigest = g.target.outputCallableDigest.replace(/^./, '1')
  await expect(g.read()).rejects.toThrow()
})
it.each(['buy', 'list'] as const)('%s preserves exact policy failures', async mode => {
  const f = fixture(mode); f.edit(id(32), NativeBuyPolicyBcs, row => { row.rules.contents.pop() })
  await expect(f.read()).rejects.toMatchObject({ code: mode === 'buy' ? 'NATIVE_MARKET_BUY_INVALID' : 'NATIVE_MARKET_LIST_INVALID' })
})
it.each(['buy', 'list', 'cancel'] as const)('%s snapshots config and hints before an asynchronous client read', async mode => {
  const f = fixture(mode), original = f.client.core.getChainIdentifier.bind(f.client.core)
  let release!: () => void
  vi.spyOn(f.client.core, 'getChainIdentifier').mockImplementationOnce(() => new Promise(resolve => {
    release = () => { void original().then(resolve) }
  }))
  const reading = f.read()
  f.config.target.protocolConfigId = id(99); f.config.buyTarget.marketConfigV2Id = id(99); f.input.listingId = id(99)
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); release()
  expect(await reading).toMatchObject({ release: { protocolConfigId: id(1) } })
})
it.each(['buy', 'list', 'cancel'] as const)('%s rejects cancellation before making a client', async mode => {
  const f = fixture(mode), abort = new AbortController(); abort.abort(new Error('cancel before read'))
  await expect(f.read(abort.signal)).rejects.toThrow('cancel before read'); expect(f.factory).not.toHaveBeenCalled()
})
it.each(['buy', 'list', 'cancel'] as const)('%s bounds uncooperative readers to one 25s deadline', async mode => {
  const timeout = new AbortController(), timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  const f = fixture(mode)
  vi.spyOn(f.client.core, 'getChainIdentifier').mockImplementationOnce(() => new Promise(() => {}))
  const reading = f.read()
  timeout.abort(new DOMException('Market deadline', 'TimeoutError'))
  await expect(reading).rejects.toThrow('Market deadline')
  expect(timer).toHaveBeenCalledExactlyOnceWith(25000)
})

it('discovers Cancel caps with the same exact gRPC client, not the retired global JSON projection', async () => {
  const f = fixture('cancel')
  const snapshot = await readBrowserNativeMarketCancel({ ...f.input, config: { target: f.target } }, { client: f.factory })
  expect(snapshot).toMatchObject({ kioskCapId: id(70) })
  expect(f.scanCalls).toHaveLength(1)
  expect(f.scanCalls[0]).toMatchObject({ owner: id(11), objectType: `${capOrigin}::personal_kiosk::PersonalKioskCap`, pageSize: 50 })
})
it.each(['empty', 'duplicate', 'wrong-owner', 'wrong-type', 'malformed', 'repeated-cursor', 'cursor-bound', 'page-bound', 'transport']) (
  'Cancel discovery fails visibly for %s evidence', async part => {
    const f = fixture('cancel')
    if (part === 'empty') f.pages[0] = []
    if (part === 'duplicate') f.pages[0].push(f.pages[0][0])
    if (part === 'wrong-owner') f.pages[0][0].owner.address = id(99)
    if (part === 'wrong-type') f.pages[0][0].objectType = `${id(99)}::personal_kiosk::PersonalKioskCap`
    if (part === 'malformed') f.edit(id(70), NativeCancelPersonalKioskCapBcs, row => { row.cap = null })
    if (part === 'repeated-cursor') f.client.stateService.listOwnedObjects = (() => Promise.resolve({ response: { objects: [], nextPageToken: new Uint8Array([1]) } })) as never
    if (part === 'cursor-bound') f.client.stateService.listOwnedObjects = (() => Promise.resolve({ response: { objects: [], nextPageToken: new Uint8Array(4097) } })) as never
    if (part === 'page-bound') f.pages[0] = Array(51).fill(f.pages[0][0])
    if (part === 'transport') f.client.stateService.listOwnedObjects = (() => Promise.reject(new Error('grpc unavailable'))) as never
    await expect(readBrowserNativeMarketCancel({ ...f.input, config: { target: f.target } }, { client: f.factory })).rejects.toThrow()
  },
)
it.each(['soulId', 'stateId', 'listingId'] as const)('rejects malformed %s rather than treating it as absent', async key => {
  const f = fixture('cancel')
  await expect(readBrowserNativeMarketCancel({ ...f.input, [key]: '0x0', config: { target: f.target } }, { client: f.factory })).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
it('rejects extra owner/price/authority input instead of silently accepting it', async () => {
  const f = fixture('list')
  await expect(readBrowserNativeMarketList({ ...f.input, owner: id(99) } as never, { client: f.factory })).rejects.toThrow('Unexpected Market read input')
  expect(f.factory).not.toHaveBeenCalled()
})

it.each(['buy', 'list', 'cancel'] as const)('%s stops further RPC calls after an uncooperative call resolves late', async mode => {
  const f = fixture(mode), controller = new AbortController()
  let release!: () => void
  const original = f.client.core.getChainIdentifier.bind(f.client.core)
  vi.spyOn(f.client.core, 'getChainIdentifier').mockImplementationOnce(() => new Promise(resolve => {
    release = () => { void original().then(resolve) }
  }))
  const reading = f.read(controller.signal)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  controller.abort(new Error('session changed'))
  await expect(reading).rejects.toThrow('session changed')
  release(); await new Promise(resolve => setTimeout(resolve, 0))
  expect(f.calls).toHaveLength(0)
})

it('forwards the same deadline signal through actual gRPC call options', async () => {
  const f = fixture('buy'), original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  const calls = vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation(original)
  await f.read()
  const signal = f.factory.mock.calls[0][0]
  expect(calls.mock.calls.length).toBeGreaterThan(0)
  expect(calls.mock.calls.every(([, options]) => options?.abort === signal)).toBe(true)
})

it.each(['', '0x0', id(0)])('rejects malformed buyer %s before client construction', async buyer => {
  const f = fixture('buy')
  await expect(readBrowserNativeMarketBuy({ ...f.input, buyer }, { client: f.factory })).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
it.each(['', '0x0', id(0)])('rejects malformed cap %s before client construction', async kioskCapId => {
  const f = fixture('list')
  await expect(readBrowserNativeMarketList({ ...f.input, kioskCapId }, { client: f.factory })).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
it('does not substitute discovered cap candidates when an exact saved cap was supplied', async () => {
  const f = fixture('cancel')
  f.client.stateService.listOwnedObjects = (() => { throw new Error('No cap scan for a saved operation') }) as never
  expect(await f.read()).toMatchObject({ kioskCapId: id(70), listingId: id(33) })
  await expect(readBrowserNativeMarketCancel({ ...f.input, kioskCapId: id(99), config: { target: f.target } },
    { client: f.factory })).rejects.toThrow()
})
it('cancel discovery exhausts opaque pages before selecting the one exact current cap', async () => {
  const f = fixture('cancel'), originalPage = f.pages[0]
  f.pages[0] = []; f.pages.push(originalPage)
  expect(await readBrowserNativeMarketCancel({ ...f.input, config: { target: f.target } }, { client: f.factory }))
    .toMatchObject({ kioskCapId: id(70) })
  expect(f.scanCalls).toHaveLength(2)
  expect(f.scanCalls[1].pageToken).toEqual(new Uint8Array([1]))
})
