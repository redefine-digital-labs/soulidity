import { beforeEach, describe, expect, it, vi } from 'vitest'

const NORMALIZED_ADDRESS = `0x${'0'.repeat(63)}1`

const mockedPrisma = vi.hoisted(() => ({
  walletChallenge: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

const mockedRateLimit = vi.hoisted(() => ({
  getRequestIp: vi.fn(),
  takeRateLimitToken: vi.fn(),
}))

const mockedCrypto = vi.hoisted(() => ({
  randomUUID: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => ({
  ...mockedRateLimit,
  MISSING_CLIENT_IP_ERROR: 'Unable to determine client IP',
}))

vi.mock('crypto', () => mockedCrypto)

describe('auth challenge route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_BASE_URL: 'https://clawnews.example.com',
    }

    mockedRateLimit.getRequestIp.mockReturnValue('203.0.113.10')
    mockedRateLimit.takeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 60,
    })
    mockedCrypto.randomUUID.mockReturnValue('nonce-1')
    mockedPrisma.walletChallenge.deleteMany.mockResolvedValue({ count: 0 })
    mockedPrisma.walletChallenge.create.mockResolvedValue({ nonce: 'nonce-1' })
  })

  it('rejects challenge requests when the client IP cannot be determined', async () => {
    mockedRateLimit.getRequestIp.mockReturnValue(null)

    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers(),
      } as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to determine client IP',
    })
    expect(mockedRateLimit.takeRateLimitToken).not.toHaveBeenCalled()
    expect(mockedPrisma.walletChallenge.create).not.toHaveBeenCalled()
  })

  it('throttles stale challenge cleanup so burst requests do not delete on every call', async () => {
    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')

    const firstResponse = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )
    const secondResponse = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockedPrisma.walletChallenge.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('does not wait for stale challenge cleanup before issuing a new challenge', async () => {
    let resolveCleanup: ((value: { count: number }) => void) | undefined

    mockedPrisma.walletChallenge.deleteMany.mockImplementation(
      () => new Promise((resolve) => { resolveCleanup = resolve }),
    )

    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')
    const responsePromise = GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )

    let settled = false
    responsePromise.then(() => { settled = true })
    // Allow enough microtask ticks for the async rate limiter + response to settle
    for (let i = 0; i < 10; i++) await Promise.resolve()

    const settledBeforeCleanup = settled
    resolveCleanup?.({ count: 0 })

    const response = await responsePromise
    expect(settledBeforeCleanup).toBe(true)
    expect(response.status).toBe(200)
    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalled()
  })

  it('sanitizes stale challenge cleanup failures before logging them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrisma.walletChallenge.deleteMany.mockRejectedValue(new Error('postgres://secret@db'))

    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )

    expect(response.status).toBe(200)
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to cleanup stale wallet challenges', {
        errorName: 'Error',
      })
    })

    consoleError.mockRestore()
  })

  it('rate limits challenge creation before writing wallet_challenges rows', async () => {
    mockedRateLimit.takeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 300,
    })

    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('300')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many challenge requests, try again later',
    })
    expect(mockedPrisma.walletChallenge.create).not.toHaveBeenCalled()
  })

  it('rejects invalid Sui addresses before persisting a challenge', async () => {
    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=not-a-wallet'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'address must be a valid Sui address',
    })
    expect(mockedPrisma.walletChallenge.create).not.toHaveBeenCalled()
  })

  it('uses the configured app domain instead of the request host', async () => {
    const startedAt = Date.now()
    const { GET } = await import('../../web/app/api/auth/challenge/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/auth/challenge?address=0x1'),
        headers: new Headers({ host: 'evil.example.com' }),
      } as any,
    )

    expect(response.status).toBe(200)
    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalledWith({
      data: {
        address: NORMALIZED_ADDRESS,
        nonce: 'nonce-1',
        expiresAt: expect.any(Date),
        domain: 'clawnews.example.com',
      },
    })
    const expiresAt = mockedPrisma.walletChallenge.create.mock.calls[0]?.[0]?.data?.expiresAt as Date
    expect(expiresAt.getTime() - startedAt).toBeGreaterThanOrEqual(4.5 * 60 * 1000)
    expect(expiresAt.getTime() - startedAt).toBeLessThanOrEqual(5.5 * 60 * 1000)
    expect(mockedPrisma.walletChallenge.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(Date) },
      },
    })

    const payload = await response.json()
    expect(payload).toMatchObject({
      nonce: 'nonce-1',
      expiresAt: expect.any(String),
    })
    expect(payload.message).toContain('clawnews.example.com wants you to sign in with your Sui account:')
    expect(payload.message).toContain(NORMALIZED_ADDRESS)
    expect(payload.message).not.toContain('evil.example.com')
  })
})
