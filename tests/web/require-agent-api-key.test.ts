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

  it('returns 400 when a failed API-key auth attempt has no trusted client IP', async () => {
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
})
