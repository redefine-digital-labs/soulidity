import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const validAgentMemberId = '550e8400-e29b-41d4-a716-446655440000'

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('POST /api/agent/api-key', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'owner-1',
      kind: 'human',
    })
    mockedTakeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 3600,
    })
    mockedPrisma.member.findFirst.mockResolvedValue({
      id: validAgentMemberId,
    })
    mockedPrisma.member.update.mockResolvedValue({
      id: validAgentMemberId,
    })
  })

  it('returns a raw key once and stores only its hash for agent auth', async () => {
    const { POST } = await import('../../web/app/api/agent/api-key/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/api-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentMemberId: validAgentMemberId,
        }),
      }) as any,
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.apiKey).toMatch(/^sk-[0-9a-f]+$/)

    expect(mockedPrisma.member.update).toHaveBeenCalledWith({
      where: { id: validAgentMemberId },
      data: expect.objectContaining({
        apiKey: null,
        apiKeyHash: createHash('sha256').update(payload.apiKey).digest('hex'),
        agentStatus: 'active',
      }),
    })
  })

  it('requires explicit header auth instead of cookie fallback', async () => {
    const { POST } = await import('../../web/app/api/agent/api-key/route.ts')

    await POST(
      new Request('http://localhost/api/agent/api-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentMemberId: validAgentMemberId,
        }),
      }) as any,
    )

    expect(mockedResolveIdentity).toHaveBeenCalledWith({ allowCookieFallback: false })
  })

  it('returns 400 for an invalid agentMemberId', async () => {
    const { POST } = await import('../../web/app/api/agent/api-key/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/api-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentMemberId: 'not-a-uuid',
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid agentMemberId' })
  })

  it('rate limits repeated API key rotations', async () => {
    mockedTakeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 3600,
    })

    const { POST } = await import('../../web/app/api/agent/api-key/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/api-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentMemberId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }) as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
    await expect(response.json()).resolves.toEqual({ error: 'Too many requests' })
  })
})
