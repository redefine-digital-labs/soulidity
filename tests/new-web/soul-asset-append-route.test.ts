import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
const ASSETS_ID = `0x${'5'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'6'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'
const BLOB_ID = 'walrus-blob-id-abc'

const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedResolveWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedExtractAllAssetVersionAppendedEvents = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedBuildSyncSealSidecars = vi.hoisted(() => vi.fn())
const mockedUpsertAssetVersionProjection = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: { findFirst: vi.fn() },
  soulAssetVersionRecord: { findMany: vi.fn() },
}))

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
  buildSoulRouteWhere: vi.fn(() => ({ onChainId: SOUL_ID })),
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractAllAssetVersionAppendedEvents: mockedExtractAllAssetVersionAppendedEvents,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
  resolveWalrusBlobId: mockedResolveWalrusBlobId,
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
}))

vi.mock('@/lib/soulidity/mirror/build-seal-sidecars', () => ({
  buildSyncSealSidecars: mockedBuildSyncSealSidecars,
  SealSidecarSyncConfigError: class SealSidecarSyncConfigError extends Error {},
}))

vi.mock('@/lib/soulidity/mirror/upsert-asset', () => ({
  upsertAssetVersionProjection: mockedUpsertAssetVersionProjection,
}))

vi.mock('@/lib/soulidity/request', () => ({
  parseRequiredTxDigest: mockedParseRequiredTxDigest,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))


const SOUL_DETAIL = {
  onChainId: SOUL_ID,
  stateOnChainId: STATE_ID,
  memoryOnChainId: MEMORY_ID,
  category: 'Trading',
  tags: ['test'],
  previewImages: [],
  readme: null,
  sealSidecar: null,
  creatorMemberId: 'creator-1',
  currentOwnerMemberId: 'owner-1',
  listingObjectOnChainId: null,
  listedPriceAtomic: null,
  listingStatus: 'held',
}

function makeRequest(body: Record<string, unknown> = { txDigest: TX_DIGEST }) {
  return new Request(`http://localhost/api/souls/${SOUL_ID}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/souls/[id]/assets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  async function callRoute() {
    const { GET } = await import('../../web/app/api/souls/[id]/assets/route.ts')
    return GET(new Request(`http://localhost/api/souls/${SOUL_ID}/assets`) as any, {
      params: Promise.resolve({ id: SOUL_ID }),
    })
  }

  it('returns nextVersionIndexes from all mirrored versions including soft-deleted rows', async () => {
    const now = new Date('2026-04-24T00:00:00.000Z')
    mockedPrisma.soulAsset.findFirst.mockResolvedValueOnce({ onChainId: SOUL_ID })
    mockedPrisma.soulAssetVersionRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 'asset-version-1',
          soulOnChainId: SOUL_ID,
          assetsOnChainId: ASSETS_ID,
          assetName: 'persona-sprite',
          versionIndex: 1,
          visibility: 'public',
          assetType: 'sprite',
          deletedAt: null,
          blobObjectId: BLOB_OBJECT_ID,
          blobId: BLOB_ID,
          sealSidecar: null,
          createdAtMs: BigInt(1700000000000),
          createdAt: now,
          updatedAt: now,
        },
      ])
      .mockResolvedValueOnce([
        { assetName: 'persona-sprite', versionIndex: 0 },
        { assetName: 'persona-sprite', versionIndex: 1 },
      ])

    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      assets: [expect.objectContaining({ assetName: 'persona-sprite', versionIndex: 1 })],
      nextVersionIndexes: { 'persona-sprite': 2 },
    })
    expect(mockedPrisma.soulAssetVersionRecord.findMany).toHaveBeenNthCalledWith(1, {
      where: { soulOnChainId: SOUL_ID, deletedAt: null },
      orderBy: [{ assetName: 'asc' }, { versionIndex: 'desc' }],
    })
    expect(mockedPrisma.soulAssetVersionRecord.findMany).toHaveBeenNthCalledWith(2, {
      where: { soulOnChainId: SOUL_ID },
      select: { assetName: true, versionIndex: true },
    })
  })
})

