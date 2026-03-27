import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_OBJECT_PACKAGE_ID = `0x${'9'.repeat(64)}`
const MARKET_ADAPTER_PACKAGE_ID = `0x${'8'.repeat(64)}`
const CPU_MARKETPLACE_ID = `0x${'7'.repeat(64)}`
const UNFT_COLLECTION_ID = `0x${'6'.repeat(64)}`
const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`

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
    process.env.NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID = MARKET_ADAPTER_PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID = CPU_MARKETPLACE_ID
    process.env.NEXT_PUBLIC_SOUL_UNFT_COLLECTION_ID = UNFT_COLLECTION_ID
    process.env.NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID = `0x${'5'.repeat(64)}`

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
      sellerKioskId: KIOSK_ID,
      listedPriceSui: '1000000000',
    })
    mockedGetSoulPurchaseQuote.mockResolvedValue({
      marketplaceFeeSui: 50_000_000n,
      priceSui: 1_000_000_000n,
      royaltyFeeSui: 25_000_000n,
      totalSui: 1_075_000_000n,
    })
    mockedSuiClient.getBalance.mockResolvedValue({ totalBalance: '2000000000' })
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

  it('returns 402 when the agent balance cannot cover price plus fees', async () => {
    mockedSuiClient.getBalance.mockResolvedValueOnce({ totalBalance: '1000000000' })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      error: 'Agent does not have enough SUI to cover this purchase.',
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
        sellerKioskId: KIOSK_ID,
        priceSui: '1000000000',
        feeAmountSui: '75000000',
        agentAddress: AGENT_ADDRESS,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    })
    expect(mockedBuildBuySoulTx).toHaveBeenCalledWith({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      buyerAddress: AGENT_ADDRESS,
      priceSui: 1_000_000_000n,
      feeAmountSui: 75_000_000n,
    })
    expect(mockedCreatePreparedSoulPurchase).toHaveBeenCalledWith({
      agentMemberId: 'agent-member-1',
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      priceSui: 1_000_000_000n,
      txBytesBase64: Buffer.from([1, 2, 3]).toString('base64'),
    })
  })
})
