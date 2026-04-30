import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'
const SOUL_SIDECAR = { version: 1, mode: 'seal-envelope', documentId: '0xsoul-doc', encryptedDek: 'soul-encrypted', iv: 'soul-iv' }

const mockedRequireSoulCreateWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    update: vi.fn(),
  },
}))
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedTakeBestEffortRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedResolveWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedExtractSoulMintedToKioskEvent = vi.hoisted(() => vi.fn())
const mockedTryExtractMemoryEntryAppendedEvent = vi.hoisted(() => vi.fn())
const mockedTryExtractSkillVersionAppendedEvent = vi.hoisted(() => vi.fn())
const mockedTryExtractAssetVersionAppendedEvent = vi.hoisted(() => vi.fn())
const mockedTryExtractContentAccessListCreatedEvent = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedBuildSyncSealSidecars = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedUpsertMemoryEntryProjection = vi.hoisted(() => vi.fn())
const mockedUpsertSkillVersionProjection = vi.hoisted(() => vi.fn())
const mockedUpsertAssetVersionProjection = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireSoulCreateWalletIdentity: mockedRequireSoulCreateWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  takeBestEffortRateLimitToken: mockedTakeBestEffortRateLimitToken,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  resolveWalrusBlobId: mockedResolveWalrusBlobId,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractSoulMintedToKioskEvent: mockedExtractSoulMintedToKioskEvent,
  tryExtractMemoryEntryAppendedEvent: mockedTryExtractMemoryEntryAppendedEvent,
  tryExtractSkillVersionAppendedEvent: mockedTryExtractSkillVersionAppendedEvent,
  tryExtractAssetVersionAppendedEvent: mockedTryExtractAssetVersionAppendedEvent,
  tryExtractContentAccessListCreatedEvent: mockedTryExtractContentAccessListCreatedEvent,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/mirror/build-seal-sidecars', () => ({
  SealSidecarSyncConfigError: class SealSidecarSyncConfigError extends Error {},
  buildSyncSealSidecars: mockedBuildSyncSealSidecars,
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
}))

vi.mock('@/lib/soulidity/mirror/upsert-memory', () => ({
  upsertMemoryEntryProjection: mockedUpsertMemoryEntryProjection,
}))

vi.mock('@/lib/soulidity/mirror/upsert-skill', () => ({
  upsertSkillVersionProjection: mockedUpsertSkillVersionProjection,
}))

vi.mock('@/lib/soulidity/mirror/upsert-asset', () => ({
  upsertAssetVersionProjection: mockedUpsertAssetVersionProjection,
}))

