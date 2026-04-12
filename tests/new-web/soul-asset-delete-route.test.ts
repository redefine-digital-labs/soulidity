import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
const ASSETS_ID = `0x${'5'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

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
const mockedExtractAssetVersionDeletedEvent = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedMarkAssetVersionDeleted = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractAssetVersionDeletedEvent: mockedExtractAssetVersionDeletedEvent,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
}))

vi.mock('@/lib/soulidity/mirror/upsert-asset', () => ({
  markAssetVersionDeleted: mockedMarkAssetVersionDeleted,
}))

vi.mock('@/lib/soulidity/request', () => ({
  parseRequiredTxDigest: mockedParseRequiredTxDigest,
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
  return new Request(`http://localhost/api/souls/${SOUL_ID}/assets/avatar/versions/0/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete', () => {
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
    mockedExtractAssetVersionDeletedEvent.mockReturnValue({
      assetsId: ASSETS_ID,
      soulId: SOUL_ID,
      assetName: 'avatar',
      versionIndex: 0,
      deletedBy: AUTHOR_ADDRESS,
    })
    mockedSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: SOUL_ID })
    mockedMarkAssetVersionDeleted.mockResolvedValue({ count: 1 })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute() {
    const { POST } = await import(
      '../../web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts'
    )
    return POST(makeRequest() as any, {
      params: Promise.resolve({ id: SOUL_ID, assetName: 'avatar', versionIndex: '0' }),
    })
  }

  it('returns 200 with correct response fields on successful delete', async () => {
    const response = await callRoute()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      txDigest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      assetsOnChainId: ASSETS_ID,
      assetName: 'avatar',
      versionIndex: 0,
    })
    expect(body.deletedAt).toBeDefined()
  })

  it('stores idempotency record after successful delete', async () => {
    await callRoute()

    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        routeKey: 'assets:delete',
        txDigest: TX_DIGEST,
        actorKey: 'member-1',
        resourceKey: `${SOUL_ID}:avatar:0`,
        statusCode: 200,
      }),
    )
  })

  it('calls markAssetVersionDeleted with correct params', async () => {
    await callRoute()

    expect(mockedMarkAssetVersionDeleted).toHaveBeenCalledWith({
      assetsOnChainId: ASSETS_ID,
      assetName: 'avatar',
      versionIndex: 0,
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

  it('returns 422 when event soul ID does not match', async () => {
    mockedExtractAssetVersionDeletedEvent.mockReturnValueOnce({
      assetsId: ASSETS_ID,
      soulId: `0x${'f'.repeat(64)}`,
      assetName: 'avatar',
      versionIndex: 0,
      deletedBy: AUTHOR_ADDRESS,
    })

    const response = await callRoute()

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction deleted a different asset version',
    })
  })

  it('returns 422 when event asset name does not match', async () => {
    mockedExtractAssetVersionDeletedEvent.mockReturnValueOnce({
      assetsId: ASSETS_ID,
      soulId: SOUL_ID,
      assetName: 'different-asset',
      versionIndex: 0,
      deletedBy: AUTHOR_ADDRESS,
    })

    const response = await callRoute()

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction deleted a different asset version',
    })
  })

  it('returns 429 when rate limited', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })

    const response = await callRoute()

    expect(response.status).toBe(429)
  })
})
