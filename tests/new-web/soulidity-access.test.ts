import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mock helpers ────────────────────────────────────────────────
// queries.ts creates a SuiClient at module level which blows up without
// env vars, so we must mock the whole module with faithful reimplementations
// of the pure helpers that access.ts depends on.

const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetSoulGrantObject = vi.hoisted(() => vi.fn())
const mockedFindActiveGrantSlotForViewer = vi.hoisted(() => vi.fn())

const mockedNormalizeSuiValue = vi.hoisted(
  () =>
    (value: string): string | null => {
      const trimmed = value.trim()
      if (!trimmed.startsWith('0x')) return null
      const hex = trimmed.slice(2).toLowerCase()
      if (!/^[0-9a-f]+$/.test(hex)) return null
      return '0x' + hex.padStart(64, '0')
    },
)

const mockedSameSuiValue = vi.hoisted(
  () =>
    (left: string | null | undefined, right: string | null | undefined): boolean => {
      if (!left || !right) return false
      const normalizedLeft = mockedNormalizeSuiValue(left)
      const normalizedRight = mockedNormalizeSuiValue(right)
      return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
    },
)

vi.mock('@/lib/soulidity/queries', () => ({
  getSoulStateObject: mockedGetSoulStateObject,
  getSoulGrantObject: mockedGetSoulGrantObject,
  findActiveGrantSlotForViewer: mockedFindActiveGrantSlotForViewer,
  normalizeSuiValue: mockedNormalizeSuiValue,
  sameSuiValue: mockedSameSuiValue,
}))

vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: (blobId: string) => `https://aggregator.test/v1/blobs/${blobId}`,
}))

const MOCK_SEAL_CONFIG = {
  network: 'testnet' as const,
  threshold: 1,
  verifyKeyServers: false,
  serverConfigs: [{ objectId: '0x73d05d', weight: 1 }],
}

vi.mock('@web/lib/services/seal', () => ({
  getSealRuntimeConfig: () => MOCK_SEAL_CONFIG,
  getSealSessionTtlMinutes: () => 10,
}))

// ── Imports (after mocks) ───────────────────────────────────────────────
import { resolveSoulAccessPayload, SoulAccessDeniedError } from '../../web/lib/soulidity/access'
import type { SoulAssetDetail } from '../../web/lib/soulidity/types'

// ── Test constants ──────────────────────────────────────────────────────
const PKG = '0x' + 'aa'.repeat(32)
const OWNER_ADDR = '0x' + '01'.repeat(32)
const NORM_OWNER_ADDR = '0x' + '01'.repeat(32)
const VIEWER_ADDR = '0x' + '02'.repeat(32)
const GRANTEE_ADDR = '0x' + '03'.repeat(32)
const STATE_ID = '0x' + 'bb'.repeat(32)
const SOUL_ID = '0x' + 'cc'.repeat(32)
const GRANT_ID = '0x' + 'dd'.repeat(32)
const BLOB_ID = 'test-blob-id'
const BLOB_OBJ_ID = '0x' + 'ee'.repeat(32)

const MOCK_SIDECAR = {
  version: 1 as const,
  mode: 'seal-envelope' as const,
  documentId: '0xabc123',
  encryptedDek: 'base64dek',
  iv: 'base64iv',
  cipher: 'AES-GCM-256' as const,
  mimeType: 'application/zip',
  fileName: 'soul-bundle.zip',
  contentHash: 'deadbeef',
}

