import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VerifiedSoulState } from '../../web/lib/souls/on-chain-verification'
import { sameSuiValueForTests } from './test-sui-value.ts'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const SOUL_ID = `0x${'1'.repeat(64)}`
const OWNER_ADDRESS = `0x${'2'.repeat(64)}`
const ALLOWLISTED_ADDRESS = `0x${'3'.repeat(64)}`
const STALE_DB_ALLOWLIST_ADDRESS = `0x${'4'.repeat(64)}`
const ACCESS_CAP_ID = `0x${'5'.repeat(64)}`
const KIOSK_ID = `0x${'6'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'7'.repeat(64)}`
const ALLOWLIST_REGISTRY_ID = `0x${'8'.repeat(64)}`
const VALID_ENCRYPTED_DEK = Buffer.from('encrypted-dek').toString('base64')
const VALID_IV = Buffer.alloc(12, 7).toString('base64')

function buildValidDocumentId(soulObjectId: string) {
  const domainHex = Buffer.from('soul-seal:', 'utf8').toString('hex')
  return `0x${domainHex}01${soulObjectId.slice(2).padStart(64, '0')}${'0'.repeat(32)}`
}

const VALID_DOCUMENT_ID = buildValidDocumentId(SOUL_ID)

const mockedGetVerifiedPersonalKioskCapState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulAllowlistCapState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedGetOwnedObjects = vi.hoisted(() => vi.fn())
const mockedGetAllowlistedSealSession = vi.hoisted(() => vi.fn())
const mockedGetOwnerSealSession = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedGetSealSessionTtlMinutes = vi.hoisted(() => vi.fn())
const mockedGetBlobUrl = vi.hoisted(() => vi.fn())

const sameSuiValueImpl = sameSuiValueForTests

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  getVerifiedPersonalKioskCapState: mockedGetVerifiedPersonalKioskCapState,
  getVerifiedSoulAllowlistCapState: mockedGetVerifiedSoulAllowlistCapState,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: sameSuiValueImpl,
}))

vi.mock('@web/lib/services/seal', () => ({
  getAllowlistedSealSession: mockedGetAllowlistedSealSession,
  getOwnerSealSession: mockedGetOwnerSealSession,
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  getSealSessionTtlMinutes: mockedGetSealSessionTtlMinutes,
}))

vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: mockedGetBlobUrl,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: {
    getOwnedObjects: mockedGetOwnedObjects,
  },
}))

function makeSoulRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-db-1',
    onChainId: SOUL_ID,
    contentBlobId: 'blob-content',
    contentBlobObjectId: '0xblob',
    currentKioskId: KIOSK_ID,
    currentKioskCapOnChainId: KIOSK_CAP_ID,
    allowlistAddress: null,
    allowlistCapOnChainId: null,
    sealSidecar: {
      version: 1,
      mode: 'seal-envelope',
      documentId: VALID_DOCUMENT_ID,
      encryptedDek: VALID_ENCRYPTED_DEK,
      iv: VALID_IV,
      cipher: 'AES-GCM-256',
      mimeType: 'application/octet-stream',
      fileName: 'soul.bin',
      contentHash: 'b'.repeat(64),
    },
    ...overrides,
  } as any
}

function makeVerifiedSoulState(overrides: Partial<VerifiedSoulState> = {}): VerifiedSoulState {
  return {
    objectId: SOUL_ID,
    packageId: PACKAGE_ID,
    ownerAddress: null,
    ownerObjectId: KIOSK_ID,
    ownerKind: 'object',
    creatorAddress: `0x${'a'.repeat(64)}`,
    creatorRoyaltyBps: 0,
    name: 'Signal Soul',
    description: 'desc',
    imageUrl: 'https://example.com/soul.png',
    metadataRef: null,
    contentBlobId: 'blob-content',
    contentBlobObjectId: '0xblob',
    allowlistAddress: null,
    allowlistVersion: 7n,
    ...overrides,
  }
}

