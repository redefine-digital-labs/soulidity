import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeReceiveFixture } from './fixtures/native-receive'
import { NativeMarketConfigBcs, NativeMarketListingBcs } from '../../web/lib/animacraft/native-market'
import { NativeSoulBindingBcs, NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'

const m = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), find: vi.fn(), detail: vi.fn(), env: vi.fn(),
  config: vi.fn(), target: vi.fn(), client: vi.fn(),
}))
vi.mock('@/lib/soulidity/agent-server', () => ({ requireAgentWalletIdentity: m.auth }))
vi.mock('@/lib/rate-limit', () => ({ takeRateLimitToken: m.rate }))
vi.mock('@/lib/soulidity/repository', () => ({ findSoulAssetDetailByRouteId: m.find, toSoulAssetDetail: m.detail }))
vi.mock('@soulidity/sdk', async original => ({
  ...await original<typeof import('@soulidity/sdk')>(),
  getRequiredSoulidityEnv: m.env, getMarketConfigV2: m.config,
}))
vi.mock('../../web/lib/animacraft/native-receive', async original => ({
  ...await original<typeof import('../../web/lib/animacraft/native-receive')>(),
  readNativeReceiveTarget: m.target, createNativeReceiveClient: m.client,
}))
import { GET } from '../../web/app/api/agent/souls/[id]/route'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
let f: ReturnType<typeof nativeReceiveFixture>
let soul: Record<string, unknown>
// Only transport/config discovery is stubbed: native metadata attestation,
// canonical BCS, exact readset verification and native quote arithmetic are real.
function edit(objectId: string, schema: any, change: (row: any) => void) {
  const object = f.objects.get(objectId)
  const row = schema.parse(object.contents.value)
  change(row)
  object.contents.value = schema.serialize(row).toBytes()
}
const get = (signal?: AbortSignal) => GET(new Request(`http://localhost/api/agent/souls/${id(12)}`, { signal }), {
  params: Promise.resolve({ id: id(12) }),
})