describe('soul publish route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireSoulCreateWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1', accountId: 'account-1', kind: 'human' },
      walletAddresses: [AUTHOR_ADDRESS],
      primarySuiAddress: AUTHOR_ADDRESS,
    })
    mockedAssertTransactionSender.mockReturnValue(null)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedTakeBestEffortRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedReadTransactionSender.mockReturnValue(AUTHOR_ADDRESS)
    mockedResolveWalrusBlobId.mockResolvedValue('blob-memory')
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedExtractSoulMintedToKioskEvent.mockReturnValue({
      soulId: SOUL_ID,
      stateId: STATE_ID,
      memoryId: MEMORY_ID,
    })
    mockedTryExtractMemoryEntryAppendedEvent.mockReturnValue(null)
    mockedTryExtractSkillVersionAppendedEvent.mockReturnValue(null)
    mockedTryExtractAssetVersionAppendedEvent.mockReturnValue(null)
    mockedTryExtractContentAccessListCreatedEvent.mockReturnValue(null)
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedBuildSyncSealSidecars.mockResolvedValue({
      soulSidecar: null,
      memorySidecar: null,
      skillsSidecar: null,
      assetsSidecar: null,
    })
    mockedSyncSoulProjectionFromChain.mockResolvedValue({
      onChainId: SOUL_ID,
      stateOnChainId: STATE_ID,
      memoryOnChainId: MEMORY_ID,
      skillsOnChainId: null,
      assetsOnChainId: null,
      accessListOnChainId: null,
      listingStatus: 'held',
    })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
    mockedPrisma.soulAsset.update.mockResolvedValue(undefined)
  })

  function createRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as any
  }

  it('returns cached publish sync responses for duplicate tx digests', async () => {
    mockedGetStoredSoulidityTxSync.mockResolvedValueOnce({
      statusCode: 200,
      responseBody: { soulOnChainId: SOUL_ID, listingStatus: 'held' },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(createRequest({
      txDigest: TX_DIGEST,

      tags: ['typescript'],
      previewImages: ['https://example.com/cover.png'],
      sealSidecar: 'envelope',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      listingStatus: 'held',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('passes through auth failures from the desktop-compatible guard', async () => {
    mockedRequireSoulCreateWalletIdentity.mockResolvedValueOnce({
      error: Response.json({ error: 'Multiple Sui wallets are bound to this account' }, { status: 409 }),
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(createRequest({
      txDigest: TX_DIGEST,

      tags: ['typescript'],
      previewImages: ['https://example.com/cover.png'],
      sealSidecar: 'envelope',
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Multiple Sui wallets are bound to this account',
    })
  })

  it('rejects publish sync when the transaction sender does not match the bound wallet', async () => {
    mockedAssertTransactionSender.mockReturnValueOnce(
      Response.json({ error: 'Transaction sender does not match the signed-in wallet' }, { status: 403 }),
    )

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(createRequest({
      txDigest: TX_DIGEST,

      tags: ['typescript'],
      previewImages: ['https://example.com/cover.png'],
      sealSidecar: 'envelope',
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction sender does not match the signed-in wallet',
    })
    expect(mockedSyncSoulProjectionFromChain).not.toHaveBeenCalled()
  })

  it('rate limits publish sync before chain reads', async () => {
    mockedTakeBestEffortRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(createRequest({
      txDigest: TX_DIGEST,

      tags: ['typescript'],
      previewImages: ['https://example.com/cover.png'],
      sealSidecar: 'envelope',
    }))

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many Soulidity publish sync requests, try again later',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('uses best-effort rate limiting for post-chain publish sync', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(createRequest({
      txDigest: TX_DIGEST,
      tags: ['typescript'],
      previewImages: ['https://example.com/cover.png'],
      sealSidecar: SOUL_SIDECAR,
    }))

    expect(response.status).toBe(200)
    expect(mockedTakeBestEffortRateLimitToken).toHaveBeenCalledWith(
      'soul-publish:member-1',
      { max: 10, windowMs: 5 * 60_000 },
    )
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
  })

  it('mirrors a successful desktop publish and stores the tx sync response', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(createRequest({
      txDigest: TX_DIGEST,

      tags: ['typescript', 'desktop'],
      previewImages: ['https://example.com/cover.png'],
      sealSidecar: SOUL_SIDECAR,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      txDigest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      stateOnChainId: STATE_ID,
      memoryOnChainId: MEMORY_ID,
      foundingMemoryTimestampKey: null,
      skillsOnChainId: null,
      initialSkillName: null,
      initialSkillVersionIndex: null,
      assetsOnChainId: null,
      accessListOnChainId: null,
      initialAssetName: null,
      initialAssetVersionIndex: null,
      listingStatus: 'held',
    })

    expect(mockedSyncSoulProjectionFromChain).toHaveBeenCalledWith(expect.objectContaining({
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      stateObjectId: STATE_ID,
      memoryObjectId: MEMORY_ID,

      tags: ['typescript', 'desktop'],
      creatorMemberId: 'member-1',
      currentOwnerMemberId: 'member-1',
    }))
    expect(mockedBuildSyncSealSidecars).toHaveBeenCalledWith(expect.objectContaining({
      soulSidecar: SOUL_SIDECAR,
    }))
    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith(expect.objectContaining({
      routeKey: 'publish',
      txDigest: TX_DIGEST,
      actorKey: 'member-1',
      resourceKey: SOUL_ID,
      statusCode: 200,
    }))
  })
})
