import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockedResolveAgentByApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedGetAnonymousRateLimitFingerprint = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: mockedResolveAgentByApiKey,
}))
vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: mockedGetRequestIp,
  getAnonymousRateLimitFingerprint: mockedGetAnonymousRateLimitFingerprint,
}))

import { requireAgentWalletIdentity } from '../../web/lib/soulidity/agent-server'

function makeRequest(authHeader?: string) {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new Request('http://localhost:3100/api/agent/test', { headers })
}

describe('requireAgentWalletIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false })
    mockedGetRequestIp.mockReturnValue('127.0.0.1')
    mockedGetAnonymousRateLimitFingerprint.mockReturnValue('anon-fingerprint')
  })

  it('returns 401 when no Authorization header', async () => {
    const result = await requireAgentWalletIdentity(makeRequest())
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns 401 when token is not sk- prefixed', async () => {
    const result = await requireAgentWalletIdentity(makeRequest('Bearer eyJ...'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns 401 when API key is invalid', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue(null)
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-invalid'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('returns 403 when agent has no wallet', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'acc-1',
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([])
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-valid'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(403)
    }
  })

  it('returns 500 when wallet resolution fails', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'acc-1',
    })
    mockedGetMemberSuiWalletAddresses.mockRejectedValue(new Error('DB error'))
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-valid'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(500)
    }
  })

  it('returns agent identity + wallet addresses on success', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'acc-1',
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue(['0xabc'])
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-valid'))
    expect('agent' in result).toBe(true)
    if ('agent' in result) {
      expect(result.agent.agentMemberId).toBe('agent-1')
      expect(result.agent.ownerMemberId).toBe('owner-1')
      expect(result.walletAddresses).toEqual(['0xabc'])
    }
  })

  it('rate limits failed auth attempts', async () => {
    mockedTakeRateLimitToken.mockResolvedValue({ limited: true, retryAfterSeconds: 30 })
    const result = await requireAgentWalletIdentity(makeRequest('Bearer sk-bad'))
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(429)
    }
  })

  it('falls back to anonymous fingerprint buckets when trusted ip is unavailable', async () => {
    mockedGetRequestIp.mockReturnValue(null)
    mockedGetAnonymousRateLimitFingerprint.mockReturnValue('anon-bucket')
    mockedResolveAgentByApiKey.mockResolvedValue(null)

    await requireAgentWalletIdentity(makeRequest('Bearer sk-bad'))

    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'agent-auth-failed:anon:anon-bucket',
      expect.any(Object),
    )
  })

  it('falls back to a fixed unknown bucket when both ip and fingerprint are missing', async () => {
    mockedGetRequestIp.mockReturnValue(null)
    mockedGetAnonymousRateLimitFingerprint.mockReturnValue(null)
    mockedResolveAgentByApiKey.mockResolvedValue(null)

    await requireAgentWalletIdentity(makeRequest('Bearer sk-bad'))

    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'agent-auth-failed:unknown',
      expect.any(Object),
    )
  })
})
