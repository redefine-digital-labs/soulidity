import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPetFindUnique = vi.fn()
const mockPetUpdate = vi.fn()

vi.mock('@web/lib/prisma', () => ({
  prisma: {
    desktopPet: {
      findUnique: (...args: unknown[]) => mockPetFindUnique(...args),
      update: (...args: unknown[]) => mockPetUpdate(...args),
    },
    desktopProfile: {
      findUnique: vi.fn(),
    },
  },
}))

beforeEach(async () => {
  vi.resetAllMocks()
  mockPetUpdate.mockResolvedValue({})
  const { __resetDesktopLastSeenThrottleForTests } = await import('../../web/lib/desktop/auth')
  __resetDesktopLastSeenThrottleForTests()
})

describe('verifyDesktopAccessToken lastSeenAt 60s throttle', () => {
  it('writes once, then suppresses for 60s, then writes again after the window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T10:00:00Z'))

    const { generateDesktopAccessToken, verifyDesktopAccessToken } = await import('../../web/lib/desktop/auth')
    const { token, hash } = generateDesktopAccessToken()

    mockPetFindUnique.mockResolvedValue({
      id: 'pet-1',
      accountId: 'account-A',
      agentAddress: '0xagent',
      agentMemberId: 'member-9',
      desktopAccessTokenHash: hash,
      desktopAccessTokenIssuedAt: new Date('2026-04-12T10:00:00Z'),
    })

    // 1st call: should issue the heartbeat.
    await verifyDesktopAccessToken(token)
    // Settle the fire-and-forget promise from the verify path.
    await Promise.resolve()
    expect(mockPetUpdate).toHaveBeenCalledTimes(1)

    // 4 subsequent calls within 60s — all suppressed.
    for (let i = 0; i < 4; i += 1) {
      vi.setSystemTime(new Date(Date.parse('2026-04-12T10:00:00Z') + 10_000 * (i + 1)))
      await verifyDesktopAccessToken(token)
      await Promise.resolve()
    }
    expect(mockPetUpdate).toHaveBeenCalledTimes(1)

    // After 60s: heartbeat fires again.
    vi.setSystemTime(new Date(Date.parse('2026-04-12T10:01:01Z')))
    await verifyDesktopAccessToken(token)
    await Promise.resolve()
    expect(mockPetUpdate).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})
