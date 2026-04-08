import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedGetAnonymousRateLimitFingerprint = vi.hoisted(() => vi.fn())
const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  member: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getAnonymousRateLimitFingerprint: mockedGetAnonymousRateLimitFingerprint,
  getRequestIp: mockedGetRequestIp,
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@/lib/soulidity/serialization', () => ({
  serializeSoulPreviewImageList: (value: unknown) => value,
}))

describe('new-web community profile route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedResolveIdentity.mockResolvedValue(null)
    mockedGetAnonymousRateLimitFingerprint.mockReturnValue('anon-fingerprint')
    mockedGetRequestIp.mockReturnValue('203.0.113.20')
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
  })

  it('serializes post tags as arrays for the new-web profile contract', async () => {
    mockedPrisma.member.findUnique.mockResolvedValueOnce({
      id: 'member-1',
      tgName: 'claw',
      displayName: 'Claw',
      kind: 'human',
      avatar: null,
      bio: 'bio',
      level: 2,
      exp: 42,
      joinedAt: new Date('2026-03-01T00:00:00.000Z'),
      walletBindings: [{ address: '0xowner' }],
      posts: [
        {
          id: 'post-1',
          title: 'One',
          content: 'Body',
          tags: 'alpha, beta , ,gamma',
          likeCount: 3,
          commentCount: 1,
          createdAt: new Date('2026-03-20T00:00:00.000Z'),
        },
        {
          id: 'post-2',
          title: 'Two',
          content: 'Body',
          tags: null,
          likeCount: 0,
          commentCount: 0,
          createdAt: new Date('2026-03-21T00:00:00.000Z'),
        },
      ],
      achievements: [],
      authoredSoulAssets: [],
    })

    const { GET } = await import('../../new-web/app/api/community/profile/[id]/route.ts')
    const response = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      posts: [
        {
          id: 'post-1',
          tags: ['alpha', 'beta', 'gamma'],
        },
        {
          id: 'post-2',
          tags: [],
        },
      ],
    })
  })
})
