import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPetFindUnique = vi.fn()
const mockPetUpdate = vi.fn()
const mockProfileFindUnique = vi.fn()

vi.mock('@web/lib/prisma', () => ({
  prisma: {
    desktopPet: {
      findUnique: (...args: unknown[]) => mockPetFindUnique(...args),
      update: (...args: unknown[]) => mockPetUpdate(...args),
    },
    desktopProfile: {
      // If the verify path ever queries desktop_profiles again, this mock
      // will count the call and the regression assertion will fail.
      findUnique: (...args: unknown[]) => mockProfileFindUnique(...args),
    },
  },
}))

beforeEach(async () => {
  vi.resetAllMocks()
  mockPetUpdate.mockResolvedValue({})
  const { __resetDesktopLastSeenThrottleForTests } = await import('../../web/lib/desktop/auth')
  __resetDesktopLastSeenThrottleForTests()
})

describe('verifyDesktopAccessToken regression: never reads desktop_profiles', () => {
  it('returns the desktopPet identity and does not touch DesktopProfile.findUnique', async () => {
    const { generateDesktopAccessToken, verifyDesktopAccessToken } = await import('../../web/lib/desktop/auth')
    const { token, hash } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-A',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })

    const result = await verifyDesktopAccessToken(token)

    expect(result).toEqual({
      accountId: 'account-A',
      desktopPet: {
        id: 'pet-1',
        accountId: 'account-A',
        agentAddress: '0xagent',
        agentMemberId: 'member-9',
      },
    })

    expect(mockPetFindUnique).toHaveBeenCalledTimes(1)
    expect(mockProfileFindUnique).not.toHaveBeenCalled()
  })
})
