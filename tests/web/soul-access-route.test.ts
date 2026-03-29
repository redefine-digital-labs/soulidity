import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sameSuiValueForTests } from './test-sui-value.ts'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const SOUL_ID = `0x${'1'.repeat(64)}`
const AGENT_ADDRESS = `0x${'2'.repeat(64)}`
const ACCESS_CAP_ID = `0x${'3'.repeat(64)}`
const KIOSK_ID = `0x${'4'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'5'.repeat(64)}`
const ALLOWLIST_REGISTRY_ID = `0x${'6'.repeat(64)}`
const VALID_ENCRYPTED_DEK = Buffer.from('encrypted-dek').toString('base64')
const VALID_IV = Buffer.alloc(12, 7).toString('base64')

function buildValidDocumentId(soulObjectId: string) {
  const domainHex = Buffer.from('soul-seal:', 'utf8').toString('hex')
  return `0x${domainHex}01${soulObjectId.slice(2).padStart(64, '0')}${'0'.repeat(32)}`
}

function makeSealSidecar() {
  return {
    version: 1,
    mode: 'seal-envelope' as const,
    documentId: buildValidDocumentId(SOUL_ID),
    encryptedDek: VALID_ENCRYPTED_DEK,
    iv: VALID_IV,
    cipher: 'AES-GCM-256' as const,
    mimeType: 'application/octet-stream',
    fileName: 'soul.bin',
    contentHash: 'b'.repeat(64),
  }
}

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulAllowlistCapState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedPersonalKioskCapState = vi.hoisted(() => vi.fn())
const mockedHasSealSessionConfig = vi.hoisted(() => vi.fn())
const mockedHasCredentialedSealServerConfigs = vi.hoisted(() => vi.fn())
const mockedGetOwnerSealSession = vi.hoisted(() => vi.fn())
const mockedGetAllowlistedSealSession = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedGetSealSessionTtlMinutes = vi.hoisted(() => vi.fn())
const mockedGetBlobUrl = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  getVerifiedSoulAllowlistCapState: mockedGetVerifiedSoulAllowlistCapState,
  getVerifiedPersonalKioskCapState: mockedGetVerifiedPersonalKioskCapState,
  sameSuiValue: sameSuiValueForTests,
}))

vi.mock('@web/lib/services/seal', () => ({
  hasSealSessionConfig: mockedHasSealSessionConfig,
  hasCredentialedSealServerConfigs: mockedHasCredentialedSealServerConfigs,
  getOwnerSealSession: mockedGetOwnerSealSession,
  getAllowlistedSealSession: mockedGetAllowlistedSealSession,
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  getSealSessionTtlMinutes: mockedGetSealSessionTtlMinutes,
}))

vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: mockedGetBlobUrl,
}))

