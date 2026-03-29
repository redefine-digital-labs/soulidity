import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_OBJECT_PACKAGE_ID = `0x${'9'.repeat(64)}`
const LISTING_ID = `0x${'7'.repeat(64)}`
const ALLOWLIST_REGISTRY_ID = `0x${'5'.repeat(64)}`
const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`
const PAYMENT_COIN_TYPE = '0xpayment::usdc::USDC'

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetSoulPurchaseQuote = vi.hoisted(() => vi.fn())
const mockedCreatePreparedSoulPurchase = vi.hoisted(() => vi.fn())
const mockedBuildBuySoulTx = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  getBalance: vi.fn(),
  getCoins: vi.fn(),
  devInspectTransactionBlock: vi.fn(),
}))
const mockedTx = vi.hoisted(() => ({
  setSender: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
}))

vi.mock('@web/lib/souls/purchase-quote', () => ({
  getSoulPurchaseQuote: mockedGetSoulPurchaseQuote,
}))

vi.mock('@web/lib/souls/prepared-purchase', () => ({
  createPreparedSoulPurchase: mockedCreatePreparedSoulPurchase,
}))

vi.mock('@web/lib/souls/tx-builder', () => ({
  buildBuySoulTx: mockedBuildBuySoulTx,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('agent soul purchase prepare route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = SOUL_OBJECT_PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID = `0x${'5'.repeat(64)}`
    process.env.NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID = ALLOWLIST_REGISTRY_ID
    process.env.NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE = PAYMENT_COIN_TYPE

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AGENT_ADDRESS)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      currentKioskId: KIOSK_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '1000000',
    })
    mockedGetSoulPurchaseQuote.mockResolvedValue({
      platformFeeAtomic: 50_000n,
      priceAtomic: 1_000_000n,
      creatorRoyaltyAtomic: 25_000n,
      totalAtomic: 1_075_000n,
    })
    mockedSuiClient.getCoins.mockResolvedValue({
      data: [{ coinObjectId: '0xcoin-a', balance: '2000000' }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedSuiClient.getBalance.mockImplementation(async ({ coinType }: { coinType?: string }) => (
      coinType
        ? { totalBalance: '2000000' }
        : { totalBalance: '2000000000' }
    ))
    mockedSuiClient.devInspectTransactionBlock.mockResolvedValue({
      effects: { status: { status: 'success' } },
    })
    mockedTx.build.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mockedBuildBuySoulTx.mockReturnValue(mockedTx)
    mockedCreatePreparedSoulPurchase.mockResolvedValue({
      id: 'prepared-1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })
  })

  it('returns 404 when the Soul is not listed', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul is not currently listed for sale',
    })
  })

  it('returns 409 when the mirrored listing is missing its kiosk id', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      currentKioskId: null,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '1000000',
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul listing missing kiosk',
    })
    expect(mockedGetSoulPurchaseQuote).not.toHaveBeenCalled()
  })

  it('returns 503 before quoting when the allowlist registry config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedGetSoulPurchaseQuote).not.toHaveBeenCalled()
    expect(mockedSuiClient.getBalance).not.toHaveBeenCalled()
  })

  it('returns 503 when the required purchase config is missing', async () => {
    mockedGetSoulPurchaseQuote.mockImplementationOnce(() => {
      const error = new Error('Service temporarily unavailable')
      error.name = 'MissingPublicEnvError'
      throw error
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedSuiClient.getBalance).not.toHaveBeenCalled()
  })

  it('returns 409 when the agent has multiple primary Sui wallet bindings', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberPrimarySuiWalletAddress.mockRejectedValueOnce(walletError)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
  })

  it('returns 402 when the agent does not hold enough payment coin balance', async () => {
    mockedSuiClient.getCoins.mockResolvedValueOnce({
      data: [{ coinObjectId: '0xcoin-a', balance: '1000000' }],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedSuiClient.getBalance.mockImplementationOnce(async ({ coinType }: { coinType?: string }) => (
      coinType
        ? { totalBalance: '1000000' }
        : { totalBalance: '2000000000' }
    ))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      error: 'Insufficient USDC balance for purchase. Required: 1075000 atomic units, available: 1000000.',
    })
    expect(mockedBuildBuySoulTx).not.toHaveBeenCalled()
  })

  it('returns 402 when payment is funded but the SUI gas reserve is too low', async () => {
    mockedSuiClient.getBalance
      .mockResolvedValueOnce({ totalBalance: '2000000' })
      .mockResolvedValueOnce({ totalBalance: '10000000' })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      error: 'Insufficient SUI gas balance for purchase. Required reserve: 50000000 MIST, available: 10000000 MIST.',
    })
    expect(mockedBuildBuySoulTx).not.toHaveBeenCalled()
  })

  it('builds and persists a Soul purchase prepared transaction', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      preparedPurchaseId: 'prepared-1',
      txBytes: Buffer.from([1, 2, 3]).toString('base64'),
      context: {
        soulOnChainId: SOUL_ID,
        listingObjectId: LISTING_ID,
        sellerKioskId: KIOSK_ID,
        priceAtomic: '1000000',
        platformFeeAtomic: '50000',
        creatorRoyaltyAtomic: '25000',
        totalAtomic: '1075000',
        paymentCoinType: PAYMENT_COIN_TYPE,
        agentAddress: AGENT_ADDRESS,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    })
    expect(mockedBuildBuySoulTx).toHaveBeenCalledWith({
      listingObjectId: LISTING_ID,
      sellerKioskId: KIOSK_ID,
      totalAtomic: 1_075_000n,
      paymentCoinObjectIds: ['0xcoin-a'],
    })
    expect(mockedCreatePreparedSoulPurchase).toHaveBeenCalledWith({
      agentMemberId: 'agent-member-1',
      soulOnChainId: SOUL_ID,
      listingObjectId: LISTING_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      priceAtomic: 1_000_000n,
      platformFeeAtomic: 50_000n,
      creatorRoyaltyAtomic: 25_000n,
      totalAtomic: 1_075_000n,
      txBytesBase64: Buffer.from([1, 2, 3]).toString('base64'),
    })
  })

  it('returns 422 when the on-chain listing check fails', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      currentKioskId: KIOSK_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '1000000',
    })
    mockedSuiClient.devInspectTransactionBlock.mockResolvedValueOnce({
      error: 'MoveAbort(MutableObjectUsedAfterDelete)',
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul listing is no longer active on chain',
    })
    expect(mockedBuildBuySoulTx).toHaveBeenCalled()
    expect(mockedCreatePreparedSoulPurchase).not.toHaveBeenCalled()
  })
})
