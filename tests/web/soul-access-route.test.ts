import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const SOUL_ID = `0x${'1'.repeat(64)}`
const AGENT_ADDRESS = `0x${'2'.repeat(64)}`
const ACCESS_CAP_ID = `0x${'3'.repeat(64)}`

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
const mockedGetVerifiedSoulAccessCapState = vi.hoisted(() => vi.fn())
const mockedHasSealSessionConfig = vi.hoisted(() => vi.fn())
const mockedHasCredentialedSealServerConfigs = vi.hoisted(() => vi.fn())
const mockedGetOwnerSealSession = vi.hoisted(() => vi.fn())
const mockedGetAgentSealSession = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
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
  getVerifiedSoulAccessCapState: mockedGetVerifiedSoulAccessCapState,
  sameSuiValue: (left: string | null | undefined, right: string | null | undefined) =>
    String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
}))

vi.mock('@web/lib/services/seal', () => ({
  hasSealSessionConfig: mockedHasSealSessionConfig,
  hasCredentialedSealServerConfigs: mockedHasCredentialedSealServerConfigs,
  getOwnerSealSession: mockedGetOwnerSealSession,
  getAgentSealSession: mockedGetAgentSealSession,
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
}))

vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: mockedGetBlobUrl,
}))

describe('Soul agent access route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID

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
      sealSidecar: { encryptedObject: 'sealed' },
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
    })
    mockedHasSealSessionConfig.mockReturnValue(true)
    mockedHasCredentialedSealServerConfigs.mockReturnValue(false)
    mockedGetOwnerSealSession.mockReturnValue({
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_owner',
    })
    mockedGetAgentSealSession.mockReturnValue({
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_agent',
    })
    mockedGetSealRuntimeConfig.mockReturnValue({
      network: 'testnet',
      threshold: 2,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xserver', weight: 1 }],
    })
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
      ownerAddress: AGENT_ADDRESS,
      agentGrant: null,
      grantVersion: 1n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      artifact: {
        walrusBlobUrl: 'https://walrus.example/blob-content',
        walrusBlobId: 'blob-content',
        contentBlobObjectId: '0xblob',
      },
      accessPolicy: {
        packageId: PACKAGE_ID,
        soulObjectId: SOUL_ID,
        moduleName: 'seal_policy',
        functionName: 'seal_approve_owner',
        soulAccessCapObjectId: null,
      },
      seal: {
        network: 'testnet',
        threshold: 2,
        verifyKeyServers: true,
        serverConfigs: [{ objectId: '0xserver', weight: 1 }],
      },
      sealSidecar: { encryptedObject: 'sealed' },
    })
  })

  it('returns agent-cap access when the DB and chain grant state match', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sealSidecar: { encryptedObject: 'sealed' },
      agentGrantAddress: AGENT_ADDRESS,
      agentAccessCapOnChainId: ACCESS_CAP_ID,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerAddress: `0x${'f'.repeat(64)}`,
      agentGrant: AGENT_ADDRESS,
      grantVersion: 7n,
    })
    mockedGetVerifiedSoulAccessCapState.mockResolvedValueOnce({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      grantVersion: 7n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      accessPolicy: {
        functionName: 'seal_approve_agent',
        soulAccessCapObjectId: ACCESS_CAP_ID,
      },
    })
  })

  it('rejects stale Soul access caps even when the DB still points at them', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sealSidecar: { encryptedObject: 'sealed' },
      agentGrantAddress: AGENT_ADDRESS,
      agentAccessCapOnChainId: ACCESS_CAP_ID,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerAddress: `0x${'f'.repeat(64)}`,
      agentGrant: AGENT_ADDRESS,
      grantVersion: 8n,
    })
    mockedGetVerifiedSoulAccessCapState.mockResolvedValueOnce({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      grantVersion: 7n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul access cap is no longer valid',
    })
  })

  it('returns 403 when the agent has neither ownership nor a valid grant', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerAddress: `0x${'f'.repeat(64)}`,
      agentGrant: null,
      grantVersion: 1n,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Agent does not have access to this Soul',
    })
  })
})
