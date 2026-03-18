import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveAgentByApiKey = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  listing: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: mockedResolveAgentByApiKey,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: vi.fn(() => '127.0.0.1'),
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('GET /api/agent/marketplace/search', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveAgentByApiKey.mockResolvedValue({
      accountId: 'account-1',
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
    })
    mockedTakeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 60,
    })
    mockedPrisma.listing.findMany.mockResolvedValue([
      {
        id: 'listing-11',
        bundleId: 'bundle-11',
        priceMist: 1_000_000_000n,
        priceUsdCents: 250,
        currency: 'SUI',
        bundle: {
          name: 'Research Agent',
          description: 'Finds research',
          category: 'research',
          tags: ['alpha'],
          version: '1.0.0',
        },
        _count: {
          orders: 3,
        },
      },
    ])
    mockedPrisma.listing.count.mockResolvedValue(42)
  })

  it('supports page-based pagination for agent search', async () => {
    const { GET } = await import('../../web/app/api/agent/marketplace/search/route.ts')
    const request = new Request('http://localhost/api/agent/marketplace/search?q=research&limit=10&page=2', {
      headers: {
        authorization: 'Bearer sk-agent-secret',
      },
    }) as Request & { nextUrl?: URL }
    request.nextUrl = new URL(request.url)

    const response = await GET(request as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      listings: [
        {
          id: 'listing-11',
          bundleId: 'bundle-11',
          name: 'Research Agent',
          description: 'Finds research',
          category: 'research',
          tags: ['alpha'],
          version: '1.0.0',
          salesCount: 3,
          priceMist: '1000000000',
          priceUsdCents: 250,
          currency: 'SUI',
        },
      ],
      total: 42,
      page: 2,
      limit: 10,
      actor: {
        accountId: 'account-1',
        agentMemberId: 'agent-1',
      },
    })

    expect(mockedPrisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      }),
    )
  })

  it('rate limits repeated invalid API key attempts', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue(null)
    mockedTakeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 60,
    })

    const { GET } = await import('../../web/app/api/agent/marketplace/search/route.ts')
    const request = new Request('http://localhost/api/agent/marketplace/search?q=research', {
      headers: {
        authorization: 'Bearer sk-invalid',
      },
    }) as Request & { nextUrl?: URL }
    request.nextUrl = new URL(request.url)

    const response = await GET(request as any)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many invalid API key attempts',
    })
  })
})