describe('resolveSoulAccessPayload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedGetVerifiedSoulState.mockResolvedValue(makeVerifiedSoulState())
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValue({
      objectId: KIOSK_CAP_ID,
      ownerAddress: OWNER_ADDRESS,
      kioskId: KIOSK_ID,
    })
    mockedGetVerifiedSoulAllowlistCapState.mockResolvedValue({
      objectId: ACCESS_CAP_ID,
      ownerAddress: ALLOWLISTED_ADDRESS,
      soulObjectId: SOUL_ID,
      allowlistedAddress: ALLOWLISTED_ADDRESS,
      allowlistVersion: 7n,
    })
    mockedGetOwnedObjects.mockResolvedValue({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    })
    mockedGetOwnerSealSession.mockReturnValue({
      packageId: PACKAGE_ID,
      functionName: 'seal_approve_owner_in_personal_kiosk',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
    })
    mockedGetAllowlistedSealSession.mockReturnValue({
      packageId: PACKAGE_ID,
      functionName: 'seal_approve_allowlisted',
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })
    mockedGetSealRuntimeConfig.mockReturnValue({
      network: 'testnet',
      threshold: 1,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xserver', weight: 1 }],
    })
    mockedGetSealSessionTtlMinutes.mockReturnValue(10)
    mockedGetBlobUrl.mockImplementation((blobId: string) => `https://walrus.example/${blobId}`)
  })

  it('uses the on-chain allowlist address even when the DB mirror is stale', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
      allowlistAddress: ALLOWLISTED_ADDRESS,
    }))

    const { resolveSoulAccessPayload } = await import('../../web/lib/souls/access.ts')
    const payload = await resolveSoulAccessPayload({
      soul: makeSoulRecord({
        allowlistAddress: STALE_DB_ALLOWLIST_ADDRESS,
        allowlistCapOnChainId: ACCESS_CAP_ID,
      }),
      viewerAddresses: [ALLOWLISTED_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })

    expect(payload.accessKind).toBe('allowlisted')
    expect(payload.viewerAddress).toBe(ALLOWLISTED_ADDRESS)
    expect(payload.accessPolicy).toMatchObject({
      functionName: 'seal_approve_allowlisted',
      soulAllowlistCapObjectId: ACCESS_CAP_ID,
    })
  })

  it('returns owner access when the verified personal kiosk cap belongs to the viewer', async () => {
    const { resolveSoulAccessPayload } = await import('../../web/lib/souls/access.ts')
    const payload = await resolveSoulAccessPayload({
      soul: makeSoulRecord(),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })

    expect(payload.accessKind).toBe('owner')
    expect(payload.viewerAddress).toBe(OWNER_ADDRESS)
    expect(payload.accessPolicy).toMatchObject({
      functionName: 'seal_approve_owner_in_personal_kiosk',
      soulAllowlistCapObjectId: null,
    })
  })

  it('uses the on-chain verified kiosk id when building the owner seal session', async () => {
    const { resolveSoulAccessPayload } = await import('../../web/lib/souls/access.ts')

    await resolveSoulAccessPayload({
      soul: makeSoulRecord({ currentKioskId: KIOSK_ID.toUpperCase() }),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })

    expect(mockedGetOwnerSealSession).toHaveBeenCalledWith({
      soulObjectId: SOUL_ID,
      packageId: PACKAGE_ID,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
    })
  })

  it('uses the on-chain Soul package id when building owner seal access', async () => {
    const onChainSoulPackageId = `0x${'b'.repeat(64)}`
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      packageId: onChainSoulPackageId,
    }))

    const { resolveSoulAccessPayload } = await import('../../web/lib/souls/access.ts')

    await resolveSoulAccessPayload({
      soul: makeSoulRecord(),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })

    expect(mockedGetOwnerSealSession).toHaveBeenCalledWith({
      soulObjectId: SOUL_ID,
      packageId: onChainSoulPackageId,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
    })
  })

  it('skips owner path and denies access when the mirrored kiosk-cap id is still missing', async () => {
    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({ currentKioskCapOnChainId: null }),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Viewer does not have access to this Soul',
      status: 403,
    })

    expect(mockedGetVerifiedPersonalKioskCapState).not.toHaveBeenCalled()
  })

  it('returns 503 when the mirrored kiosk id is missing for an object-owned Soul', async () => {
    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({ currentKioskId: null }),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul kiosk state is not available',
      status: 503,
    })

    expect(mockedGetVerifiedPersonalKioskCapState).not.toHaveBeenCalled()
  })

  it('returns 503 when the on-chain Soul content blob is not yet available', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      contentBlobId: null,
    }))

    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord(),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul content is not available',
      status: 503,
    })

    expect(mockedGetBlobUrl).not.toHaveBeenCalled()
  })

  it('returns 503 when the seal sidecar documentId belongs to a different Soul', async () => {
    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({
        sealSidecar: {
          ...makeSoulRecord().sealSidecar,
          documentId: buildValidDocumentId(`0x${'f'.repeat(64)}`),
        },
      }),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul access is not ready yet',
      status: 503,
    })

    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
  })

  it('fails closed when the on-chain kiosk owner object no longer matches the mirrored kiosk id', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
    }))

    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord(),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Viewer does not have access to this Soul',
      status: 403,
    })
  })

  it('fails closed when the Soul is directly address-owned instead of kiosk-held', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerKind: 'address',
      ownerAddress: OWNER_ADDRESS,
      ownerObjectId: null,
    }))

    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord(),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Viewer does not have access to this Soul',
      status: 403,
    })
  })

  it('falls back to the viewer-owned allowlist cap when the DB cap mirror has not caught up', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
      allowlistAddress: ALLOWLISTED_ADDRESS,
    }))
    mockedGetOwnedObjects.mockResolvedValueOnce({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    }).mockResolvedValueOnce({
      data: [{ data: { objectId: ACCESS_CAP_ID } }],
      hasNextPage: false,
      nextCursor: null,
    })

    const { resolveSoulAccessPayload } = await import('../../web/lib/souls/access.ts')
    const payload = await resolveSoulAccessPayload({
      soul: makeSoulRecord({
        allowlistAddress: STALE_DB_ALLOWLIST_ADDRESS,
        allowlistCapOnChainId: null,
      }),
      viewerAddresses: [ALLOWLISTED_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })

    expect(payload.accessKind).toBe('allowlisted')
    expect(payload.viewerAddress).toBe(ALLOWLISTED_ADDRESS)
    expect(payload.accessPolicy).toMatchObject({
      functionName: 'seal_approve_allowlisted',
      soulAllowlistCapObjectId: ACCESS_CAP_ID,
    })
  })

  it('fails closed when the Soul has no seal sidecar', async () => {
    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({ sealSidecar: null }),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul access is not ready yet',
      status: 503,
    })
  })

  it('fails closed when the persisted seal sidecar shape is invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({ sealSidecar: { encryptedObject: 'sealed' } }),
      viewerAddresses: [OWNER_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul access is not ready yet',
      status: 503,
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[soul-access] Ignoring invalid seal sidecar',
      expect.objectContaining({
        soulOnChainId: SOUL_ID,
      }),
    )
    warnSpy.mockRestore()
  })

  it('fails closed when allowlist access is on-chain valid but the registry id is not configured', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
      allowlistAddress: ALLOWLISTED_ADDRESS,
    }))

    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({
        allowlistAddress: ALLOWLISTED_ADDRESS,
        allowlistCapOnChainId: ACCESS_CAP_ID,
      }),
      viewerAddresses: [ALLOWLISTED_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: null,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul allowlist access is not configured',
      status: 503,
    })

    expect(mockedGetVerifiedSoulAllowlistCapState).not.toHaveBeenCalled()
  })

  it('fails closed when the allowlist cap version no longer matches the on-chain Soul version', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
      allowlistAddress: ALLOWLISTED_ADDRESS,
      allowlistVersion: 8n,
    }))
    mockedGetVerifiedSoulAllowlistCapState.mockResolvedValueOnce({
      objectId: ACCESS_CAP_ID,
      ownerAddress: ALLOWLISTED_ADDRESS,
      soulObjectId: SOUL_ID,
      allowlistedAddress: ALLOWLISTED_ADDRESS,
      allowlistVersion: 7n,
    })

    const { resolveSoulAccessPayload, SoulAccessDeniedError } = await import('../../web/lib/souls/access.ts')

    await expect(resolveSoulAccessPayload({
      soul: makeSoulRecord({
        allowlistAddress: ALLOWLISTED_ADDRESS,
        allowlistCapOnChainId: ACCESS_CAP_ID,
      }),
      viewerAddresses: [ALLOWLISTED_ADDRESS],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })).rejects.toMatchObject({
      name: SoulAccessDeniedError.name,
      message: 'Soul allowlist cap is no longer valid',
      status: 403,
    })
  })
})
