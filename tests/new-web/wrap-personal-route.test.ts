import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedUnsealDekEnvelope = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedCreateSealClient = vi.hoisted(() => vi.fn())
const mockedCreateSealEnvelopeSidecar = vi.hoisted(() => vi.fn())
const mockedCreateSkillVersionSealEnvelopeSidecar = vi.hoisted(() => vi.fn())
const mockedExtractSoulMintedToKioskEvent = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetSoulSkillsObject = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/services/dek-envelope', () => ({
  unsealDekEnvelope: mockedUnsealDekEnvelope,
}))

vi.mock('@web/lib/services/seal', () => ({
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  createSealClient: mockedCreateSealClient,
}))

vi.mock('@web/lib/services/seal-crypto', () => ({
  createSealEnvelopeSidecar: mockedCreateSealEnvelopeSidecar,
  createSkillVersionSealEnvelopeSidecar: mockedCreateSkillVersionSealEnvelopeSidecar,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractSoulMintedToKioskEvent: mockedExtractSoulMintedToKioskEvent,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
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
  getSoulSkillsObject: mockedGetSoulSkillsObject,
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
const SKILL_VERSION_ID = `0x${'6'.repeat(64)}`
const WALLET_ADDRESS = `0x${'1'.repeat(64)}`

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
    mockedGetSealRuntimeConfig.mockReturnValue({
      threshold: 2,
      serverConfigs: [{ objectId: '0xserver', weight: 1 }],
    })
    mockedCreateSealClient.mockReturnValue({ encrypt: vi.fn() })
    mockedGetSoulStateObject.mockResolvedValue({
      packageId: RESOLVED_PACKAGE_ID,
      skillsId: SKILLS_ID,
    })
    mockedGetSoulSkillsObject.mockResolvedValue({
      latestVersionId: SKILL_VERSION_ID,
    })
    mockedUnsealDekEnvelope.mockImplementation((envelope: string) => ({
      dek: Uint8Array.from({ length: 32 }, envelope === 'skills-envelope' ? () => 2 : () => 1),
      iv: Uint8Array.from({ length: 12 }, envelope === 'skills-envelope' ? () => 4 : () => 3),
      contentHash: envelope === 'skills-envelope' ? 'b'.repeat(64) : 'a'.repeat(64),
      mimeType: envelope === 'skills-envelope' ? 'application/zip' : 'text/markdown',
      fileName: envelope === 'skills-envelope' ? 'skills.zip' : 'character.md',
    }))
    mockedCreateSealEnvelopeSidecar.mockResolvedValue({
      version: 1,
      mode: 'seal-envelope',
      documentId: '0xsoul-doc',
      encryptedDek: 'soul-encrypted',
      iv: 'soul-iv',
      cipher: 'AES-GCM-256',
      mimeType: 'text/markdown',
      fileName: 'character.md',
      contentHash: 'a'.repeat(64),
    })
    mockedCreateSkillVersionSealEnvelopeSidecar.mockResolvedValue({
      version: 1,
      mode: 'seal-envelope',
      documentId: '0xskill-doc',
      encryptedDek: 'skill-encrypted',
      iv: 'skill-iv',
      cipher: 'AES-GCM-256',
      mimeType: 'application/zip',
      fileName: 'skills.zip',
      contentHash: 'b'.repeat(64),
    })
    mockedSyncSoulProjectionFromChain.mockResolvedValue({
      onChainId: SOUL_ID,
      provenanceKind: 'personal-join',
      originRef: null,
    })
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute(body: Record<string, unknown>) {
    const { POST } = await import('../../new-web/app/api/wrap-link/personal/route.ts')
    return POST(makeRequest(body) as any)
  }

  it('converts string DEK envelopes into Seal sidecars before syncing the projection', async () => {
    const response = await callRoute({
      txDigest: TX_DIGEST,
      category: 'personal-join',
      sealSidecar: 'char-envelope',
      skillsSealSidecar: 'skills-envelope',
    })

    expect(response.status).toBe(200)
    expect(mockedUnsealDekEnvelope).toHaveBeenNthCalledWith(1, 'char-envelope')
    expect(mockedUnsealDekEnvelope).toHaveBeenNthCalledWith(2, 'skills-envelope')
    expect(mockedCreateSealEnvelopeSidecar).toHaveBeenCalledWith(expect.objectContaining({
      packageId: RESOLVED_PACKAGE_ID,
      soulObjectId: SOUL_ID,
      mimeType: 'text/markdown',
      fileName: 'character.md',
    }))
    expect(mockedCreateSkillVersionSealEnvelopeSidecar).toHaveBeenCalledWith(expect.objectContaining({
      packageId: RESOLVED_PACKAGE_ID,
      versionObjectId: SKILL_VERSION_ID,
      mimeType: 'application/zip',
      fileName: 'skills.zip',
    }))
    expect(mockedSyncSoulProjectionFromChain).toHaveBeenCalledWith(expect.objectContaining({
      soulObjectId: SOUL_ID,
      stateObjectId: STATE_ID,
      memoryObjectId: MEMORY_ID,
      sealSidecar: expect.objectContaining({ documentId: '0xsoul-doc' }),
      latestSkillVersionSealSidecar: expect.objectContaining({ documentId: '0xskill-doc' }),
    }))
  })

  it('returns 503 when Seal runtime is unavailable for a pending DEK envelope', async () => {
    mockedGetSealRuntimeConfig.mockReturnValueOnce({
      threshold: 0,
      serverConfigs: [],
    })

    const response = await callRoute({
      txDigest: TX_DIGEST,
      sealSidecar: 'char-envelope',
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Seal is not configured for Soul publishing',
    })
    expect(mockedSyncSoulProjectionFromChain).not.toHaveBeenCalled()
  })
})
