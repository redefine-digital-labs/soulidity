import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_WALLET = `0x${'0'.repeat(63)}1`
const CHALLENGE_NONCE = '550e8400-e29b-41d4-a716-446655440000'

const mockedPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  walletChallenge: {
    create: vi.fn(),
    deleteMany: vi.fn(),
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

vi.mock('@web/lib/rate-limit', () => ({
  ...mockedRateLimit,
  MISSING_CLIENT_IP_ERROR: 'Unable to determine client IP',
}))

vi.mock('@mysten/sui/verify', () => mockedVerify)
vi.mock('@web/lib/sui-verify', () => mockedVerify)

describe('agent join route hardening', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRateLimit.getRequestIp.mockReturnValue('127.0.0.1')
    mockedRateLimit.takeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 120,
    })
    mockedPrisma.walletChallenge.deleteMany.mockResolvedValue({ count: 0 })
    mockedPrisma.walletChallenge.create.mockResolvedValue({
      nonce: 'nonce-1',
    })
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockedPrisma) => Promise<unknown>) => callback(mockedPrisma))
    mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => AGENT_WALLET,
    })
  })

  it('rejects challenge issuance when the client IP cannot be determined', async () => {
    mockedRateLimit.getRequestIp.mockReturnValue(null)

    const { GET } = await import('../../web/app/api/agent-join/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
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

  it('throttles stale wallet challenge cleanup across burst agent registration requests', async () => {
    const { GET } = await import('../../web/app/api/agent-join/route.ts')

    const firstResponse = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
        headers: new Headers({ host: 'localhost' }),
      } as any,
    )
    const secondResponse = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
        headers: new Headers({ host: 'localhost' }),
      } as any,
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockedPrisma.walletChallenge.deleteMany).toHaveBeenCalledTimes(1)
  })

  it('does not wait for stale wallet challenge cleanup before issuing a new agent registration challenge', async () => {
    let resolveCleanup: ((value: { count: number }) => void) | undefined

    mockedPrisma.walletChallenge.deleteMany.mockImplementation(
      () => new Promise((resolve) => { resolveCleanup = resolve }),
    )

    const { GET } = await import('../../web/app/api/agent-join/route.ts')
    const responsePromise = GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
        headers: new Headers({ host: 'localhost' }),
      } as any,
    )

    let settled = false
    responsePromise.then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()

    const settledBeforeCleanup = settled
    resolveCleanup?.({ count: 0 })

    const response = await responsePromise
    expect(settledBeforeCleanup).toBe(true)
    expect(response.status).toBe(200)
    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalled()
  })

  it('sanitizes stale wallet challenge cleanup failures before logging them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrisma.walletChallenge.deleteMany.mockRejectedValue(new Error('postgres://secret@db'))

    const { GET } = await import('../../web/app/api/agent-join/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
        headers: new Headers({ host: 'localhost' }),
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

  it('cleans stale wallet challenges before issuing a new agent registration challenge', async () => {
    const { GET } = await import('../../web/app/api/agent-join/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join?address=0xabc'),
        headers: new Headers({ host: 'localhost' }),
      } as any,
    )

    expect(response.status).toBe(200)
    expect(mockedPrisma.walletChallenge.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(Date) },
      },
    })
    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalled()
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

  it('rejects agent registration names longer than 100 characters', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      nonce: 'nonce-1',
      address: AGENT_WALLET,
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })

    const { POST } = await import('../../web/app/api/agent-join/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost' },
        body: JSON.stringify({
          wallet: '0x1',
          chain: 'sui',
          name: 'x'.repeat(101),
          nonce: CHALLENGE_NONCE,
          signature: 'signature',
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'name must be 100 characters or fewer',
    })
  })

  it('rejects signatures longer than the route limit before verification work starts', async () => {
    const { POST } = await import('../../web/app/api/agent-join/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost' },
        body: JSON.stringify({
          wallet: '0x1',
          chain: 'sui',
          name: 'Agent Smith',
          nonce: CHALLENGE_NONCE,
          signature: 's'.repeat(1025),
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'signature must be 1024 characters or fewer',
    })
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
  })

  it('rejects non-uuid challenge nonces before any DB lookup', async () => {
    const { POST } = await import('../../web/app/api/agent-join/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost' },
        body: JSON.stringify({
          wallet: '0x1',
          chain: 'sui',
          name: 'Agent Smith',
          nonce: 'not-a-uuid',
          signature: 'signature',
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'nonce must be a valid UUID from GET /api/agent-join',
    })
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
  })

  it('returns 409 when a concurrent join request wins the wallet binding race', async () => {
    const conflict = new Error('Unique constraint failed')
    ;(conflict as Error & { code?: string }).code = 'P2002'

    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      nonce: CHALLENGE_NONCE,
      address: AGENT_WALLET,
      domain: 'localhost',
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.member.create.mockRejectedValue(conflict)

    const { POST } = await import('../../web/app/api/agent-join/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost' },
        body: JSON.stringify({
          wallet: AGENT_WALLET,
          chain: 'sui',
          name: 'Concurrent Agent',
          nonce: CHALLENGE_NONCE,
          signature: 'signature',
        }),
      }) as any,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This wallet address is already registered',
    })
  })

  it('creates pending agent members without writing the legacy member.wallet field', async () => {
    process.env.AUTH_SECRET = 'test-auth-secret'
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      nonce: CHALLENGE_NONCE,
      address: AGENT_WALLET,
      domain: 'localhost',
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.member.create.mockResolvedValue({
      id: 'member-agent-1',
      displayName: 'Agent Smith',
    })

    const { POST } = await import('../../web/app/api/agent-join/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'localhost' },
        body: JSON.stringify({
          wallet: AGENT_WALLET,
          chain: 'sui',
          name: 'Agent Smith',
          nonce: CHALLENGE_NONCE,
          signature: 'signature',
        }),
      }) as any,
    )

    expect(response.status).toBe(201)
    expect(mockedPrisma.member.create).toHaveBeenCalledWith({
      data: {
        kind: 'agent',
        displayName: 'Agent Smith',
        walletBindings: {
          create: {
            chain: 'sui',
            address: AGENT_WALLET,
            isPrimary: true,
          },
        },
      },
      select: { id: true, displayName: true },
    })
  })
})
