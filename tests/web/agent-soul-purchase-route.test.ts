import { beforeEach, describe, expect, it, vi } from 'vitest'

const SERIES_ID = `0x${'1'.repeat(64)}`
const SUB_PLAN_ID = `0x${'2'.repeat(64)}`
const AGENT_ADDRESS = `0x${'3'.repeat(64)}`

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  member: { findUnique: vi.fn() },
}))
const mockedSuiClient = vi.hoisted(() => ({
  getCoins: vi.fn(),
  getObject: vi.fn(),
}))
const mockedBuildBuyPerpetualTx = vi.hoisted(() => vi.fn())
const mockedBuildBuySubscriptionTx = vi.hoisted(() => vi.fn())
const mockedCreatePreparedSoulPurchase = vi.hoisted(() => vi.fn())
const mockedTx = vi.hoisted(() => ({
  setSender: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/souls/tx-builder', () => ({
  buildBuyPerpetualTx: mockedBuildBuyPerpetualTx,
  buildBuySubscriptionTx: mockedBuildBuySubscriptionTx,
}))

vi.mock('@web/lib/souls/prepared-purchase', () => ({
  createPreparedSoulPurchase: mockedCreatePreparedSoulPurchase,
}))

describe('agent soul purchase prepare route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_PLATFORM_CONFIG_ID = '0xplatform'
    process.env.NEXT_PUBLIC_USDC_COIN_TYPE = '0xusdc::coin::USDC'

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: SERIES_ID,
      status: 'active',
      releases: [],
      oneTimePlanOnChainId: null,
      subPlanOnChainId: SUB_PLAN_ID,
      oneTimePriceUsdc: null,
      subPriceUsdc: 100,
    })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'agent-member-1',
      wallet: AGENT_ADDRESS,
      walletBindings: [{ address: AGENT_ADDRESS }],
    })
    mockedSuiClient.getCoins.mockResolvedValue({
      data: [
        { coinObjectId: 'coin-a', balance: '400000' },
        { coinObjectId: 'coin-b', balance: '700000' },
      ],
    })
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: SUB_PLAN_ID,
        type: '0xpackage::purchase::PricingPlan',
        content: {
          dataType: 'moveObject',
          type: '0xpackage::purchase::PricingPlan',
          fields: {
            series_id: SERIES_ID,
            plan_type: 1,
            price_usdc: '1000000',
            period_ms: '2592000000',
            active: true,
          },
        },
      },
    })
    mockedTx.build.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mockedBuildBuySubscriptionTx.mockReturnValue(mockedTx)
    mockedCreatePreparedSoulPurchase.mockResolvedValue({
      id: 'prepared-purchase-1',
      expiresAt: new Date('2099-03-22T00:05:00.000Z'),
    })
  })

  it('uses multiple USDC coin objects when no single coin can cover the price', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xseries/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planType: 'subscription' }),
      }) as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(200)
    expect(mockedBuildBuySubscriptionTx).toHaveBeenCalledWith({
      platformConfigId: expect.any(String),
      planId: SUB_PLAN_ID,
      seriesId: SERIES_ID,
      paymentCoinIds: ['coin-a', 'coin-b'],
      amount: 1_000_000n,
    })
  })

  it('persists prepared purchase context and returns a preparedPurchaseId for execute', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xseries/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planType: 'subscription' }),
      }) as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      preparedPurchaseId: 'prepared-purchase-1',
      txBytes: expect.any(String),
      context: {
        planOnChainId: SUB_PLAN_ID,
        planType: 'subscription',
        seriesOnChainId: SERIES_ID,
        releaseOnChainId: null,
        amount: '1000000',
        agentAddress: AGENT_ADDRESS,
        expiresAt: '2099-03-22T00:05:00.000Z',
      },
    })
    expect(mockedCreatePreparedSoulPurchase).toHaveBeenCalledWith({
      agentMemberId: 'agent-member-1',
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: Buffer.from([1, 2, 3]).toString('base64'),
      planOnChainId: SUB_PLAN_ID,
      planType: 'subscription',
      releaseOnChainId: null,
      seriesOnChainId: SERIES_ID,
    })
  })

  it('keeps paging Sui coin results until the fragmented balance is sufficient', async () => {
    mockedSuiClient.getCoins
      .mockResolvedValueOnce({
        data: [{ coinObjectId: 'coin-a', balance: '400000' }],
        hasNextPage: true,
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        data: [{ coinObjectId: 'coin-b', balance: '700000' }],
        hasNextPage: false,
        nextCursor: null,
      })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xseries/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planType: 'subscription' }),
      }) as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(200)
    expect(mockedSuiClient.getCoins).toHaveBeenCalledTimes(2)
    expect(mockedBuildBuySubscriptionTx).toHaveBeenCalledWith({
      platformConfigId: expect.any(String),
      planId: SUB_PLAN_ID,
      seriesId: SERIES_ID,
      paymentCoinIds: ['coin-a', 'coin-b'],
      amount: 1_000_000n,
    })
  })

  it('fails early when the wallet aggregate USDC balance is insufficient', async () => {
    mockedSuiClient.getCoins.mockResolvedValue({
      data: [
        { coinObjectId: 'coin-a', balance: '400000' },
        { coinObjectId: 'coin-b', balance: '500000' },
      ],
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xseries/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planType: 'subscription' }),
      }) as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Agent does not have enough USDC to cover this purchase.',
    })
    expect(mockedBuildBuySubscriptionTx).not.toHaveBeenCalled()
  })

  it('returns 503 with a clear error when required purchase env config is missing', async () => {
    delete process.env.NEXT_PUBLIC_PLATFORM_CONFIG_ID

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xseries/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planType: 'subscription' }),
      }) as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Service temporarily unavailable',
    })
    expect(mockedSuiClient.getCoins).not.toHaveBeenCalled()
    expect(mockedBuildBuySubscriptionTx).not.toHaveBeenCalled()
  })
})
