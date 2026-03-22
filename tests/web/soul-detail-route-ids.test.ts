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
