import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const KIOSK_ID = `0x${'4'.repeat(64)}`
const LISTING_ID = `0x${'5'.repeat(64)}`
const PREPARED_PURCHASE_ID = '550e8400-e29b-41d4-a716-446655440000'

const mockedRequireAgentWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedSelectCoinObjectIdsForAmountAcrossPages = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetMarketConfig = vi.hoisted(() => vi.fn())
const mockedQuoteSoulPurchase = vi.hoisted(() => vi.fn())
const mockedResolveOwnedPersonalKiosk = vi.hoisted(() => vi.fn())
const mockedBuildBuySoulTx = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulPreparedPurchase: {
    create: vi.fn(),
  },
}))

vi.mock('@/lib/soulidity/agent-server', () => ({
  requireAgentWalletIdentity: mockedRequireAgentWalletIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@/lib/soulidity/coin-selection', () => ({
  selectCoinObjectIdsForAmountAcrossPages: mockedSelectCoinObjectIdsForAmountAcrossPages,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getMarketConfig: mockedGetMarketConfig,
  quoteSoulPurchase: mockedQuoteSoulPurchase,
}))

vi.mock('@/lib/soulidity/personal-kiosk', () => ({
  resolveOwnedPersonalKiosk: mockedResolveOwnedPersonalKiosk,
}))

vi.mock('@/lib/soulidity/tx/buy', () => ({
  buildBuySoulTx: mockedBuildBuySoulTx,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: { kind: 'mock-sui-client' },
}))

function makeRequest() {
  return new Request(`http://localhost/api/agent/souls/${SOUL_ID}/purchase`, {
    method: 'POST',
  })
}

describe('POST /api/agent/souls/[id]/purchase', () => {
  const tx = {
    setSender: vi.fn(),
    build: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireAgentWalletIdentity.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      walletAddresses: [AGENT_ADDRESS],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '0',
      creatorRoyaltyBps: 0,
      collection: null,
      collectionOnChainId: null,
      currentKioskId: KIOSK_ID,
      stateOnChainId: STATE_ID,
    })
    mockedGetRequiredSoulidityEnv.mockImplementation((name: string) => {
      if (name === 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE') return '0x2::usdc::USDC'
      if (name === 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID') return `0x${'9'.repeat(64)}`
      if (name === 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID') return `0x${'8'.repeat(64)}`
      throw new Error(`Unexpected env request: ${name}`)
    })
    mockedGetMarketConfig.mockResolvedValue({ platformFeeBps: 0 })
    mockedQuoteSoulPurchase.mockReturnValue({
      platformFeeAtomic: '0',
      creatorRoyaltyAtomic: '0',
      totalAtomic: '0',
    })
    mockedResolveOwnedPersonalKiosk.mockResolvedValue({ status: 'missing' })
    tx.build.mockResolvedValue(Uint8Array.from([1, 2, 3]))
    mockedBuildBuySoulTx.mockReturnValue(tx)
    mockedPrisma.soulPreparedPurchase.create.mockResolvedValue({ id: PREPARED_PURCHASE_ID })
  })

  async function callRoute() {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    return POST(makeRequest(), { params: Promise.resolve({ id: SOUL_ID }) })
  }

  it('prepares a zero-price purchase without requiring payment coin selection', async () => {
    const response = await callRoute()

    expect(response.status).toBe(200)
    expect(mockedSelectCoinObjectIdsForAmountAcrossPages).not.toHaveBeenCalled()
    expect(mockedBuildBuySoulTx).toHaveBeenCalledWith({
      sellerKioskId: KIOSK_ID,
      stateObjectId: STATE_ID,
      listingObjectId: LISTING_ID,
      totalAtomic: 0n,
      paymentCoinObjectIds: [],
      collectionObjectId: null,
      buyerKioskId: null,
      buyerKioskCapOnChainId: null,
    })
    expect(tx.setSender).toHaveBeenCalledWith(AGENT_ADDRESS)
    expect(mockedPrisma.soulPreparedPurchase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          soulOnChainId: SOUL_ID,
          agentAddress: AGENT_ADDRESS,
          totalAtomic: '0',
        }),
      }),
    )
    await expect(response.json()).resolves.toEqual({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txBytes: Buffer.from(Uint8Array.from([1, 2, 3])).toString('base64'),
      context: {
        soulOnChainId: SOUL_ID,
        listingObjectId: LISTING_ID,
        sellerKioskId: KIOSK_ID,
        priceAtomic: '0',
        platformFeeAtomic: '0',
        creatorRoyaltyAtomic: '0',
        totalAtomic: '0',
        agentAddress: AGENT_ADDRESS,
        expiresAt: expect.any(String),
      },
    })
  })
})
