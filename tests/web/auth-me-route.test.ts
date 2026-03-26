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

describe('auth me route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedResolveIdentity.mockResolvedValue({
      memberId: 'member-1',
    })
  })

  it('returns the primary Sui address with the authenticated user payload', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      displayName: 'Claw User',
      tgName: 'claw-user',
      avatar: null,
      level: 3,
      bio: 'bio',
      kind: 'human',
      walletBindings: [{ address: '0xabc123' }],
    })

    const { GET } = await import('../../web/app/api/auth/me/route.ts')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'member-1',
        tgName: 'Claw User',
        avatar: null,
        level: 3,
        bio: 'bio',
        kind: 'human',
        primarySuiAddress: '0xabc123',
      },
    })
    expect(mockedPrisma.member.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          walletBindings: expect.any(Object),
        }),
      }),
    )
  })
})
