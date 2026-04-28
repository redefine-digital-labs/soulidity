import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedCreateSealClient = vi.hoisted(() => vi.fn())
const mockedCreateSealEnvelopeSidecar = vi.hoisted(() => vi.fn())
const mockedCreateMemoryEntrySealEnvelopeSidecar = vi.hoisted(() => vi.fn())
const mockedCreateSkillVersionSealEnvelopeSidecar = vi.hoisted(() => vi.fn())
const mockedExtractSoulMintedToKioskEvent = vi.hoisted(() => vi.fn())
const mockedExtractMemoryEntryAppendedEvent = vi.hoisted(() => vi.fn())
const mockedExtractSkillVersionAppendedEvent = vi.hoisted(() => vi.fn())
const mockedExtractAssetVersionAppendedEvent = vi.hoisted(() => vi.fn())
const mockedExtractContentAccessListCreatedEvent = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedUpsertMemoryEntryProjection = vi.hoisted(() => vi.fn())
const mockedUpsertSkillVersionProjection = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedResolveWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedBuildSyncSealSidecars = vi.hoisted(() => vi.fn())
const mockedUpsertAssetVersionProjection = vi.hoisted(() => vi.fn())
const mockedUpsertContentAccessProjection = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/services/seal', () => ({
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  createSealClient: mockedCreateSealClient,
}))