describe('POST /api/souls/[id]/assets (append)', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1' },
      walletAddresses: [AUTHOR_ADDRESS],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue(SOUL_DETAIL)
    mockedParseRequiredTxDigest.mockReturnValue(TX_DIGEST)
    mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedReadTransactionSender.mockReturnValue(AUTHOR_ADDRESS)
    mockedAssertTransactionSender.mockReturnValue(null)
    mockedExtractAllAssetVersionAppendedEvents.mockReturnValue([{
      assetsId: ASSETS_ID,
      soulId: SOUL_ID,
      assetName: 'avatar',
      versionIndex: 0,
      visibility: 'public',
      assetType: 'sprite',
      createdAtMs: 1700000000000,
      blobObjectId: BLOB_OBJECT_ID,
    }])
    mockedSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: SOUL_ID })
    mockedBuildSyncSealSidecars.mockResolvedValue({
      soulSidecar: null,
      memorySidecar: null,
      skillsSidecar: null,
      assetsSidecar: null,
    })
    mockedResolveWalrusBlobId.mockResolvedValue(BLOB_ID)
    mockedUpsertAssetVersionProjection.mockResolvedValue({
      assetName: 'avatar',
      versionIndex: 0,
    })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute(body?: Record<string, unknown>) {
    const { POST } = await import('../../web/app/api/souls/[id]/assets/route.ts')
    return POST(makeRequest(body) as any, { params: Promise.resolve({ id: SOUL_ID }) })
  }

  it('returns 200 with correct response fields on successful append', async () => {
    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      txDigest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      assetsOnChainId: ASSETS_ID,
      assetName: 'avatar',
      versionIndex: 0,
    })
  })

  it('stores idempotency record after successful append', async () => {
    await callRoute()

    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith({
      routeKey: 'assets:append',
      txDigest: TX_DIGEST,
      actorKey: 'member-1',
      resourceKey: SOUL_ID,
      statusCode: 200,
      responseBody: {
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        assetsOnChainId: ASSETS_ID,
        assetName: 'avatar',
        versionIndex: 0,
      },
    })
  })

  it('returns cached response on idempotent replay', async () => {
    const cachedBody = { txDigest: TX_DIGEST, soulOnChainId: SOUL_ID }
    mockedGetStoredSoulidityTxSync.mockResolvedValueOnce({
      statusCode: 200,
      responseBody: cachedBody,
    })

    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(cachedBody)
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('returns 404 when soul is not found', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce(null)

    const response = await callRoute()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Soul not found' })
  })

  it('returns 429 when rate limited', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })

    const response = await callRoute()

    expect(response.status).toBe(429)
  })

  it('returns 422 when event soul ID does not match', async () => {
    mockedExtractAllAssetVersionAppendedEvents.mockReturnValueOnce([{
      assetsId: ASSETS_ID,
      soulId: `0x${'f'.repeat(64)}`,
      assetName: 'avatar',
      versionIndex: 0,
      visibility: 'public',
      assetType: 'sprite',
      createdAtMs: 1700000000000,
      blobObjectId: BLOB_OBJECT_ID,
    }])

    const response = await callRoute()

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction appended an asset version for a different Soul',
    })
  })

  it('calls upsertAssetVersionProjection with correct version fields', async () => {
    await callRoute()

    expect(mockedUpsertAssetVersionProjection).toHaveBeenCalledWith({
      version: {
        soulId: SOUL_ID,
        assetsId: ASSETS_ID,
        assetName: 'avatar',
        versionIndex: 0,
        visibility: 'public',
        assetType: 'sprite',
        blobObjectId: BLOB_OBJECT_ID,
        blobId: BLOB_ID,
        createdAtMs: 1700000000000,
      },
      soulOnChainId: SOUL_ID,
      assetsOnChainId: ASSETS_ID,
      sealSidecar: null,
    })
  })
})