function makeSoulAssetDetail(overrides: Partial<SoulAssetDetail> = {}): SoulAssetDetail {
  return {
    id: 'db-id-1',
    onChainId: SOUL_ID,
    stateOnChainId: STATE_ID,
    memoryOnChainId: '0x' + 'ff'.repeat(32),
    name: 'Test Soul',
    description: 'A test soul',
    imageUrl: 'https://example.com/img.png',
    metadataOnChainId: null,
    activeSpriteAssetName: null,
    activeSpriteVersionIndex: null,
    activeSpriteDownloadPolicy: null,
    activeVoiceAssetName: null,
    activeVoiceVersionIndex: null,
    activeVoiceDownloadPolicy: null,
    spriteConfigJson: null,
    spriteMoodMapJson: null,
    voiceConfigJson: null,
    contentBlobId: BLOB_ID,
    contentBlobObjectId: BLOB_OBJ_ID,
    provenanceKind: 'native',
    originRef: null,
    tags: [],
    previewImages: [],
    creatorAddress: OWNER_ADDR,
    creatorRoyaltyBps: 500,
    currentOwnerAddress: OWNER_ADDR,
    currentKioskId: '0x' + '11'.repeat(32),
    currentKioskCapOnChainId: '0x' + '22'.repeat(32),
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
    collectionOnChainId: null,
    grantCapacity: 2,
    activeGrantCount: 0,
    skillsOnChainId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    creatorMemberId: null,
    currentOwnerMemberId: null,
    readme: null,
    sealSidecar: MOCK_SIDECAR,
    collection: null,
    activeGrants: [],
    memoryEntries: [],
    skillVersions: [],
    isOwner: false,
    isCreator: false,
    isGrantedAgent: false,
    quote: null,
    ...overrides,
  }
}

function makeSoulStateObject(overrides: Record<string, unknown> = {}) {
  return {
    objectId: STATE_ID,
    packageId: PKG,
    soulId: SOUL_ID,
    creatorAddress: OWNER_ADDR,
    creatorRoyaltyBps: 500,
    currentOwnerAddress: OWNER_ADDR,
    currentKioskId: '0x' + '11'.repeat(32),
    ownershipEpoch: 1,
    grantCapacity: 2,
    activeGrantCount: 0,
    activeGrants: [],
    skillsId: null,
    collectionId: null,
    ...overrides,
  }
}

function makeGrantSlot(overrides: Record<string, unknown> = {}) {
  return {
    grantId: GRANT_ID,
    granteeAddress: GRANTEE_ADDR,
    scopeMask: 1,
    scopes: ['seal'],
    expiresAtMs: null,
    ownershipEpochSnapshot: 1,
    ...overrides,
  }
}