vi.mock('@web/lib/services/seal-crypto', () => ({
  createSealEnvelopeSidecar: mockedCreateSealEnvelopeSidecar,
  createMemoryEntrySealEnvelopeSidecar: mockedCreateMemoryEntrySealEnvelopeSidecar,
  createSkillVersionSealEnvelopeSidecar: mockedCreateSkillVersionSealEnvelopeSidecar,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractSoulMintedToKioskEvent: mockedExtractSoulMintedToKioskEvent,
  tryExtractMemoryEntryAppendedEvent: mockedExtractMemoryEntryAppendedEvent,
  tryExtractSkillVersionAppendedEvent: mockedExtractSkillVersionAppendedEvent,
  tryExtractAssetVersionAppendedEvent: mockedExtractAssetVersionAppendedEvent,
  tryExtractContentAccessListCreatedEvent: mockedExtractContentAccessListCreatedEvent,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
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

vi.mock('@/lib/soulidity/mirror/upsert-content-access', () => ({
  upsertContentAccessProjection: mockedUpsertContentAccessProjection,
}))

vi.mock('@/lib/soulidity/mirror/upsert-memory', () => ({
  upsertMemoryEntryProjection: mockedUpsertMemoryEntryProjection,
}))

vi.mock('@/lib/soulidity/mirror/upsert-skill', () => ({
  upsertSkillVersionProjection: mockedUpsertSkillVersionProjection,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/soulidity/request', () => ({
  parseRequiredTxDigest: mockedParseRequiredTxDigest,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
  getSoulStateObject: mockedGetSoulStateObject,
  resolveWalrusBlobId: mockedResolveWalrusBlobId,
}))

vi.mock('@/lib/soulidity/server', () => ({
  assertTransactionSender: mockedAssertTransactionSender,
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
}))

const TX_DIGEST = '11111111111111111111111111111111'
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const RESOLVED_PACKAGE_ID = `0x${'8'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
const SKILLS_ID = `0x${'5'.repeat(64)}`
const WALLET_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_SIDECAR = { version: 1, mode: 'seal-envelope', documentId: '0xsoul-doc', encryptedDek: 'soul-encrypted', iv: 'soul-iv' }
const MEMORY_SIDECAR = { version: 1, mode: 'seal-envelope', documentId: '0xmemory-doc', encryptedDek: 'memory-encrypted', iv: 'memory-iv' }
const SKILLS_SIDECAR = { version: 1, mode: 'seal-envelope', documentId: '0xskill-doc', encryptedDek: 'skill-encrypted', iv: 'skill-iv' }

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/wrap-link/personal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/wrap-link/personal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: {
        memberId: 'member-1',
      },
      walletAddresses: [WALLET_ADDRESS],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedParseRequiredTxDigest.mockReturnValue(TX_DIGEST)
    mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedReadTransactionSender.mockReturnValue(WALLET_ADDRESS)
    mockedAssertTransactionSender.mockReturnValue(null)
    mockedExtractSoulMintedToKioskEvent.mockReturnValue({
      soulId: SOUL_ID,
      stateId: STATE_ID,
      memoryId: MEMORY_ID,
    })
    mockedExtractMemoryEntryAppendedEvent.mockReturnValue({
      memoryId: MEMORY_ID,
      soulId: SOUL_ID,
      timestampKey: 1710000000000,
      writerAddress: WALLET_ADDRESS,
      writerKind: 0,
      createdAtMs: 1710000000000,
      blobObjectId: `0x${'7'.repeat(64)}`,
    })
    mockedExtractSkillVersionAppendedEvent.mockReturnValue({
      skillsId: SKILLS_ID,
      soulId: SOUL_ID,
      skillName: 'reporter',
      versionIndex: 0,
      visibility: 'private',
      createdAtMs: 1710000000001,
      blobObjectId: `0x${'8'.repeat(64)}`,
    })
    mockedResolveWalrusBlobId.mockResolvedValue('walrus-blob-id-mock')
    mockedBuildSyncSealSidecars.mockResolvedValue({
      soulSidecar: { version: 1, mode: 'seal-envelope', documentId: '0xsoul-doc', encryptedDek: 'soul-encrypted', iv: 'soul-iv' },
      memorySidecar: { version: 1, mode: 'seal-envelope', documentId: '0xmemory-doc', encryptedDek: 'memory-encrypted', iv: 'memory-iv' },
      skillsSidecar: { version: 1, mode: 'seal-envelope', documentId: '0xskill-doc', encryptedDek: 'skill-encrypted', iv: 'skill-iv' },
      assetsSidecar: null,
    })
    mockedExtractAssetVersionAppendedEvent.mockReturnValue(null)
    mockedExtractContentAccessListCreatedEvent.mockReturnValue(null)
    mockedUpsertMemoryEntryProjection.mockResolvedValue(undefined)
    mockedUpsertSkillVersionProjection.mockResolvedValue(undefined)
    mockedUpsertAssetVersionProjection.mockResolvedValue(undefined)
    mockedSyncSoulProjectionFromChain.mockResolvedValue({
      onChainId: SOUL_ID,
      provenanceKind: 'personal-join',
      originRef: null,
    })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute(body: Record<string, unknown>) {
    const { POST } = await import('../../web/app/api/wrap-link/personal/route.ts')
    return POST(makeRequest(body) as any)
  }

  it('accepts client-built Seal sidecars before syncing the projection', async () => {
    const response = await callRoute({
      txDigest: TX_DIGEST,
      sealSidecar: SOUL_SIDECAR,
      memorySealSidecar: MEMORY_SIDECAR,
      skillsSealSidecar: SKILLS_SIDECAR,
    })

    expect(response.status).toBe(200)
    expect(mockedBuildSyncSealSidecars).toHaveBeenCalledWith(expect.objectContaining({
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      stateObjectId: STATE_ID,
      soulSidecar: SOUL_SIDECAR,
      memorySidecar: MEMORY_SIDECAR,
      skillsSidecar: SKILLS_SIDECAR,
    }))
    expect(mockedSyncSoulProjectionFromChain).toHaveBeenCalledWith(expect.objectContaining({
      soulObjectId: SOUL_ID,
      stateObjectId: STATE_ID,
      memoryObjectId: MEMORY_ID,
      sealSidecar: expect.objectContaining({ documentId: '0xsoul-doc' }),
    }))
    expect(mockedUpsertMemoryEntryProjection).toHaveBeenCalledWith(expect.objectContaining({
      sealSidecar: expect.objectContaining({ documentId: '0xmemory-doc' }),
    }))
    expect(mockedUpsertSkillVersionProjection).toHaveBeenCalledWith(expect.objectContaining({
      sealSidecar: expect.objectContaining({ documentId: '0xskill-doc' }),
    }))
  })

  it('rejects raw DEK envelopes before projection sync', async () => {
    const response = await callRoute({
      txDigest: TX_DIGEST,
      sealSidecar: 'char-envelope',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'sealSidecar must be a Seal sidecar object, not a raw DEK envelope',
    })
    expect(mockedBuildSyncSealSidecars).not.toHaveBeenCalled()
    expect(mockedSyncSoulProjectionFromChain).not.toHaveBeenCalled()
  })

  it('returns 503 when Seal runtime is unavailable while validating provided sidecars', async () => {
    const { SealSidecarSyncConfigError } = await import('../../web/lib/soulidity/mirror/build-seal-sidecars') as any
    mockedBuildSyncSealSidecars.mockRejectedValueOnce(
      new SealSidecarSyncConfigError('Seal is not configured for Soul publishing'),
    )

    const response = await callRoute({
      txDigest: TX_DIGEST,
      sealSidecar: SOUL_SIDECAR,
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Seal is not configured for Soul publishing',
    })
    expect(mockedSyncSoulProjectionFromChain).not.toHaveBeenCalled()
  })
})
