import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const KIOSK_ID = `0x${'4'.repeat(64)}`
const LISTING_ID = `0x${'5'.repeat(64)}`
const PREPARED_PURCHASE_ID = '550e8400-e29b-41d4-a716-446655440000'
const STORED_EXPIRES_AT = new Date('2026-04-24T10:00:00.000Z')

const mockedRequireAgentWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedSelectCoinObjectIdsForAmountAcrossPages = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetMarketConfig = vi.hoisted(() => vi.fn())
const mockedQuoteSoulPurchase = vi.hoisted(() => vi.fn())
const mockedResolveOwnedPersonalKiosk = vi.hoisted(() => vi.fn())
const MockSoulidityPersonalKioskInvariantError = vi.hoisted(
  () => class MockSoulidityPersonalKioskInvariantError extends Error {
    kind: 'conflict' | 'service'

    constructor(message: string, kind: 'conflict' | 'service' = 'service') {
      super(message)
      this.kind = kind
    }
  },
)
const mockedBuildBuySoulTx = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulPreparedPurchase: {
    create: vi.fn(),
    findUnique: vi.fn(),
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

vi.mock('@soulidity/sdk/coin-selection', () => ({
  selectCoinObjectIdsForAmountAcrossPages: mockedSelectCoinObjectIdsForAmountAcrossPages,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@soulidity/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soulidity/sdk')>()
  return {
    ...actual,
    suiClient: { kind: 'mock-sui-client' },
    getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
    getMarketConfig: mockedGetMarketConfig,
    quoteSoulPurchase: mockedQuoteSoulPurchase,
    resolveOwnedPersonalKiosk: mockedResolveOwnedPersonalKiosk,
    SoulidityPersonalKioskInvariantError: MockSoulidityPersonalKioskInvariantError,
    buildBuySoulTx: mockedBuildBuySoulTx,
  }
})

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
    mockedPrisma.soulPreparedPurchase.create.mockResolvedValue({
      id: PREPARED_PURCHASE_ID,
      expiresAt: STORED_EXPIRES_AT,
    })
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValue(null)
  })

  async function callRoute() {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/route.ts')
    return POST(makeRequest(), { params: Promise.resolve({ id: SOUL_ID }) })
  }

  it('rejects zero-price listings before preparing a purchase', async () => {
    const response = await callRoute()

    expect(response.status).toBe(409)
    expect(mockedSelectCoinObjectIdsForAmountAcrossPages).not.toHaveBeenCalled()
    expect(mockedGetMarketConfig).not.toHaveBeenCalled()
    expect(mockedQuoteSoulPurchase).not.toHaveBeenCalled()
    expect(mockedBuildBuySoulTx).not.toHaveBeenCalled()
    expect(tx.setSender).not.toHaveBeenCalled()
    expect(mockedPrisma.soulPreparedPurchase.create).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ error: 'Soul is not listed for sale' })
  })

  it('surfaces a stale Soulidity kiosk registration as 409 with the conflict message', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '2000000',
      creatorRoyaltyBps: 0,
      collection: null,
      collectionOnChainId: null,
      currentKioskId: KIOSK_ID,
      stateOnChainId: STATE_ID,
    })
    mockedQuoteSoulPurchase.mockReturnValueOnce({
      platformFeeAtomic: '0',
      creatorRoyaltyAtomic: '0',
      totalAtomic: '2000000',
    })
    mockedResolveOwnedPersonalKiosk.mockRejectedValueOnce(
      new MockSoulidityPersonalKioskInvariantError(
        'Wallet 0xabc has a Soulidity kiosk registration (kiosk 0xkiosk, cap 0xcap) but does not own the matching PersonalKioskCap.',
        'conflict',
      ),
    )

    const response = await callRoute()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Wallet 0xabc has a Soulidity kiosk registration (kiosk 0xkiosk, cap 0xcap) but does not own the matching PersonalKioskCap.',
    })
    expect(mockedSelectCoinObjectIdsForAmountAcrossPages).not.toHaveBeenCalled()
    expect(mockedBuildBuySoulTx).not.toHaveBeenCalled()
    expect(mockedPrisma.soulPreparedPurchase.create).not.toHaveBeenCalled()
  })

  it('returns an existing prepared purchase when retrying the same tx bytes', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '2000000',
      creatorRoyaltyBps: 500,
      collection: null,
      collectionOnChainId: null,
      currentKioskId: KIOSK_ID,
      stateOnChainId: STATE_ID,
    })
    mockedQuoteSoulPurchase.mockReturnValueOnce({
      platformFeeAtomic: '50000',
      creatorRoyaltyAtomic: '100000',
      totalAtomic: '2150000',
    })
    mockedSelectCoinObjectIdsForAmountAcrossPages.mockResolvedValueOnce(['0xcoin'])
    mockedPrisma.soulPreparedPurchase.create.mockRejectedValueOnce({ code: 'P2002' })
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      expiresAt: STORED_EXPIRES_AT,
    })

    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txBytes: Buffer.from([1, 2, 3]).toString('base64'),
      context: {
        soulOnChainId: SOUL_ID,
        listingObjectId: LISTING_ID,
        totalAtomic: '2150000',
        agentAddress: AGENT_ADDRESS,
        expiresAt: STORED_EXPIRES_AT.toISOString(),
      },
    })
    expect(mockedPrisma.soulPreparedPurchase.findUnique).toHaveBeenCalledWith({
      where: {
        agentMemberId_txBytesHash: {
          agentMemberId: 'agent-member-1',
          txBytesHash: expect.any(String),
        },
      },
    })
  })
})
