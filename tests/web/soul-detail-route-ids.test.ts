import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: {
    findFirst: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
  },
  soulPassSnapshot: {
    findFirst: vi.fn(),
  },
  soulRelease: {
    findFirst: vi.fn(),
  },
}))

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/souls/serialization', () => ({
  serializeSoulPreviewImages: (value: unknown) => value,
}))

vi.mock('@web/lib/services/seal', () => ({
  getSealSessionPerpetual: vi.fn(),
  getSealSessionSubscription: vi.fn(),
  getSealRuntimeConfig: vi.fn(),
  hasSealSessionConfig: vi.fn(() => true),
  hasCredentialedSealServerConfigs: vi.fn(() => false),
}))

vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: vi.fn(),
  normalizeWalrusBlobId: vi.fn(),
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: vi.fn(() => ({ limited: false, retryAfterSeconds: 60 })),
}))

describe('soul detail routes ignore the UUID branch for on-chain ids', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedPrisma.soulSeries.findFirst.mockResolvedValue(null)
    mockedResolveIdentity.mockResolvedValue(null)
    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
  })

  it('public detail route queries only by onChainId for non-UUID params', async () => {
    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')

    const response = await GET(
      new Request('http://localhost/api/souls/not-a-uuid') as any,
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )

    expect(response.status).toBe(404)
    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onChainId: 'not-a-uuid', status: 'active' },
      }),
    )
  })

  it('public detail route exposes canonical latestRelease separately from release history', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValueOnce({
      id: 'series-db-1',
      onChainId: '0xseries',
      name: 'Soul',
      description: 'Desc',
      category: 'Research',
      tags: [],
      previewImages: ['blob-1'],
      oneTimePriceUsdc: '2500000',
      oneTimePlanOnChainId: '0xplan',
      subPriceUsdc: null,
      subPlanOnChainId: null,
      subPeriodDays: null,
      latestRelease: {
        id: 'release-db-latest',
        onChainId: '0xrelease-latest',
        version: '1.10.0',
        changelog: 'Latest',
        createdAt: '2026-03-24T00:00:00.000Z',
      },
      releases: [{
        id: 'release-db-stale',
        onChainId: '0xrelease-stale',
        version: '1.9.0',
        changelog: 'Stale',
        createdAt: '2026-03-25T00:00:00.000Z',
      }],
      _count: { passSnapshots: 1 },
    })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xseries') as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onChainId: '0xseries',
      latestRelease: {
        onChainId: '0xrelease-latest',
        version: '1.10.0',
      },
      releases: [{
        onChainId: '0xrelease-stale',
        version: '1.9.0',
      }],
    })
    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          latestRelease: expect.any(Object),
        }),
      }),
    )
  })

  it('agent detail route queries only by onChainId for non-UUID params', async () => {
    const { GET } = await import('../../web/app/api/agent/souls/[id]/route.ts')

    const response = await GET(
      new Request('http://localhost/api/agent/souls/not-a-uuid') as any,
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )

    expect(response.status).toBe(404)
    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onChainId: 'not-a-uuid', status: 'active' },
      }),
    )
  })

  it('agent detail route exposes canonical latestRelease separately from mirrored release history', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValueOnce({
      id: 'series-db-1',
      onChainId: '0xseries',
      name: 'Soul',
      description: 'Desc',
      category: 'Research',
      tags: [],
      previewImages: ['blob-1'],
      readme: 'README',
      oneTimePriceUsdc: '2500000',
      subPriceUsdc: null,
      subPeriodDays: null,
      latestRelease: {
        id: 'release-db-latest',
        onChainId: '0xrelease-latest',
        version: '1.10.0',
        contentHash: 'deadbeef',
        createdAt: '2026-03-24T00:00:00.000Z',
      },
      releases: [{
        id: 'release-db-stale',
        onChainId: '0xrelease-stale',
        version: '1.9.0',
        contentHash: 'stalebeef',
        createdAt: '2026-03-25T00:00:00.000Z',
      }],
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/route.ts')

    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xseries') as any,
      { params: Promise.resolve({ id: '0xseries' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onChainId: '0xseries',
      latestRelease: {
        onChainId: '0xrelease-latest',
        version: '1.10.0',
      },
      releases: [{
        onChainId: '0xrelease-stale',
        version: '1.9.0',
      }],
    })
    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          latestRelease: expect.any(Object),
        }),
      }),
    )
  })

  it('agent access route queries only by onChainId for non-UUID params', async () => {
    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')

    const response = await GET(
      new Request('http://localhost/api/agent/souls/not-a-uuid/access') as any,
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )

    expect(response.status).toBe(404)
    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onChainId: 'not-a-uuid', status: 'active' },
      }),
    )
    expect(mockedPrisma.member.findFirst).not.toHaveBeenCalled()
    expect(mockedPrisma.soulPassSnapshot.findFirst).not.toHaveBeenCalled()
  })
})
