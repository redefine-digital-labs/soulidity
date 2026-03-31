import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedGetAnonymousRateLimitFingerprint = vi.hoisted(() => vi.fn())
const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  member: {
    findUnique: vi.fn(),
  },
}))
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

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

vi.mock('@web/lib/souls/serialization', () => ({
  serializeSoulPreviewImageList: (value: unknown) => value,
}))

describe('community profile route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedGetAnonymousRateLimitFingerprint.mockReturnValue('anon-fingerprint')
    mockedGetRequestIp.mockReturnValue('203.0.113.20')
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
  })

  it('rate limits community profile requests before reading Prisma state', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 12 })

    const { GET } = await import('../../web/app/api/community/profile/[id]/route.ts')
    const response = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many community profile requests, try again later',
    })
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(mockedPrisma.member.findUnique).not.toHaveBeenCalled()
  })

  it('only returns the primary Sui address to the owner while keeping authored Souls public', async () => {
    const createdAt = new Date('2026-03-20T00:00:00.000Z')
    const updatedAt = new Date('2026-03-21T00:00:00.000Z')

    mockedPrisma.member.findUnique.mockResolvedValue({
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
      posts: [],
      achievements: [],
      authoredSoulAssets: [
        {
          id: 'asset-1',
          onChainId: '0xsoul',
          name: 'Alpha Soul',
          description: 'desc',
          imageUrl: 'https://example.com/soul.png',
          category: 'Research',
          tags: ['alpha'],
          previewImages: ['blob-1'],
          creatorRoyaltyBps: 0,
          listingObjectOnChainId: '0xlisting',
          listedPriceAtomic: { toString: () => '1000000000' },
          listingStatus: 'listed',
          creatorAddress: '0xcreator',
          currentOwnerAddress: '0xowner',
          currentKioskId: '0xkiosk',
          createdAt,
          updatedAt,
        },
      ],
    })

    const { GET } = await import('../../web/app/api/community/profile/[id]/route.ts')

    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'member-1' })
    const ownResponse = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(ownResponse.status).toBe(200)
    await expect(ownResponse.json()).resolves.toMatchObject({
      id: 'member-1',
      primarySuiAddress: '0xowner',
      uploadedSouls: [
        {
          id: 'asset-1',
          onChainId: '0xsoul',
          name: 'Alpha Soul',
          listedPriceAtomic: '1000000000',
          listingStatus: 'listed',
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
    })

    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'member-2' })
    const visitorResponse = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(visitorResponse.status).toBe(200)
    const visitorPayload = await visitorResponse.json()
    expect(visitorPayload).toMatchObject({
      id: 'member-1',
      primarySuiAddress: null,
      uploadedSouls: [
        {
          id: 'asset-1',
          onChainId: '0xsoul',
          name: 'Alpha Soul',
        },
      ],
    })
    expect(visitorPayload.uploadedSouls[0]).not.toHaveProperty('currentOwnerAddress')

    expect(mockedPrisma.member.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        walletBindings: expect.any(Object),
        authoredSoulAssets: expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
      }),
    }))
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'community-profile:203.0.113.20',
      expect.objectContaining({ max: 60 }),
    )
  })

  it('uses a member-scoped rate-limit bucket when client IP is unavailable for an authenticated viewer', async () => {
    mockedGetRequestIp.mockReturnValueOnce(null)
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'member-1' })
    mockedPrisma.member.findUnique.mockResolvedValueOnce({
      id: 'member-1',
      tgName: 'claw',
      displayName: 'Claw',
      kind: 'human',
      avatar: null,
      bio: null,
      level: 1,
      exp: 0,
      joinedAt: new Date('2026-03-01T00:00:00.000Z'),
      walletBindings: [{ address: '0xowner' }],
      posts: [],
      achievements: [],
      authoredSoulAssets: [],
    })

    const { GET } = await import('../../web/app/api/community/profile/[id]/route.ts')
    const response = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'community-profile:member:member-1',
      expect.objectContaining({ max: 60 }),
    )
  })

  it('uses an anonymous fingerprint bucket when client IP is unavailable for an anonymous viewer', async () => {
    mockedGetRequestIp.mockReturnValueOnce(null)
    mockedResolveIdentity.mockResolvedValueOnce(null)
    mockedPrisma.member.findUnique.mockResolvedValueOnce({
      id: 'member-1',
      tgName: 'claw',
      displayName: 'Claw',
      kind: 'human',
      avatar: null,
      bio: null,
      level: 1,
      exp: 0,
      joinedAt: new Date('2026-03-01T00:00:00.000Z'),
      walletBindings: [{ address: '0xowner' }],
      posts: [],
      achievements: [],
      authoredSoulAssets: [],
    })

    const { GET } = await import('../../web/app/api/community/profile/[id]/route.ts')
    const response = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'community-profile:anon:anon-fingerprint',
      expect.objectContaining({ max: 120 }),
    )
  })
})
