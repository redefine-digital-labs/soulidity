import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
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
const mockedExtractSoulMetadataMutationEvent = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@/lib/rate-limit', () => ({
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
  extractSoulMetadataMutationEvent: mockedExtractSoulMetadataMutationEvent,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
}))

vi.mock('@/lib/soulidity/request', () => ({
  parseRequiredTxDigest: mockedParseRequiredTxDigest,
}))

const SOUL_DETAIL = {
  onChainId: SOUL_ID,
  stateOnChainId: STATE_ID,
  memoryOnChainId: MEMORY_ID,
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
  return new Request(`http://localhost/api/souls/${SOUL_ID}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/souls/[id]/metadata', () => {
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
    mockedExtractSoulMetadataMutationEvent.mockReturnValue({
      kind: 'blob_upserted',
      soulId: SOUL_ID,
      metadataId: `0x${'5'.repeat(64)}`,
      updaterAddress: AUTHOR_ADDRESS,
      key: 'sprite.config.v1',
    })
    mockedSyncSoulProjectionFromChain.mockResolvedValue({
      onChainId: SOUL_ID,
      metadataOnChainId: `0x${'5'.repeat(64)}`,
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 2,
      activeSpriteDownloadPolicy: 'owner_only',
      activeVoiceAssetName: null,
      activeVoiceVersionIndex: null,
      activeVoiceDownloadPolicy: null,
      spriteConfigJson: '{"fps":12}',
      spriteMoodMapJson: '{"idle":"idle"}',
      voiceConfigJson: null,
    })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute(body?: Record<string, unknown>) {
    const { POST } = await import('../../web/app/api/souls/[id]/metadata/route.ts')
    return POST(makeRequest(body) as never, { params: Promise.resolve({ id: SOUL_ID }) })
  }

  it('returns mirrored metadata object fields after a successful metadata update sync', async () => {
    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      txDigest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      metadataOnChainId: `0x${'5'.repeat(64)}`,
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 2,
      activeSpriteDownloadPolicy: 'owner_only',
      activeVoiceAssetName: null,
      activeVoiceVersionIndex: null,
      activeVoiceDownloadPolicy: null,
      spriteConfigJson: '{"fps":12}',
      spriteMoodMapJson: '{"idle":"idle"}',
      voiceConfigJson: null,
    })
    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith({
      routeKey: 'metadata:update',
      txDigest: TX_DIGEST,
      actorKey: 'member-1',
      resourceKey: SOUL_ID,
      statusCode: 200,
      responseBody: {
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        metadataOnChainId: `0x${'5'.repeat(64)}`,
        activeSpriteAssetName: 'persona-sprite',
        activeSpriteVersionIndex: 2,
        activeSpriteDownloadPolicy: 'owner_only',
        activeVoiceAssetName: null,
        activeVoiceVersionIndex: null,
        activeVoiceDownloadPolicy: null,
        spriteConfigJson: '{"fps":12}',
        spriteMoodMapJson: '{"idle":"idle"}',
        voiceConfigJson: null,
      },
    })
  })

  it('returns cleared metadata bindings after a successful delete sync', async () => {
    mockedExtractSoulMetadataMutationEvent.mockReturnValueOnce({
      kind: 'blob_deleted',
      soulId: SOUL_ID,
      metadataId: `0x${'5'.repeat(64)}`,
      updaterAddress: AUTHOR_ADDRESS,
      key: 'sprite.config.v1',
    })
    mockedSyncSoulProjectionFromChain.mockResolvedValueOnce({
      onChainId: SOUL_ID,
      metadataOnChainId: `0x${'5'.repeat(64)}`,
      activeSpriteAssetName: null,
      activeSpriteVersionIndex: null,
      activeSpriteDownloadPolicy: null,
      activeVoiceAssetName: null,
      activeVoiceVersionIndex: null,
      activeVoiceDownloadPolicy: null,
      spriteConfigJson: null,
      spriteMoodMapJson: null,
      voiceConfigJson: null,
    })

    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      txDigest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      metadataOnChainId: `0x${'5'.repeat(64)}`,
      activeSpriteAssetName: null,
      activeSpriteVersionIndex: null,
      activeSpriteDownloadPolicy: null,
      activeVoiceAssetName: null,
      activeVoiceVersionIndex: null,
      activeVoiceDownloadPolicy: null,
      spriteConfigJson: null,
      spriteMoodMapJson: null,
      voiceConfigJson: null,
    })
  })

  it('returns 422 when the transaction updated a different soul', async () => {
    mockedExtractSoulMetadataMutationEvent.mockReturnValueOnce({
      kind: 'sprite',
      soulId: `0x${'7'.repeat(64)}`,
      metadataId: `0x${'5'.repeat(64)}`,
      updaterAddress: AUTHOR_ADDRESS,
      key: null,
    })

    const response = await callRoute()

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction updated metadata for a different Soul',
    })
    expect(mockedSyncSoulProjectionFromChain).not.toHaveBeenCalled()
  })
})
