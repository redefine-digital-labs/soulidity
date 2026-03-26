import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveAgentByApiKey = vi.hoisted(() => vi.fn())
const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: mockedResolveAgentByApiKey,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: mockedGetRequestIp,
  MISSING_CLIENT_IP_ERROR: 'Unable to determine client IP',
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

describe('requireAgentApiKey', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveAgentByApiKey.mockResolvedValue(null)
    mockedGetRequestIp.mockReturnValue('127.0.0.1')
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
  })

  it('fails closed when a failed API-key auth attempt has no trusted client IP', async () => {
    mockedGetRequestIp.mockReturnValue(null)

    const { requireAgentApiKey } = await import('../../web/lib/auth/require-agent-api-key.ts')
    const result = await requireAgentApiKey(
      new Request('http://localhost/api/agent/souls/1', {
        headers: { authorization: 'Bearer sk-invalid' },
      }) as any,
    )

    expect(result.agent).toBeNull()
    expect(result.response?.status).toBe(400)
    await expect(result.response?.json()).resolves.toEqual({
      error: 'Unable to determine client IP',
    })
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
  })

  it('returns 401 when the authorization header is missing', async () => {
    const { requireAgentApiKey } = await import('../../web/lib/auth/require-agent-api-key.ts')
    const result = await requireAgentApiKey(
      new Request('http://localhost/api/agent/souls/1') as any,
    )

    expect(result.agent).toBeNull()
    expect(result.response?.status).toBe(401)
    await expect(result.response?.json()).resolves.toEqual({
      error: 'Unauthorized',
    })
    expect(mockedResolveAgentByApiKey).not.toHaveBeenCalled()
  })

  it('returns 401 for non-sk bearer tokens and records the failed attempt', async () => {
    const { requireAgentApiKey } = await import('../../web/lib/auth/require-agent-api-key.ts')
    const result = await requireAgentApiKey(
      new Request('http://localhost/api/agent/souls/1', {
        headers: { authorization: 'Bearer not-an-agent-key' },
      }) as any,
    )

    expect(result.agent).toBeNull()
    expect(result.response?.status).toBe(401)
    await expect(result.response?.json()).resolves.toEqual({
      error: 'Unauthorized',
    })
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'agent-auth-failed:127.0.0.1',
      expect.any(Object),
    )
    expect(mockedResolveAgentByApiKey).not.toHaveBeenCalled()
  })

  it('returns 401 when an sk-prefixed API key does not resolve to an agent', async () => {
    const { requireAgentApiKey } = await import('../../web/lib/auth/require-agent-api-key.ts')
    const result = await requireAgentApiKey(
      new Request('http://localhost/api/agent/souls/1', {
        headers: { authorization: 'Bearer sk-invalid' },
      }) as any,
    )

    expect(result.agent).toBeNull()
    expect(result.response?.status).toBe(401)
    await expect(result.response?.json()).resolves.toEqual({
      error: 'Invalid API key',
    })
    expect(mockedResolveAgentByApiKey).toHaveBeenCalledWith('sk-invalid')
  })

  it('returns the resolved agent identity for a valid API key', async () => {
    mockedResolveAgentByApiKey.mockResolvedValueOnce({
      agentMemberId: 'agent-member-1',
      ownerMemberId: 'human-member-1',
      accountId: 'account-1',
    })

    const { requireAgentApiKey } = await import('../../web/lib/auth/require-agent-api-key.ts')
    const result = await requireAgentApiKey(
      new Request('http://localhost/api/agent/souls/1', {
        headers: { authorization: 'Bearer sk-valid-key' },
      }) as any,
    )

    expect(result.response).toBeNull()
    expect(result.agent).toEqual({
      agentMemberId: 'agent-member-1',
      ownerMemberId: 'human-member-1',
      accountId: 'account-1',
    })
  })

  it('returns 429 after too many failed API-key attempts', async () => {
    mockedTakeRateLimitToken.mockReturnValueOnce({ limited: true, retryAfterSeconds: 30 })

    const { requireAgentApiKey } = await import('../../web/lib/auth/require-agent-api-key.ts')
    const result = await requireAgentApiKey(
      new Request('http://localhost/api/agent/souls/1', {
        headers: { authorization: 'Bearer sk-invalid' },
      }) as any,
    )

    expect(result.agent).toBeNull()
    expect(result.response?.status).toBe(429)
    expect(result.response?.headers.get('Retry-After')).toBe('30')
    await expect(result.response?.json()).resolves.toEqual({
      error: 'Too many invalid API key attempts',
    })
  })
})
