import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const CREATOR_ADDRESS = `0x${'1'.repeat(64)}`
const COLLECTION_ID = `0x${'2'.repeat(64)}`
const SOUL_ID = `0x${'3'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulCollectionDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedExtractSoulAddedToCollectionEvent = vi.hoisted(() => vi.fn())
const mockedSyncCollectionProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  soulCollectionAsset: {
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findSoulCollectionDetailByRouteId: mockedFindSoulCollectionDetailByRouteId,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractSoulAddedToCollectionEvent: mockedExtractSoulAddedToCollectionEvent,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
  OnChainVerificationError: class OnChainVerificationError extends Error {},
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncCollectionProjectionFromChain: mockedSyncCollectionProjectionFromChain,
}))

vi.mock('@/lib/soulidity/request', () => ({
  parseRequiredTxDigest: mockedParseRequiredTxDigest,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

function makeRequest(body: Record<string, unknown> = { txDigest: TX_DIGEST }) {
  return new Request(`http://localhost/api/collections/${COLLECTION_ID}/add-soul`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/collections/[id]/add-soul', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1' },
      walletAddresses: [CREATOR_ADDRESS],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulCollectionDetailByRouteId.mockResolvedValue({
      onChainId: COLLECTION_ID,
      floorPriceAtomic: null,
      creatorMemberId: 'creator-1',
      currentHolderMemberId: 'holder-1',
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
    })
    mockedParseRequiredTxDigest.mockReturnValue(TX_DIGEST)
    mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedReadTransactionSender.mockReturnValue(CREATOR_ADDRESS)
    mockedAssertTransactionSender.mockReturnValue(null)
    mockedExtractSoulAddedToCollectionEvent.mockReturnValue({
      collectionId: COLLECTION_ID,
      soulId: SOUL_ID,
      // Deliberately stale relative to the live object read below. This models
      // interleaved add-soul API calls landing out of order.
      currentSupply: 5n,
      maxSupply: 10n,
    })
    mockedSyncCollectionProjectionFromChain.mockResolvedValue({
      onChainId: COLLECTION_ID,
      soulCount: 6,
      maxSoulSupply: '10',
    })
    mockedPrisma.soulAsset.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.soulAsset.findFirst.mockResolvedValue(null)
    mockedPrisma.soulCollectionAsset.updateMany.mockResolvedValue({ count: 1 })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute(body?: Record<string, unknown>) {
    const { POST } = await import('../../web/app/api/collections/[id]/add-soul/route.ts')
    return POST(makeRequest(body) as never, { params: Promise.resolve({ id: COLLECTION_ID }) })
  }

  it('refreshes collection supply from chain instead of writing the add-soul event snapshot', async () => {
    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      txDigest: TX_DIGEST,
      collectionOnChainId: COLLECTION_ID,
      soulOnChainId: SOUL_ID,
      soulCount: 6,
      currentSoulSupply: 6,
      maxSoulSupply: '10',
    })
    expect(mockedSyncCollectionProjectionFromChain).toHaveBeenCalledWith({
      packageId: PACKAGE_ID,
      collectionObjectId: COLLECTION_ID,
      creatorMemberId: 'creator-1',
      currentHolderMemberId: 'holder-1',
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
      floorPriceAtomic: null,
    })
    expect(mockedPrisma.soulCollectionAsset.updateMany).not.toHaveBeenCalled()
    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith({
      routeKey: 'collection:add-soul',
      txDigest: TX_DIGEST,
      actorKey: 'member-1',
      resourceKey: COLLECTION_ID,
      statusCode: 200,
      responseBody: {
        txDigest: TX_DIGEST,
        collectionOnChainId: COLLECTION_ID,
        soulOnChainId: SOUL_ID,
        soulCount: 6,
        currentSoulSupply: 6,
        maxSoulSupply: '10',
      },
    })
  })
})
