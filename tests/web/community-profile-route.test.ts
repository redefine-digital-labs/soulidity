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
          listedPriceSui: { toString: () => '1000000000' },
          listingStatus: 'listed',
          creatorAddress: '0xcreator',
          currentOwnerAddress: '0xowner',
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
          listedPriceSui: '1000000000',
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
    await expect(visitorResponse.json()).resolves.toMatchObject({
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

    expect(mockedPrisma.member.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        walletBindings: expect.any(Object),
        authoredSoulAssets: expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
      }),
    }))
  })
})
