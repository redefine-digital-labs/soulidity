import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedEvaluateAchievements = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  post: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  postVote: {
    findMany: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  requireMutationIdentity: mockedRequireIdentity,
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/community/achievements', () => ({
  evaluateAchievements: mockedEvaluateAchievements,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: () => '203.0.113.9',
  getAnonymousRateLimitFingerprint: () => 'anon-fallback',
}))

describe('web community posts route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedResolveIdentity.mockResolvedValue(null)
    mockedEvaluateAchievements.mockResolvedValue(undefined)
    mockedPrisma.post.findMany.mockResolvedValue([])
    mockedPrisma.postVote.findMany.mockResolvedValue([])
    mockedPrisma.post.create.mockResolvedValue({
      id: 'post-1',
      title: 'Test',
      content: 'Body',
      tags: ['alpha', 'beta'],
      type: 'log',
      channel: 'general',
    })
  })

  it('uses array membership filtering for tag queries', async () => {
    const { GET } = await import('../../web/app/api/community/posts/route.ts')

    const response = await GET(
      {
        headers: new Headers(),
        nextUrl: new URL('http://localhost/api/community/posts?tag=alpha'),
      } as never,
    )

    expect(response.status).toBe(200)
    expect(mockedPrisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'published',
        tags: { has: 'alpha' },
      }),
    }))
  })

  it('stores normalized tag arrays on create', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1' },
    })

    const { POST } = await import('../../web/app/api/community/posts/route.ts')
    const response = await POST(new Request('http://localhost/api/community/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Hello',
        content: 'World',
        tags: ' alpha, beta , ,alpha ',
      }),
    }) as never)

    expect(response.status).toBe(201)
    expect(mockedPrisma.post.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tags: ['alpha', 'beta'],
      }),
    }))
  })
})