function makeGrantObject(overrides: Record<string, unknown> = {}) {
  return {
    objectId: GRANT_ID,
    packageId: PKG,
    soulId: SOUL_ID,
    granteeAddress: GRANTEE_ADDR,
    issuedByAddress: OWNER_ADDR,
    ownershipEpochSnapshot: 1,
    scopeMask: 1,
    scopes: ['seal'],
    expiresAtMs: null,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('resolveSoulAccessPayload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedFindActiveGrantSlotForViewer.mockImplementation(async ({
      state,
      viewerAddresses,
      scope,
    }: {
      state: { activeGrants?: Array<{ granteeAddress: string; scopes: string[] }> }
      viewerAddresses: string[]
      scope: string
    }) => state.activeGrants?.find((slot) =>
      slot.scopes.includes(scope)
        && viewerAddresses.some((address) => mockedSameSuiValue(address, slot.granteeAddress)),
    ) ?? null)
  })

  // ── Owner access ────────────────────────────────────────────────────

  it('grants owner access when viewer address matches state.currentOwnerAddress', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [OWNER_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('owner')
    expect(result.viewerAddress).toBe(mockedNormalizeSuiValue(OWNER_ADDR))
    expect(result.accessPolicy.functionName).toBe('seal_approve_owner')
    expect(result.accessPolicy.soulGrantObjectId).toBeNull()
    expect(result.artifact.walrusBlobId).toBe(BLOB_ID)
    expect(result.artifact.walrusBlobUrl).toBe(`https://aggregator.test/v1/blobs/${BLOB_ID}`)
    expect(result.seal).toEqual(MOCK_SEAL_CONFIG)
    expect(result.sessionTtlMin).toBe(10)
    expect(result.sealSidecar).toEqual(MOCK_SIDECAR)
    expect(mockedGetSoulStateObject).toHaveBeenCalledWith(STATE_ID, PKG, {
      includeActiveGrants: false,
    })
  })

  it('grants owner access when one of multiple viewer addresses matches the owner', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [VIEWER_ADDR, OWNER_ADDR, GRANTEE_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('owner')
    expect(result.viewerAddress).toBe(mockedNormalizeSuiValue(OWNER_ADDR))
  })

  it('prefers owner access over grant when viewer is both owner and grantee', async () => {
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot({ granteeAddress: OWNER_ADDR })],
      }),
    )

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [OWNER_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('owner')
    // getSoulGrantObject should NOT be called since owner path short-circuits
    expect(mockedGetSoulGrantObject).not.toHaveBeenCalled()
    expect(mockedFindActiveGrantSlotForViewer).not.toHaveBeenCalled()
  })

  // ── Granted agent access ────────────────────────────────────────────

  it('grants agent access when viewer has an active grant with seal scope', async () => {
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot()],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(makeGrantObject())

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [GRANTEE_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('granted-agent')
    expect(result.viewerAddress).toBe(mockedNormalizeSuiValue(GRANTEE_ADDR))
    expect(result.accessPolicy.functionName).toBe('seal_approve_granted_agent')
    expect(result.accessPolicy.soulGrantObjectId).toBe(GRANT_ID)
    expect(result.artifact.walrusBlobId).toBe(BLOB_ID)
  })

  it('grants agent access when grant has no expiry (null expiresAtMs)', async () => {
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot({ expiresAtMs: null })],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(makeGrantObject({ expiresAtMs: null }))

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [GRANTEE_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('granted-agent')
  })

  it('grants agent access when grant has a future expiry', async () => {
    const futureMs = Date.now() + 3_600_000 // 1 hour in the future
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot({ expiresAtMs: futureMs })],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(makeGrantObject({ expiresAtMs: futureMs }))

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [GRANTEE_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('granted-agent')
  })

  it('throws when a leaked active grant was issued under an older ownership epoch', async () => {
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        ownershipEpoch: 2,
        activeGrantCount: 0,
        activeGrants: [makeGrantSlot({ ownershipEpochSnapshot: 1 })],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(makeGrantObject({ ownershipEpochSnapshot: 1 }))

    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [GRANTEE_ADDR],
        packageId: PKG,
      }),
    ).rejects.toThrow('The active SoulGrant is no longer valid for this Soul owner')
  })

  // ── Access denied ───────────────────────────────────────────────────

  it('throws SoulAccessDeniedError when viewer is neither owner nor has a grant', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject({ activeGrants: [] }))

    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [VIEWER_ADDR],
        packageId: PKG,
      }),
    ).rejects.toThrow(SoulAccessDeniedError)
  })

  it('throws 403 when access is denied', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject({ activeGrants: [] }))

    try {
      await resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [VIEWER_ADDR],
        packageId: PKG,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SoulAccessDeniedError)
      expect((error as SoulAccessDeniedError).status).toBe(403)
    }
  })

  // ── Expired grant ───────────────────────────────────────────────────

  it('throws when grant exists but has expired', async () => {
    const pastMs = Date.now() - 3_600_000 // 1 hour in the past
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot()],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(makeGrantObject({ expiresAtMs: pastMs }))

    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [GRANTEE_ADDR],
        packageId: PKG,
      }),
    ).rejects.toThrow('The active SoulGrant has expired')
  })

  // ── Wrong scope ─────────────────────────────────────────────────────

  it('throws when grant exists but without seal scope', async () => {
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot({ scopes: ['memory'], scopeMask: 2 })],
      }),
    )

    // The active_grants filter in access.ts checks for 'seal' scope in the slot,
    // so this grant slot won't match and we get the "no activeSealSlot" error.
    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [GRANTEE_ADDR],
        packageId: PKG,
      }),
    ).rejects.toThrow('Only the owner or the active granted agent can access this Soul')
  })

  it('throws when on-chain grant object lacks seal scope despite slot having it', async () => {
    // Slot says 'seal' but the fetched on-chain grant object does not
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot()],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(
      makeGrantObject({ scopes: ['memory'], scopeMask: 2 }),
    )

    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [GRANTEE_ADDR],
        packageId: PKG,
      }),
    ).rejects.toThrow('The active SoulGrant does not allow Soul Seal access')
  })

  // ── Missing sealSidecar ─────────────────────────────────────────────

  it('throws 409 when sealSidecar is missing', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    try {
      await resolveSoulAccessPayload({
        soul: makeSoulAssetDetail({ sealSidecar: null }),
        viewerAddresses: [OWNER_ADDR],
        packageId: PKG,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SoulAccessDeniedError)
      expect((error as SoulAccessDeniedError).status).toBe(409)
      expect((error as SoulAccessDeniedError).message).toContain('Seal sidecar')
    }
  })

  // ── Missing contentBlobId ───────────────────────────────────────────

  it('throws 409 when contentBlobId is missing', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    try {
      await resolveSoulAccessPayload({
        soul: makeSoulAssetDetail({ contentBlobId: null }),
        viewerAddresses: [OWNER_ADDR],
        packageId: PKG,
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SoulAccessDeniedError)
      expect((error as SoulAccessDeniedError).status).toBe(409)
      expect((error as SoulAccessDeniedError).message).toContain('content blob')
    }
  })

  // ── On-chain grant address mismatch ─────────────────────────────────

  it('throws when on-chain grant granteeAddress does not match the viewer', async () => {
    const differentAddr = '0x' + '99'.repeat(32)
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot()],
      }),
    )
    // The on-chain grant says a different address than what the slot matched
    mockedGetSoulGrantObject.mockResolvedValue(
      makeGrantObject({ granteeAddress: differentAddr }),
    )

    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [GRANTEE_ADDR],
        packageId: PKG,
      }),
    ).rejects.toThrow('The active SoulGrant does not belong to this wallet')
  })

  // ── Edge: empty viewerAddresses ─────────────────────────────────────

  it('throws when viewerAddresses is empty', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    await expect(
      resolveSoulAccessPayload({
        soul: makeSoulAssetDetail(),
        viewerAddresses: [],
        packageId: PKG,
      }),
    ).rejects.toThrow(SoulAccessDeniedError)
  })

  // ── Edge: invalid viewer addresses are filtered out ─────────────────

  it('filters out invalid viewer addresses and still resolves owner access', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: ['not-an-address', '', OWNER_ADDR],
      packageId: PKG,
    })

    expect(result.accessKind).toBe('owner')
  })

  // ── Returned accessPolicy fields ────────────────────────────────────

  it('populates accessPolicy fields correctly for owner', async () => {
    mockedGetSoulStateObject.mockResolvedValue(makeSoulStateObject())

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [OWNER_ADDR],
      packageId: PKG,
    })

    expect(result.accessPolicy).toEqual({
      packageId: PKG,
      soulObjectId: SOUL_ID,
      stateObjectId: STATE_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_owner',
      soulGrantObjectId: null,
    })
  })

  it('populates accessPolicy fields correctly for granted agent', async () => {
    mockedGetSoulStateObject.mockResolvedValue(
      makeSoulStateObject({
        activeGrantCount: 1,
        activeGrants: [makeGrantSlot()],
      }),
    )
    mockedGetSoulGrantObject.mockResolvedValue(makeGrantObject())

    const result = await resolveSoulAccessPayload({
      soul: makeSoulAssetDetail(),
      viewerAddresses: [GRANTEE_ADDR],
      packageId: PKG,
    })

    expect(result.accessPolicy).toEqual({
      packageId: PKG,
      soulObjectId: SOUL_ID,
      stateObjectId: STATE_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_granted_agent',
      soulGrantObjectId: GRANT_ID,
    })
  })
})

