import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  walletChallenge: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  walletBinding: {
    findUnique: vi.fn(),
  },
  member: {
    create: vi.fn(),
  },
}))

const mockedRateLimit = vi.hoisted(() => ({
  getRequestIp: vi.fn(),
  takeRateLimitToken: vi.fn(),
}))

const mockedVerify = vi.hoisted(() => ({
  verifyPersonalMessageSignature: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => mockedRateLimit)

vi.mock('@mysten/sui/verify', () => mockedVerify)

describe('agent join route hardening', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRateLimit.getRequestIp.mockReturnValue('127.0.0.1')
    mockedRateLimit.takeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 120,
    })
    mockedPrisma.walletChallenge.create.mockResolvedValue({
      nonce: 'nonce-1',
    })
  })

  it('rate limits challenge issuance before writing wallet_challenges rows', async () => {
    mockedRateLimit.takeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 300,
    })

    const { GET } = await import('../../web/app/api/agent-join/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
        headers: new Headers({ host: 'localhost' }),
      } as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('300')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many join requests, try again later',
    })
    expect(mockedPrisma.walletChallenge.create).not.toHaveBeenCalled()
  })

  it('publishes the dedicated agent registration challenge endpoint in service discovery', async () => {
    const { GET } = await import('../../web/app/.well-known/agent-join.json/route.ts')
    const response = await GET()
    const payload = await response.json()

    expect(payload.auth).toMatchObject({
      type: 'sui-wallet-challenge',
      challenge_endpoint: '/api/agent-join',
      register_endpoint: '/api/agent-join',
    })
  })
})