describe('Soul agent access route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID = ALLOWLIST_REGISTRY_ID

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AGENT_ADDRESS)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sealSidecar: makeSealSidecar(),
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      allowlistAddress: null,
      allowlistCapOnChainId: null,
    })
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValue({
      objectId: KIOSK_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      kioskId: KIOSK_ID,
    })
    mockedHasSealSessionConfig.mockReturnValue(true)
    mockedHasCredentialedSealServerConfigs.mockReturnValue(false)
    mockedGetOwnerSealSession.mockReturnValue({
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_owner_in_personal_kiosk',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      allowlistRegistryObjectId: null,
    })
    mockedGetAllowlistedSealSession.mockReturnValue({
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_allowlisted',
      currentKioskId: null,
      currentKioskCapOnChainId: null,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })
    mockedGetSealRuntimeConfig.mockReturnValue({
      network: 'testnet',
      threshold: 2,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xserver', weight: 1 }],
    })
    mockedGetSealSessionTtlMinutes.mockReturnValue(10)
    mockedGetBlobUrl.mockImplementation((blobId: string) => `https://walrus.example/${blobId}`)
  })

  it('rate limits before reading Soul access state', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 120 })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('marks the agent access route as force-dynamic', async () => {
    const mod = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    expect(mod.dynamic).toBe('force-dynamic')
  })

  it('returns 409 when the agent has multiple Sui wallet bindings', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberPrimarySuiWalletAddress.mockRejectedValueOnce(walletError)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
  })

  it('fails closed when Seal session config is missing', async () => {
    mockedHasSealSessionConfig.mockReturnValueOnce(false)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Seal session is not configured',
    })
  })

  it('returns owner access when the agent directly owns the Soul', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: null,
      allowlistVersion: 1n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      artifact: {
        walrusBlobUrl: 'https://walrus.example/blob-content',
        walrusBlobId: 'blob-content',
        contentBlobObjectId: '0xblob',
      },
      accessPolicy: {
        packageId: PACKAGE_ID,
        soulObjectId: SOUL_ID,
        moduleName: 'seal_policy',
        functionName: 'seal_approve_owner_in_personal_kiosk',
        currentKioskId: KIOSK_ID,
        currentKioskCapOnChainId: KIOSK_CAP_ID,
        soulAllowlistCapObjectId: null,
      },
      seal: {
        network: 'testnet',
        threshold: 2,
        verifyKeyServers: true,
        serverConfigs: [{ objectId: '0xserver', weight: 1 }],
      },
      sealSidecar: makeSealSidecar(),
    })
  })

  it('fails closed when the Soul is directly address-owned instead of kiosk-held', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'address',
      ownerAddress: AGENT_ADDRESS,
      ownerObjectId: null,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: null,
      allowlistVersion: 1n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Viewer does not have access to this Soul',
    })
  })

  it('still returns owner access when the allowlist registry env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: null,
      allowlistVersion: 1n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      accessPolicy: {
        functionName: 'seal_approve_owner_in_personal_kiosk',
        currentKioskId: KIOSK_ID,
        currentKioskCapOnChainId: KIOSK_CAP_ID,
      },
    })
  })

  it('returns agent-cap access when the DB and chain allowlist state match', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sealSidecar: makeSealSidecar(),
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      allowlistAddress: AGENT_ADDRESS,
      allowlistCapOnChainId: ACCESS_CAP_ID,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: `0x${'f'.repeat(64)}`,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: AGENT_ADDRESS,
      allowlistVersion: 7n,
    })
    mockedGetVerifiedSoulAllowlistCapState.mockResolvedValueOnce({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      allowlistedAddress: AGENT_ADDRESS,
      allowlistVersion: 7n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      accessPolicy: {
        functionName: 'seal_approve_allowlisted',
        allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
        soulAllowlistCapObjectId: ACCESS_CAP_ID,
      },
    })
  })

  it('returns 503 when the on-chain allowlist exists but the DB cap mirror is stale', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sealSidecar: makeSealSidecar(),
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      allowlistAddress: AGENT_ADDRESS,
      allowlistCapOnChainId: null,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: `0x${'f'.repeat(64)}`,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: AGENT_ADDRESS,
      allowlistVersion: 7n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist access is still syncing',
    })
  })

  it('rejects stale Soul access caps even when the DB still points at them', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sealSidecar: makeSealSidecar(),
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      allowlistAddress: AGENT_ADDRESS,
      allowlistCapOnChainId: ACCESS_CAP_ID,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: `0x${'f'.repeat(64)}`,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: AGENT_ADDRESS,
      allowlistVersion: 8n,
    })
    mockedGetVerifiedSoulAllowlistCapState.mockResolvedValueOnce({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      allowlistedAddress: AGENT_ADDRESS,
      allowlistVersion: 7n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist cap is no longer valid',
    })
  })

  it('returns 403 when the agent has neither ownership nor a valid allowlist', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: `0x${'f'.repeat(64)}`,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      allowlistAddress: null,
      allowlistVersion: 1n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Viewer does not have access to this Soul',
    })
  })
})
