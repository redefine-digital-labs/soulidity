import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const mockedPrivy = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
}))

const mockedRateLimit = vi.hoisted(() => ({
  getRequestIp: vi.fn(),
  takeRateLimitToken: vi.fn(),
}))

const mockedIsValidClaimToken = vi.hoisted(() => vi.fn())
const mockedGenerateApiKey = vi.hoisted(() => vi.fn())
const mockedBuildAgentApiKeyData = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

vi.mock('@web/lib/rate-limit', () => ({
  ...mockedRateLimit,
  MISSING_CLIENT_IP_ERROR: 'Unable to determine client IP',
}))

vi.mock('@web/lib/auth/agent-claim-token', () => ({
  isValidClaimToken: mockedIsValidClaimToken,
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  generateApiKey: mockedGenerateApiKey,
  buildAgentApiKeyData: mockedBuildAgentApiKeyData,
}))

describe('agent join claim-register route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRateLimit.getRequestIp.mockReturnValue('127.0.0.1')
    mockedRateLimit.takeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrivy.verifyAuthToken.mockResolvedValue({ userId: 'did:privy:123' })
    mockedPrivy.getUser.mockResolvedValue({ email: { address: 'user@example.com', firstVerifiedAt: new Date() } })
    mockedPrisma.account.findUnique.mockResolvedValue(null)
    mockedPrisma.$transaction.mockResolvedValue({ apiKey: 'sk-agent-key' })
    mockedIsValidClaimToken.mockReturnValue(true)
    mockedGenerateApiKey.mockReturnValue('sk-agent-key')
    mockedBuildAgentApiKeyData.mockReturnValue({
      apiKey: null,
      apiKeyHash: 'hash',
      agentStatus: 'active',
    })
  })

  it('rejects non-string claim payload fields before touching claim state', async () => {
    const { POST } = await import('../../web/app/api/agent-join/claim-register/route.ts')
    const response = await POST(new Request('http://localhost/api/agent-join/claim-register', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: { nested: true }, token: 123 }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'id and token are required',
    })
    expect(mockedIsValidClaimToken).not.toHaveBeenCalled()
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('logs only sanitized error metadata for unexpected failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrisma.$transaction.mockRejectedValueOnce(new Error('db exploded'))

    const { POST } = await import('../../web/app/api/agent-join/claim-register/route.ts')
    const response = await POST(new Request('http://localhost/api/agent-join/claim-register', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'agent-1', token: 'claim-token' }),
    }) as any)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Registration failed' })
    expect(consoleError).toHaveBeenCalledWith('[claim-register] unexpected error:', {
      name: 'Error',
      message: 'db exploded',
    })

    consoleError.mockRestore()
  })
})
