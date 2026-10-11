import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedStartDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedPollDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedCompleteDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedConsumeWalletChallenge = vi.hoisted(() => vi.fn())

class DesktopDeviceSessionConflictErrorMock extends Error {
  constructor() {
    super('Session already confirmed by another account')
    this.name = 'DesktopDeviceSessionConflictError'
  }
}

class DesktopPetAddressConflictErrorMock extends Error {
  constructor() {
    super('Pet address already bound elsewhere')
    this.name = 'DesktopPetAddressConflictError'
  }
}

vi.mock('@/lib/desktop/device-session', () => ({
  startDesktopDeviceSession: mockedStartDesktopDeviceSession,
  pollDesktopDeviceSession: mockedPollDesktopDeviceSession,
  completeDesktopDeviceSession: mockedCompleteDesktopDeviceSession,
  DesktopDeviceSessionConflictError: DesktopDeviceSessionConflictErrorMock,
  DesktopPetAddressConflictError: DesktopPetAddressConflictErrorMock,
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  requireMutationIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: () => '127.0.0.1',
  getAnonymousRateLimitFingerprint: () => 'test-fingerprint',
}))

vi.mock('@web/lib/auth/challenge', () => ({
  normalizeSuiWalletAddress: (value: string | null | undefined) => value?.trim() || null,
}))

vi.mock('@web/lib/auth/wallet-challenge', () => ({
  consumeWalletChallengeForPurpose: mockedConsumeWalletChallenge,
}))

describe('POST /api/desktop/device/start', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedConsumeWalletChallenge.mockResolvedValue({ ok: true, address: '0xagent123' })
  })

  it('rejects when body is missing required fields', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    const response = await POST(new Request('http://localhost', { method: 'POST' }) as any)
    expect(response.status).toBe(400)
    expect(mockedStartDesktopDeviceSession).not.toHaveBeenCalled()
  })

  it('rejects when agentAddress / nonce / signature are missing', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ agentAddress: '0xagent123' }),
    }) as any)
    expect(response.status).toBe(400)
    expect(mockedStartDesktopDeviceSession).not.toHaveBeenCalled()
  })

  it('returns 401 when challenge consume fails', async () => {
    mockedConsumeWalletChallenge.mockResolvedValue({ ok: false, reason: 'signature_invalid' })
    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        agentAddress: '0xagent123',
        nonce: '11111111-1111-4111-8111-111111111111',
        signature: 'sig',
      }),
    }) as any)
    expect(response.status).toBe(401)
    expect(mockedStartDesktopDeviceSession).not.toHaveBeenCalled()
  })

  it('creates a device session when signature is valid', async () => {
    const sessionData = {
      deviceCode: 'abc123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    }
    mockedStartDesktopDeviceSession.mockResolvedValue(sessionData)

    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        agentAddress: ' 0xagent123 ',
        nonce: '11111111-1111-4111-8111-111111111111',
        signature: 'sig',
      }),
    }) as any)
    const body = await response.json()

    expect(body).toEqual(sessionData)
    expect(mockedStartDesktopDeviceSession).toHaveBeenCalledWith({
      agentAddress: '0xagent123',
    })
  })
})

describe('POST /api/desktop/device/poll', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 400 when deviceCode missing', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/poll/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
  })

  it('returns poll status for valid device code', async () => {
    mockedPollDesktopDeviceSession.mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/poll/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: 'abc123' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('pending')
  })

  it('returns desktopAccessToken + agentApiKey on confirmed when both are set', async () => {
    mockedPollDesktopDeviceSession.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-A',
      deepLink: null,
      desktopAccessToken: 'dtk_abc',
      agentApiKey: 'sk-abc',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/poll/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: 'abc123' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('confirmed')
    expect(body.desktopAccessToken).toBe('dtk_abc')
    expect(body.agentApiKey).toBe('sk-abc')
  })

  it('omits agentApiKey from confirmed response when post-rotation', async () => {
    mockedPollDesktopDeviceSession.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-A',
      deepLink: null,
      desktopAccessToken: 'dtk_abc',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/poll/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: 'abc123' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('confirmed')
    expect(body.agentApiKey).toBeUndefined()
    expect(body.desktopAccessToken).toBe('dtk_abc')
  })
})

describe('POST /api/desktop/device/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { accountId: 'account-123', kind: 'human' },
    })
  })

  it('returns 400 when userCode missing', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
  })

  it('confirms session with valid userCode and the response carries no secrets', async () => {
    mockedCompleteDesktopDeviceSession.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      deviceCode: 'abc',
      userCode: 'ABCD-EFGH',
      deepLink: null,
      expiresAt: '2026-04-12T10:10:00.000Z',
      confirmedAt: '2026-04-12T10:05:00.000Z',
      pollInterval: 5,
      petId: 'pet-1',
      agentAddress: '0xagent123',
    })

    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('confirmed')
    expect(body.accountId).toBe('account-123')
    // Browser-safe fields drive the post-link auto-authorize UX:
    expect(body.petId).toBe('pet-1')
    expect(body.agentAddress).toBe('0xagent123')
    // Secrets must not leak through the cookie path:
    expect(body).not.toHaveProperty('desktopAccessToken')
    expect(body).not.toHaveProperty('agentApiKey')
    expect(body).not.toHaveProperty('deviceCode')
  })

  it('returns 409 when DesktopPetAddressConflictError is thrown', async () => {
    mockedCompleteDesktopDeviceSession.mockRejectedValue(new DesktopPetAddressConflictErrorMock())

    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toContain('bound')
  })

  it('returns 409 when DesktopDeviceSessionConflictError is thrown', async () => {
    mockedCompleteDesktopDeviceSession.mockRejectedValue(new DesktopDeviceSessionConflictErrorMock())

    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))

    expect(response.status).toBe(409)
  })
})
