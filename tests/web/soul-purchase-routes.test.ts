import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sameSuiValueForTests } from './test-sui-value.ts'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const BUYER_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const SELLER_KIOSK_ID = `0x${'3'.repeat(64)}`
const BUYER_KIOSK_ID = `0x${'4'.repeat(64)}`
const BUYER_KIOSK_CAP_ID = `0x${'5'.repeat(64)}`
const SELLER_ADDRESS = `0x${'6'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const MockSoulMirrorOwnershipConflictError = vi.hoisted(() => class MockSoulMirrorOwnershipConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoulMirrorOwnershipConflictError'
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
const mockedGetVerifiedPersonalKioskCapState = vi.hoisted(() => vi.fn())
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
  getTrustedPackageIds: (...packageIds: Array<string | null | undefined>) => packageIds.filter((value): value is string => Boolean(value)),
  getVerifiedPersonalKioskCapState: mockedGetVerifiedPersonalKioskCapState,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: sameSuiValueForTests,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  SoulMirrorOwnershipConflictError: MockSoulMirrorOwnershipConflictError,
  dbSetSoulOwnership: mockedDbSetSoulOwnership,
  narrowListingStatus: (v: string | null | undefined) => (v === 'listed' || v === 'held' ? v : undefined),
}))

describe('Soul purchase route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID

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
      currentOwnerAddress: SELLER_ADDRESS,
      currentKioskId: SELLER_KIOSK_ID,
      listingObjectOnChainId: `0x${'6'.repeat(64)}`,
      listedPriceAtomic: '1000000000',
    })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({
      digest: TX_DIGEST,
      transaction: {
        data: {
          sender: BUYER_ADDRESS,
        },
      },
    })
    mockedExtractSoulPurchasedEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      sellerKioskId: SELLER_KIOSK_ID,
      buyerKioskId: BUYER_KIOSK_ID,
      buyerKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      buyerAddress: BUYER_ADDRESS,
    })
    mockedGetVerifiedSoulState.mockResolvedValue({
      ownerKind: 'object',
      ownerAddress: null,
      ownerObjectId: BUYER_KIOSK_ID,
      allowlistVersion: 3n,
    })
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValue({
      objectId: BUYER_KIOSK_CAP_ID,
      ownerAddress: BUYER_ADDRESS,
      kioskId: BUYER_KIOSK_ID,
    })
    mockedDbSetSoulOwnership.mockResolvedValue(undefined)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
  })

  it('marks the human purchase mirror route as dynamic', async () => {
    const routeModule = await import('../../web/app/api/souls/[id]/purchase/route.ts')

    expect(routeModule.dynamic).toBe('force-dynamic')
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

  it('returns 503 when the soul object package id env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID

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

  it('returns 409 when the listed Soul is missing its seller kiosk mirror', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      currentKioskId: null,
      listingObjectOnChainId: `0x${'6'.repeat(64)}`,
      listedPriceAtomic: '1000000000',
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

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul listing missing kiosk',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('returns 409 when the buyer has multiple Sui wallet bindings', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(walletError)

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
  })

  it('rejects transactions that purchase a different Soul object', async () => {
    mockedExtractSoulPurchasedEvent.mockReturnValueOnce({
      soulObjectId: `0x${'f'.repeat(64)}`,
      sellerKioskId: SELLER_KIOSK_ID,
      buyerKioskId: BUYER_KIOSK_ID,
      buyerKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
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

  it('passes the buyer kiosk id as an expectedKioskId hint when the current-package purchase event is available', async () => {
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
    expect(mockedGetVerifiedSoulState).toHaveBeenCalledWith(SOUL_ID, PACKAGE_ID, {
      expectedKioskId: BUYER_KIOSK_ID,
    })
  })

  it('rejects purchases whose buyer kiosk cap is not owned by the authenticated wallet', async () => {
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValueOnce({
      objectId: BUYER_KIOSK_CAP_ID,
      ownerAddress: `0x${'f'.repeat(64)}`,
      kioskId: BUYER_KIOSK_ID,
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
      error: 'Purchased Soul kiosk cap does not belong to the authenticated buyer',
    })
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
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
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
      txSender: BUYER_ADDRESS,
    })
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 3n,
      expectedCurrentOwnerAddress: SELLER_ADDRESS,
      expectedCurrentKioskId: SELLER_KIOSK_ID,
      expectedListingStatus: 'listed',
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'purchase',
      resourceKey: SOUL_ID,
      statusCode: 200,
    }))
    expect(mockedExtractSoulPurchasedEvent).toHaveBeenCalledTimes(1)
    expect(mockedExtractSoulPurchasedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ digest: TX_DIGEST }),
      PACKAGE_ID,
    )
    expect(mockedGetVerifiedPersonalKioskCapState).toHaveBeenCalledWith(BUYER_KIOSK_CAP_ID)
  })

  it('returns 207 when the chain purchase succeeded but local ownership sync failed', async () => {
    mockedDbSetSoulOwnership.mockRejectedValueOnce(new Error('db offline'))

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toEqual({
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: false,
      txSender: BUYER_ADDRESS,
      error: 'Transaction succeeded on chain, but local Soul sync failed.',
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'purchase',
      resourceKey: SOUL_ID,
      statusCode: 207,
      body: expect.objectContaining({
        dbSynced: false,
        error: 'Transaction succeeded on chain, but local Soul sync failed.',
      }),
    }))
  })

  it('retries DB sync when a cached purchase result is a recoverable 207', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 207,
      body: {
        digest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: BUYER_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
        txSender: BUYER_ADDRESS,
        listingStatus: 'held',
        onChainSuccess: true,
        dbSynced: false,
        error: 'Transaction succeeded on chain, but local Soul sync failed.',
      },
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
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 3n,
      expectedCurrentOwnerAddress: SELLER_ADDRESS,
      expectedCurrentKioskId: SELLER_KIOSK_ID,
      expectedListingStatus: 'listed',
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'purchase',
      resourceKey: SOUL_ID,
      statusCode: 200,
      body: expect.objectContaining({
        dbSynced: true,
      }),
    }))
  })

  it('returns and persists a terminal 410 when recoverable cached sync shows the Soul changed ownership', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 207,
      body: {
        digest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: `0x${'8'.repeat(64)}`,
        currentKioskId: `0x${'9'.repeat(64)}`,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
        txSender: BUYER_ADDRESS,
        listingStatus: 'held',
        onChainSuccess: true,
        dbSynced: false,
        error: 'Transaction succeeded on chain, but local Soul sync failed.',
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'address',
      ownerAddress: BUYER_ADDRESS,
      ownerObjectId: null,
      allowlistVersion: 3n,
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

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      onChainSuccess: true,
      dbSynced: false,
      ownershipChanged: true,
      error: 'Soul ownership changed since the original purchase sync. Refresh the Soul detail instead of retrying.',
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'purchase',
      resourceKey: SOUL_ID,
      statusCode: 410,
      body: expect.objectContaining({
        digest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        onChainSuccess: true,
        dbSynced: false,
        ownershipChanged: true,
        error: 'Soul ownership changed since the original purchase sync. Refresh the Soul detail instead of retrying.',
      }),
    }))
  })

  it('does not rewrite cached 207 bodies when a retry produces the same pending payload', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 207,
      body: {
        digest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        txSender: BUYER_ADDRESS,
        currentOwnerAddress: BUYER_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
        listingStatus: 'held',
        onChainSuccess: true,
        dbSynced: false,
        error: 'Purchase sync pending',
      },
    })
    mockedDbSetSoulOwnership.mockRejectedValueOnce(new Error('temporary DB outage'))

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toEqual({
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      txSender: BUYER_ADDRESS,
      currentOwnerAddress: BUYER_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: false,
      error: 'Purchase sync pending',
    })
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
  })

  it('keeps recoverable purchase sync metadata after a retry stays pending', async () => {
    let lastStoredSync: { statusCode: number; body: Record<string, unknown> } | null = null
    mockedGetStoredSoulTxSync.mockImplementation(async () => {
      if (lastStoredSync) {
        return lastStoredSync
      }
      return {
        statusCode: 207,
        body: {
          digest: TX_DIGEST,
          soulOnChainId: SOUL_ID,
          currentOwnerAddress: BUYER_ADDRESS,
          currentKioskId: BUYER_KIOSK_ID,
          currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
          txSender: BUYER_ADDRESS,
          listingStatus: 'held',
          onChainSuccess: true,
          dbSynced: false,
          error: 'Transaction succeeded on chain, but local Soul sync failed.',
        },
      }
    })
    mockedStoreSoulTxSync.mockImplementation(async ({ statusCode, body }) => {
      lastStoredSync = { statusCode, body: body as Record<string, unknown> }
    })
    mockedDbSetSoulOwnership
      .mockRejectedValueOnce(new Error('temporary DB outage'))
      .mockResolvedValueOnce(undefined)

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')

    const firstResponse = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(firstResponse.status).toBe(207)
    await expect(firstResponse.json()).resolves.toEqual({
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      txSender: BUYER_ADDRESS,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: false,
      error: 'Purchase sync pending',
      currentOwnerAddress: BUYER_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
    })

    const secondResponse = await POST(
      new Request('http://localhost/api/souls/0xsoul/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toEqual({
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledTimes(2)
  })

  it('allows retrying the same digest after ownership already flipped to held locally', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'held',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listedPriceAtomic: null,
      currentOwnerAddress: BUYER_ADDRESS,
      currentOwnerMemberId: 'member-1',
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
      digest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
      txSender: BUYER_ADDRESS,
    })
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: BUYER_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 3n,
      expectedCurrentOwnerAddress: BUYER_ADDRESS,
      expectedCurrentKioskId: BUYER_KIOSK_ID,
      expectedListingStatus: 'held',
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'purchase',
      resourceKey: SOUL_ID,
      statusCode: 200,
    }))
  })
})
