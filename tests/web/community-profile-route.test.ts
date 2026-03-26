import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
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

vi.mock('@web/lib/souls/serialization', () => ({
  serializeSoulPreviewImageList: (value: unknown) => value,
}))

describe('community profile route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns the profile Sui address only to the owner while keeping uploaded active souls public', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      tgName: 'claw',
      displayName: 'Claw',
      kind: 'human',
      avatar: null,
      bio: 'bio',
      level: 2,
      exp: 42,
      joinedAt: '2026-03-01T00:00:00.000Z',
      walletBindings: [{ address: '0xowner' }],
      posts: [],
      achievements: [],
      authoredSoulSeries: [
        {
          id: 'series-1',
          onChainId: 'chain-1',
          name: 'Alpha Soul',
          description: 'desc',
          category: 'Research',
          tags: ['alpha'],
          previewImages: ['blob-1'],
          oneTimePriceUsdc: '1000000000',
          oneTimePlanOnChainId: 'plan-1',
          subPriceUsdc: null,
          subPlanOnChainId: null,
          subPeriodDays: null,
          createdAt: '2026-03-20T00:00:00.000Z',
          latestRelease: {
            id: 'release-latest',
            onChainId: 'release-chain-latest',
            version: '1.10.0',
            changelog: null,
            createdAt: '2026-03-19T00:00:00.000Z',
          },
          _count: { passSnapshots: 3 },
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
          id: 'series-1',
          name: 'Alpha Soul',
          latestRelease: {
            onChainId: 'release-chain-latest',
            version: '1.10.0',
          },
        },
      ],
    })

    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'member-2' })
    const visitorResponse = await GET(new Request('http://localhost/api/community/profile/member-1'), {
      params: Promise.resolve({ id: 'member-1' }),
    })

    expect(visitorResponse.status).toBe(200)
    await expect(visitorResponse.json()).resolves.toMatchObject({
      id: 'member-1',
      primarySuiAddress: null,
      uploadedSouls: [
        {
          id: 'series-1',
          name: 'Alpha Soul',
          latestRelease: {
            onChainId: 'release-chain-latest',
            version: '1.10.0',
          },
        },
      ],
    })
    expect(mockedPrisma.member.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          walletBindings: expect.any(Object),
          authoredSoulSeries: expect.objectContaining({
            where: { status: 'active' },
            include: expect.objectContaining({
              latestRelease: expect.any(Object),
            }),
          }),
        }),
      }),
    )
  })
})
