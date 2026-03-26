import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedIsValidClaimToken = vi.hoisted(() => vi.fn())
const mockedGenerateApiKey = vi.hoisted(() => vi.fn())
const mockedBuildAgentApiKeyData = vi.hoisted(() => vi.fn())
const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/agent-claim-token', () => ({
  isValidClaimToken: mockedIsValidClaimToken,
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  generateApiKey: mockedGenerateApiKey,
  buildAgentApiKeyData: mockedBuildAgentApiKeyData,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: mockedGetRequestIp,
  takeRateLimitToken: mockedTakeRateLimitToken,
  MISSING_CLIENT_IP_ERROR: 'Unable to determine client IP',
}))

describe('agent join claim route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', accountId: 'account-1', kind: 'human' },
    })
    mockedIsValidClaimToken.mockReturnValue(true)
    mockedGenerateApiKey.mockReturnValue('sk-agent-key')
    mockedBuildAgentApiKeyData.mockReturnValue({
      apiKey: null,
      apiKeyHash: 'hash',
      agentStatus: 'active',
    })
    mockedGetRequestIp.mockReturnValue('127.0.0.1')
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'agent-1',
      kind: 'agent',
      accountId: null,
    })
    mockedPrisma.member.updateMany.mockResolvedValue({ count: 1 })
  })

  it('rate limits GET lookups by client IP before loading the agent row', async () => {
    mockedTakeRateLimitToken.mockReturnValueOnce({ limited: true, retryAfterSeconds: 120 })

    const { GET } = await import('../../web/app/api/agent-join/claim/route.ts')
    const response = await GET(
      {
        nextUrl: new URL('http://localhost/api/agent-join/claim?id=agent-1&token=claim-token'),
        headers: new Headers({ 'x-forwarded-for': '127.0.0.1' }),
      } as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many claim requests, try again later',
    })
    expect(mockedPrisma.member.findUnique).not.toHaveBeenCalled()
  })

  it('rate limits POST claims by authenticated member before mutating the agent row', async () => {
    mockedTakeRateLimitToken.mockReturnValueOnce({ limited: true, retryAfterSeconds: 90 })

    const { POST } = await import('../../web/app/api/agent-join/claim/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'agent-1', token: 'claim-token' }),
      }) as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('90')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many claim requests, try again later',
    })
    expect(mockedPrisma.member.updateMany).not.toHaveBeenCalled()
  })

  it('rejects non-string claim payload fields before validating the token', async () => {
    const { POST } = await import('../../web/app/api/agent-join/claim/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent-join/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: { nested: true }, token: 123 }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'id and token are required',
    })
    expect(mockedIsValidClaimToken).not.toHaveBeenCalled()
    expect(mockedPrisma.member.updateMany).not.toHaveBeenCalled()
  })
})
