import { beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_SERIES_ID = `0x${'11'.repeat(32)}`
const VALID_RELEASE_ID = `0x${'33'.repeat(32)}`
const VALID_PASS_ID = `0x${'44'.repeat(32)}`

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  member: { findFirst: vi.fn() },
  soulPassSnapshot: { findFirst: vi.fn() },
  soulRelease: { findFirst: vi.fn() },
}))

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedGetSealSessionPerpetual = vi.hoisted(() => vi.fn())
const mockedGetSealSessionSubscription = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedHasCredentialedSealServerConfigs = vi.hoisted(() => vi.fn())
const mockedHasSealSessionConfig = vi.hoisted(() => vi.fn())
const mockedNormalizeWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedGetBlobUrl = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/auth/require-agent-api-key', () => ({ requireAgentApiKey: mockedRequireAgentApiKey }))
vi.mock('@web/lib/services/seal', () => ({
  getSealSessionPerpetual: mockedGetSealSessionPerpetual,
  getSealSessionSubscription: mockedGetSealSessionSubscription,
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  hasCredentialedSealServerConfigs: mockedHasCredentialedSealServerConfigs,
  hasSealSessionConfig: mockedHasSealSessionConfig,
}))
vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: mockedGetBlobUrl,
  normalizeWalrusBlobId: mockedNormalizeWalrusBlobId,
}))
vi.mock('@web/lib/rate-limit', () => ({ takeRateLimitToken: mockedTakeRateLimitToken }))

describe('Soul agent access route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: VALID_SERIES_ID,
      status: 'active',
      releases: [{
        id: 'release-db-1',
        onChainId: VALID_RELEASE_ID,
        version: '1.0.0',
        walrusBlobRef: 'blob-123',
        contentHash: 'deadbeef',
      }],
    })
    mockedPrisma.member.findFirst.mockResolvedValue({
      walletBindings: [{ address: '0xagentwallet' }],
    })
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue({
      passType: 'perpetual',
      onChainId: VALID_PASS_ID,
      lockedReleaseId: VALID_RELEASE_ID,
    })
    mockedPrisma.soulRelease.findFirst.mockResolvedValue({
      id: 'release-db-1',
      onChainId: VALID_RELEASE_ID,
      version: '1.0.0',
      walrusBlobRef: 'blob-123',
      contentHash: 'deadbeef',
    })
    mockedGetSealSessionPerpetual.mockReturnValue({
      packageId: '0xsoul',
      seriesObjectId: VALID_SERIES_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_perpetual',
    })
    mockedGetSealSessionSubscription.mockReturnValue({
      packageId: '0xsoul',
      seriesObjectId: VALID_SERIES_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_subscription',
    })
    mockedGetSealRuntimeConfig.mockReturnValue({
      network: 'testnet',
      threshold: 2,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xkeyserver', weight: 1 }],
    })
    mockedHasCredentialedSealServerConfigs.mockReturnValue(false)
    mockedHasSealSessionConfig.mockReturnValue(true)
    mockedNormalizeWalrusBlobId.mockImplementation((v: string) => v)
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetBlobUrl.mockImplementation(
      (blobId: string) => `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`,
    )
  })

  it('rate limits before doing the heavy read path', async () => {
    mockedTakeRateLimitToken.mockReturnValue({ limited: true, retryAfterSeconds: 120 })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns artifact + accessPolicy + seal for perpetual releases', async () => {
    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      artifact: {
        walrusBlobRef: 'blob-123',
        walrusBlobUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-123',
        contentHash: 'deadbeef',
      },
      accessPolicy: {
        packageId: '0xsoul',
        seriesObjectId: VALID_SERIES_ID,
        moduleName: 'seal_policy',
        functionName: 'seal_approve_perpetual',
        passObjectId: VALID_PASS_ID,
        releaseObjectId: VALID_RELEASE_ID,
        clockObjectId: null,
      },
      seal: {
        network: 'testnet',
        threshold: 2,
        verifyKeyServers: true,
        serverConfigs: [{ objectId: '0xkeyserver', weight: 1 }],
      },
      releaseId: VALID_RELEASE_ID,
      version: '1.0.0',
      passType: 'perpetual',
      passOnChainId: VALID_PASS_ID,
    })
  })

  it('fails closed when Seal direct access depends on credentialed key servers', async () => {
    mockedHasCredentialedSealServerConfigs.mockReturnValue(true)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('fails before DB work when Seal session config is missing', async () => {
    mockedHasSealSessionConfig.mockReturnValue(false)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns 403 when the agent has no active or granted pass for the series', async () => {
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'No active pass with agent grant',
    })
  })

  it('returns subscription access with clockObjectId', async () => {
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue({
      passType: 'subscription',
      onChainId: VALID_PASS_ID,
      lockedReleaseId: null,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.accessPolicy.functionName).toBe('seal_approve_subscription')
    expect(body.accessPolicy.clockObjectId).toBe('0x6')
    expect(body.passType).toBe('subscription')
  })

  it('normalizes 0x-prefixed contentHash', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: VALID_SERIES_ID,
      status: 'active',
      releases: [{
        id: 'release-db-1',
        onChainId: VALID_RELEASE_ID,
        version: '1.0.0',
        walrusBlobRef: 'blob-123',
        contentHash: '0xDEADBEEF',
      }],
    })
    mockedPrisma.soulRelease.findFirst.mockResolvedValue({
      id: 'release-db-1',
      onChainId: VALID_RELEASE_ID,
      version: '1.0.0',
      walrusBlobRef: 'blob-123',
      contentHash: '0xDEADBEEF',
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
  })
})
