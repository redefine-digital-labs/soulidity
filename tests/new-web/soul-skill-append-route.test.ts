import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
const SKILLS_ID = `0x${'5'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'6'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'
const BLOB_ID = 'walrus-blob-id-abc'

const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedFindSoulSkillVersionsPageByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedResolveWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedExtractAllSkillVersionAppendedEvents = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedBuildSyncSealSidecars = vi.hoisted(() => vi.fn())
const mockedUpsertSkillVersionProjection = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
  findSoulSkillVersionsPageByRouteId: mockedFindSoulSkillVersionsPageByRouteId,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractAllSkillVersionAppendedEvents: mockedExtractAllSkillVersionAppendedEvents,
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

vi.mock('@/lib/soulidity/mirror/upsert-skill', () => ({
  upsertSkillVersionProjection: mockedUpsertSkillVersionProjection,
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
  return new Request(`http://localhost/api/souls/${SOUL_ID}/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/souls/[id]/skills (append) per-event sidecar validation', () => {
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
    mockedSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: SOUL_ID })
    mockedBuildSyncSealSidecars.mockResolvedValue({
      soulSidecar: null,
      memorySidecar: null,
      skillsSidecar: null,
      assetsSidecar: null,
    })
    mockedResolveWalrusBlobId.mockResolvedValue(BLOB_ID)
    mockedUpsertSkillVersionProjection.mockResolvedValue({
      skillName: 'codex',
      versionIndex: 0,
    })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute(body?: Record<string, unknown>) {
    const { POST } = await import('../../web/app/api/souls/[id]/skills/route.ts')
    return POST(makeRequest(body) as any, { params: Promise.resolve({ id: SOUL_ID }) })
  }

  it('rejects multi-event append when later private events have no sidecar (R-002)', async () => {
    // Two private appended events but `skillsSealSidecars` only covers index 0.
    // Pre-fix the loop assigned the legacy `providedSkillsSidecar` to index 0
    // and `null` to index 1, then mirrored a private skill version with no
    // Seal envelope (permanently undecryptable). Per-event validation must
    // reject with 422 BEFORE any DB write.
    mockedExtractAllSkillVersionAppendedEvents.mockReturnValueOnce([
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 1,
        visibility: 'private',
        createdAtMs: 1700000000000,
        blobObjectId: BLOB_OBJECT_ID,
      },
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 2,
        visibility: 'private',
        createdAtMs: 1700000000001,
        blobObjectId: BLOB_OBJECT_ID,
      },
    ])

    const validSidecar = { ciphertext: 'aaaa', dekEnvelope: 'bbbb' }
    const response = await callRoute({
      txDigest: TX_DIGEST,
      skillsSealSidecars: [validSidecar],
    })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'skillsSealSidecars[1] is required for private skill version at index 1',
    })
    expect(mockedUpsertSkillVersionProjection).not.toHaveBeenCalled()
  })

  it('rejects multi-event append when only the legacy single sidecar is provided (R-002)', async () => {
    // Legacy `skillsSealSidecar` is a single envelope, valid only for a
    // single-event append. A multi-event request that supplies only the legacy
    // field cannot satisfy index >= 1 and must be rejected.
    mockedExtractAllSkillVersionAppendedEvents.mockReturnValueOnce([
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 1,
        visibility: 'private',
        createdAtMs: 1700000000000,
        blobObjectId: BLOB_OBJECT_ID,
      },
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 2,
        visibility: 'private',
        createdAtMs: 1700000000001,
        blobObjectId: BLOB_OBJECT_ID,
      },
    ])

    const validSidecar = { ciphertext: 'aaaa', dekEnvelope: 'bbbb' }
    const response = await callRoute({
      txDigest: TX_DIGEST,
      skillsSealSidecar: validSidecar,
    })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'skillsSealSidecars[0] is required for private skill version at index 0',
    })
    expect(mockedUpsertSkillVersionProjection).not.toHaveBeenCalled()
  })

  it('accepts single-event append with the legacy sidecar shape', async () => {
    mockedExtractAllSkillVersionAppendedEvents.mockReturnValueOnce([
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 1,
        visibility: 'private',
        createdAtMs: 1700000000000,
        blobObjectId: BLOB_OBJECT_ID,
      },
    ])
    mockedUpsertSkillVersionProjection.mockResolvedValueOnce({ skillName: 'codex', versionIndex: 1 })

    const validSidecar = { ciphertext: 'aaaa', dekEnvelope: 'bbbb' }
    const response = await callRoute({
      txDigest: TX_DIGEST,
      skillsSealSidecar: validSidecar,
    })

    expect(response.status).toBe(200)
    expect(mockedUpsertSkillVersionProjection).toHaveBeenCalledTimes(1)
  })

  it('accepts multi-event append when skillsSealSidecars covers each private event', async () => {
    mockedExtractAllSkillVersionAppendedEvents.mockReturnValueOnce([
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 1,
        visibility: 'private',
        createdAtMs: 1700000000000,
        blobObjectId: BLOB_OBJECT_ID,
      },
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 2,
        visibility: 'private',
        createdAtMs: 1700000000001,
        blobObjectId: BLOB_OBJECT_ID,
      },
    ])
    mockedUpsertSkillVersionProjection
      .mockResolvedValueOnce({ skillName: 'codex', versionIndex: 1 })
      .mockResolvedValueOnce({ skillName: 'codex', versionIndex: 2 })

    const sidecarA = { ciphertext: 'aa', dekEnvelope: 'bb' }
    const sidecarB = { ciphertext: 'cc', dekEnvelope: 'dd' }
    const response = await callRoute({
      txDigest: TX_DIGEST,
      skillsSealSidecars: [sidecarA, sidecarB],
    })

    expect(response.status).toBe(200)
    expect(mockedUpsertSkillVersionProjection).toHaveBeenCalledTimes(2)
  })

  it('does not require sidecars when all appended events are public', async () => {
    mockedExtractAllSkillVersionAppendedEvents.mockReturnValueOnce([
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 1,
        visibility: 'public',
        createdAtMs: 1700000000000,
        blobObjectId: BLOB_OBJECT_ID,
      },
      {
        skillsId: SKILLS_ID,
        soulId: SOUL_ID,
        skillName: 'codex',
        versionIndex: 2,
        visibility: 'public',
        createdAtMs: 1700000000001,
        blobObjectId: BLOB_OBJECT_ID,
      },
    ])
    mockedUpsertSkillVersionProjection
      .mockResolvedValueOnce({ skillName: 'codex', versionIndex: 1 })
      .mockResolvedValueOnce({ skillName: 'codex', versionIndex: 2 })

    const response = await callRoute({ txDigest: TX_DIGEST })

    expect(response.status).toBe(200)
    expect(mockedUpsertSkillVersionProjection).toHaveBeenCalledTimes(2)
  })
})