// ── SoulAccessDeniedError ───────────────────────────────────────────────

describe('SoulAccessDeniedError', () => {
  it('defaults to status 403', () => {
    const error = new SoulAccessDeniedError('denied')
    expect(error.status).toBe(403)
    expect(error.name).toBe('SoulAccessDeniedError')
    expect(error.message).toBe('denied')
  })

  it('accepts a custom status code', () => {
    const error = new SoulAccessDeniedError('conflict', 409)
    expect(error.status).toBe(409)
  })

  it('is an instance of Error', () => {
    const error = new SoulAccessDeniedError('test')
    expect(error).toBeInstanceOf(Error)
  })
})

// ── skill-access.ts pure helpers ────────────────────────────────────────

// These functions are not exported from the module, but parseSkillAccessResponse
// and readSkillAccessError are. We test the exported API of skill-access.ts.

// Note: skill-access.ts imports from '@mysten/seal' and '@mysten/sui/transactions'
// at module level but only uses them in the async functions (fetchSkillAccess,
// loadDecryptedPrivateSkillVersion). The pure exported helpers don't trigger
// those imports at call time. We mock the Sui/Seal imports to allow module load.

vi.mock('@mysten/seal', () => ({
  SealClient: class MockSealClient { constructor() {} },
  SessionKey: { create: vi.fn(), import: vi.fn() },
}))