describe('GET /api/agent/souls/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    f = nativeReceiveFixture()
    for (const datatypeName of ['MarketConfigV2', 'SoulListing']) {
      f.objects.get(id(5)).package.typeOrigins.push({ moduleName: 'market', datatypeName, packageId: id(6) })
    }
    const put = (objectId: string, datatype: string, schema: any, row: any) => {
      f.objects.set(objectId, { objectId, version: 2n, digest: 'digest', owner: { kind: 3 },
        objectType: `${id(6)}::market::${datatype}`, contents: { value: schema.serialize(row).toBytes() } })
    }
    put(id(30), 'MarketConfigV2', NativeMarketConfigBcs, {
      id: id(30), version: '2', legacy_config_id: id(0), fee_recipient: id(40),
      platform_fee_bps: 250, primary_enabled: false, secondary_enabled: true,
    })
    put(id(31), 'SoulListing', NativeMarketListingBcs, {
      id: id(31), version: '8', soul_id: id(12), state_id: id(14), seller: id(11),
      seller_kiosk_id: id(18), price: '10001', creator: id(11), creator_royalty_bps: 750,
      collection_id: null, purchase_cap: { id: id(32), kiosk_id: id(18), item_id: id(12), min_price: '0' },
      is_active: true,
    })
    edit(id(14), NativeSoulStateBcs, row => {
      row.creator_royalty_bps = 750; row.is_listed = true; row.ownership_epoch = '7'
    })
    edit(id(13), NativeSoulBindingBcs, row => {
      row.maker_creator = id(41); row.rights.soul_creator_royalty_bps = 750; row.rights.maker_source_royalty_bps = 250
    })
    f.client.ledgerService.batchGetObjects = async () => ({
      response: { objects: [{ result: { oneofKind: 'error', error: { code: 5 } } }] },
    }) as never
    soul = { onChainId: id(12), stateOnChainId: id(14), provenanceKind: 'animacraft',
      listingStatus: 'listed', listingObjectOnChainId: id(31), listedPriceAtomic: '10001',
      creatorRoyaltyBps: 0, collection: null }
    m.auth.mockResolvedValue({ agent: { agentMemberId: 'agent-1' }, walletAddresses: [id(90)] })
    m.rate.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    m.find.mockImplementation(async () => soul)
    m.detail.mockImplementation((_soul, params) => params)
    m.env.mockImplementation((name: string) => {
      if (name === 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID') return id(30)
      if (name === 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID') return id(6)
      throw new Error('Unexpected historical target: ' + name)
    })
    m.config.mockResolvedValue({ platformFeeBps: 250, secondaryEnabled: true })
    m.target.mockReturnValue(f.target)
    m.client.mockReturnValue(f.client)
  })

  it('uses real verified native evidence, original shares and one gross quote', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      viewerMemberId: 'agent-1', viewerAddresses: [id(90)], currentOwnershipEpoch: 7, platformFeeBps: 250,
      quote: { priceAtomic: '10001', totalAtomic: '10001', platformFeeAtomic: '250',
        creatorRoyaltyAtomic: '750', makerRoyaltyAtomic: '250', sellerPayoutAtomic: '8751',
        collectionRoyaltyAtomic: '0', makerRoyaltyBps: 250, soulCreatorRoyaltyBps: 750, royaltySource: 'animacraft-maker' },
    })
    expect(m.client).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(m.target).toHaveBeenCalledOnce()
    expect(m.env.mock.calls).toEqual([['NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID']])
    expect(m.config).not.toHaveBeenCalled()
    expect(f.calls.some(call => call.objectId === id(31))).toBe(true)
    expect(f.calls.some(call => [id(10), id(15), id(16)].includes(call.objectId))).toBe(false)
    expect(m.detail.mock.calls[0][1]).not.toHaveProperty('animacraftProvenance')
  })

  it.each(['999999', null, 'invalid'])('uses live native price even with stale cached price %s/status', async price => {
    soul.listedPriceAtomic = price
    soul.listingStatus = 'unlisted'
    expect(await (await get()).json()).toMatchObject({ quote: { totalAtomic: '10001' } })
  })

  it.each(['pause', 'fee'])('keeps detail readable without a purchase quote for %s', async reason => {
    edit(id(30), NativeMarketConfigBcs, row => {
      if (reason === 'pause') row.secondary_enabled = false
      else row.platform_fee_bps = 300
    })
    expect(await (await get()).json()).toMatchObject({
      quote: null, platformFeeBps: reason === 'pause' ? 250 : null, currentOwnershipEpoch: 7,
    })
  })

  it('does not advertise a cached listing when live state is unlisted', async () => {
    edit(id(14), NativeSoulStateBcs, row => { row.is_listed = false })
    f.objects.delete(id(31))
    expect(await (await get()).json()).toMatchObject({ quote: null, currentOwnershipEpoch: 7 })
  })

  it.each(['missing-listing', 'old-version', 'binding', 'purchase-cap', 'missing-config', 'drift'])(
    'keeps optional quote fail-closed for %s without an old provenance fallback', async reason => {
      if (reason === 'missing-listing') soul.listingObjectOnChainId = null
      if (reason === 'old-version') edit(id(31), NativeMarketListingBcs, row => { row.version = '5' })
      if (reason === 'binding') edit(id(13), NativeSoulBindingBcs, row => { row.original_holder = id(99) })
      if (reason === 'purchase-cap') edit(id(31), NativeMarketListingBcs, row => { row.purchase_cap.item_id = id(99) })
      if (reason === 'missing-config') m.env.mockImplementation(() => { throw new Error('Missing config') })
      if (reason === 'drift') {
        const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
        f.client.ledgerService.getObject = async request => {
          const result = await original(request)
          if (request.objectId === id(31)) f.objects.get(id(14)).version = 3n
          return result
        }
      }
      const response = await get()
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ quote: null, platformFeeBps: null, currentOwnershipEpoch: null })
      expect(m.config).not.toHaveBeenCalled()
    },
  )

  it('honors request cancellation before native RPC reads', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await (await get(controller.signal)).json()).toMatchObject({ quote: null })
    expect(f.calls).toHaveLength(0)
    expect(m.client.mock.calls[0][0].aborted).toBe(true)
  })

  it('quotes ordinary Soul/Collection shares using fresh V2 and the existing additive price', async () => {
    Object.assign(soul, { provenanceKind: 'native', listedPriceAtomic: '1000000',
      creatorRoyaltyBps: 300, collection: { extraRoyaltyBps: 100 } })
    expect(await (await get()).json()).toMatchObject({
      quote: { priceAtomic: '1000000', platformFeeAtomic: '25000', creatorRoyaltyAtomic: '30000',
        collectionRoyaltyAtomic: '10000', totalAtomic: '1065000', royaltySource: 'soul-creator' },
    })
    expect(m.config).toHaveBeenCalledWith(id(30), id(6))
    expect(m.client).not.toHaveBeenCalled()
  })

  it.each(['unlisted', 'zero', 'failure'])('retains ordinary optional quote behavior: %s', async reason => {
    soul.provenanceKind = 'native'
    if (reason === 'unlisted') soul.listingStatus = 'unlisted'
    if (reason === 'zero') soul.listedPriceAtomic = '0'
    if (reason === 'failure') m.config.mockRejectedValue(new Error('RPC unavailable'))
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ quote: null })
    expect(m.client).not.toHaveBeenCalled()
  })

  it('returns authentication failure before rate limiting or repository reads', async () => {
    m.auth.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await get()).status).toBe(401)
    expect(m.rate).not.toHaveBeenCalled()
    expect(m.find).not.toHaveBeenCalled()
  })

  it('rate limits the authenticated agent before repository/chain reads', async () => {
    m.rate.mockResolvedValue({ limited: true, retryAfterSeconds: 17 })
    const response = await get()
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('17')
    expect(m.rate).toHaveBeenCalledWith('agent-detail:agent-1', { max: 60, windowMs: 60000 })
    expect(m.find).not.toHaveBeenCalled()
    expect(m.client).not.toHaveBeenCalled()
  })

  it('preserves not found without optional chain reads', async () => {
    m.find.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    expect(m.find).toHaveBeenCalledWith(id(12))
    expect(m.client).not.toHaveBeenCalled()
    expect(m.detail).not.toHaveBeenCalled()
  })
})
