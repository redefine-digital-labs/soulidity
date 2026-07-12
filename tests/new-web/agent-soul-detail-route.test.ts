import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ID = `0x${'1'.repeat(64)}`
const STATE_ID = `0x${'2'.repeat(64)}`
const PROVENANCE_ID = `0x${'3'.repeat(64)}`
const MAKER_ID = `0x${'4'.repeat(64)}`
const TREASURY_ID = `0x${'5'.repeat(64)}`

const mockedRequireAgentWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoul = vi.hoisted(() => vi.fn())
const mockedToDetail = vi.hoisted(() => vi.fn())
const mockedGetEnv = vi.hoisted(() => vi.fn())
const mockedGetConfig = vi.hoisted(() => vi.fn())
const mockedGetProvenance = vi.hoisted(() => vi.fn())
const mockedQuoteAnimacraft = vi.hoisted(() => vi.fn())
const mockedQuoteSoul = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/agent-server', () => ({
  requireAgentWalletIdentity: mockedRequireAgentWalletIdentity,
}))
vi.mock('@/lib/rate-limit', () => ({ takeRateLimitToken: mockedTakeRateLimitToken }))
vi.mock('@/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoul,
  toSoulAssetDetail: mockedToDetail,
}))
vi.mock('@soulidity/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soulidity/sdk')>()
  return {
    ...actual,
    getRequiredSoulidityEnv: mockedGetEnv,
    getCachedMarketConfig: mockedGetConfig,
    getAnimacraftProvenanceForState: mockedGetProvenance,
    quoteAnimacraftSoulPurchase: mockedQuoteAnimacraft,
    quoteSoulPurchase: mockedQuoteSoul,
  }
})

describe('GET /api/agent/souls/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireAgentWalletIdentity.mockResolvedValue({
      agent: { agentMemberId: 'agent-1' },
      walletAddresses: [`0x${'9'.repeat(64)}`],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetEnv.mockImplementation((name: string) => name.includes('MARKET_CONFIG')
      ? `0x${'8'.repeat(64)}`
      : `0x${'7'.repeat(64)}`)
    mockedGetConfig.mockResolvedValue({ platformFeeBps: 250 })
    mockedToDetail.mockImplementation((_soul, params) => params)
  })

  it('quotes Animacraft Souls from immutable Maker provenance, not creator royalty', async () => {
    mockedFindSoul.mockResolvedValue({
      onChainId: SOUL_ID,
      stateOnChainId: STATE_ID,
      provenanceKind: 'animacraft',
      listingStatus: 'listed',
      listedPriceAtomic: '1000000',
      creatorRoyaltyBps: 0,
      collection: null,
    })
    const provenance = {
      objectId: PROVENANCE_ID,
      soulId: SOUL_ID,
      makerId: MAKER_ID,
      makerTreasuryId: TREASURY_ID,
      makerRoyaltyBps: 300,
    }
    mockedGetProvenance.mockResolvedValue(provenance)
    mockedQuoteAnimacraft.mockReturnValue({
      priceAtomic: '1000000',
      platformFeeAtomic: '25000',
      makerRoyaltyAtomic: '30000',
      collectionRoyaltyAtomic: '0',
      totalAtomic: '1055000',
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/route')
    const response = await GET(new Request(`http://localhost/api/agent/souls/${SOUL_ID}`), {
      params: Promise.resolve({ id: SOUL_ID }),
    })

    expect(response.status).toBe(200)
    expect(mockedQuoteSoul).not.toHaveBeenCalled()
    expect(mockedQuoteAnimacraft).toHaveBeenCalledWith(
      { platformFeeBps: 250 },
      { priceAtomic: 1_000_000n, makerRoyaltyBps: 300, collectionRoyaltyBps: 0 },
    )
    expect(mockedToDetail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      platformFeeBps: 250,
      animacraftProvenance: provenance,
      quote: expect.objectContaining({
        royaltySource: 'animacraft-maker',
        creatorRoyaltyAtomic: '30000',
      }),
    }))
  })
})