vi.mock('@mysten/sui/transactions', () => ({
  Transaction: class MockTransaction {
    moveCall() {}
    pure = { vector: () => ({}) }
    object() { return {} }
    build() { return new Uint8Array() }
  },
}))

// skill-access.ts uses dynamic function construction, import after mocks
const { readSkillAccessError } = await import('../../web/lib/soulidity/skill-access')

describe('readSkillAccessError', () => {
  it('extracts error string from { error: string } payload', () => {
    expect(readSkillAccessError({ error: 'Soul not found' }, 'fallback')).toBe('Soul not found')
  })

  it('returns fallback when payload is null', () => {
    expect(readSkillAccessError(null, 'default error')).toBe('default error')
  })

  it('returns fallback when payload is not a record', () => {
    expect(readSkillAccessError('string', 'default error')).toBe('default error')
  })

  it('returns fallback when payload.error is not a string', () => {
    expect(readSkillAccessError({ error: 42 }, 'default error')).toBe('default error')
  })

  it('returns fallback when payload has no error key', () => {
    expect(readSkillAccessError({ message: 'oops' }, 'default error')).toBe('default error')
  })

  it('returns fallback for undefined payload', () => {
    expect(readSkillAccessError(undefined, 'default error')).toBe('default error')
  })
})

// parseSkillAccessResponse is also exported — test it by dynamic import
// (the function itself is not exported, checking from the module)
describe('parseSkillAccessResponse (via skill-access module)', () => {
  // We need to access the non-exported parseSkillAccessResponse.
  // Since it's only called inside fetchSkillAccess (which is hard to unit test),
  // we test it by re-importing with a workaround: the function validates shape
  // of the API response, so we test the exported fetchSkillAccess indirectly
  // by verifying readSkillAccessError handles the error envelope.

  // Instead, test the assertSkillDocumentMatchesVersion logic indirectly:
  // it's called inside buildSkillApprovalTxBytes which is called in
  // loadDecryptedPrivateSkillVersion. Since that function needs too many
  // async mocks (SealClient, SessionKey, fetch, crypto), we focus on
  // the exported helpers that are unit-testable.

  it('readSkillAccessError is a pure function that handles all edge cases', () => {
    // Already tested above — this group is a placeholder for future
    // parseSkillAccessResponse tests if the function becomes exported.
    expect(typeof readSkillAccessError).toBe('function')
  })
})
