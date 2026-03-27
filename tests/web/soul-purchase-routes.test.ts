import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const MARKET_ADAPTER_PACKAGE_ID = `0x${'8'.repeat(64)}`
const BUYER_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedExtractSoulPurchasedEvent = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedDbSetSoulOwnership = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))

vi.mock('@web/lib/souls/transaction', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  extractSoulPurchasedEvent: mockedExtractSoulPurchasedEvent,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: (left: string | null | undefined, right: string | null | undefined) =>
    String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbSetSoulOwnership: mockedDbSetSoulOwnership,
}))

describe('Soul purchase route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID = MARKET_ADAPTER_PACKAGE_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([BUYER_ADDRESS])
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      sellerKioskId: KIOSK_ID,
      listedPriceSui: '1000000000',
    })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedExtractSoulPurchasedEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      buyerAddress: BUYER_ADDRESS,
    })
    mockedGetVerifiedSoulState.mockResolvedValue({
      ownerAddress: BUYER_ADDRESS,
      grantVersion: 3n,
    })
    mockedDbSetSoulOwnership.mockResolvedValue(undefined)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
  })

  it('returns 400 for invalid tx digests', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: 'bad' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'txDigest must be a valid transaction digest',
    })
  })

  it('returns cached mirror results for duplicate purchase digests', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 200,
      body: { soulOnChainId: SOUL_ID, dbSynced: true },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      dbSynced: true,
    })
    expect(mockedExtractSoulPurchasedEvent).not.toHaveBeenCalled()
  })

  it('returns 503 when the market adapter package id env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('rejects transactions that purchase a different Soul object', async () => {
    mockedExtractSoulPurchasedEvent.mockReturnValueOnce({
      soulObjectId: `0x${'f'.repeat(64)}`,
      sellerKioskId: KIOSK_ID,
      buyerAddress: BUYER_ADDRESS,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction did not purchase the requested Soul',
    })
  })

  it('mirrors successful purchases into Soul ownership state', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentOwnerMemberId: 'member-1',
      listingStatus: 'held',
      sellerKioskId: null,
      listedPriceSui: null,
      grantVersion: 3n,
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'purchase',
      resourceKey: SOUL_ID,
      statusCode: 200,
    }))
  })
})
