import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedStartDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedPollDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedCompleteDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/device-session', () => ({
  startDesktopDeviceSession: mockedStartDesktopDeviceSession,
  pollDesktopDeviceSession: mockedPollDesktopDeviceSession,
  completeDesktopDeviceSession: mockedCompleteDesktopDeviceSession,
  DesktopDeviceSessionConflictError: class extends Error {
    constructor() { super('Session already confirmed by another account') }
  },
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

describe('POST /api/desktop/device/start', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
  })

  it('creates a device session', async () => {
    const sessionData = {
      deviceCode: 'abc123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    }
    mockedStartDesktopDeviceSession.mockResolvedValue(sessionData)

    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    const response = await POST(new Request('http://localhost', { method: 'POST' }) as any)
    const body = await response.json()

    expect(body).toEqual(sessionData)
  })

  it('forwards agentAddress from request body', async () => {
    const sessionData = {
      deviceCode: 'abc123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-12T10:10:00.000Z',
      pollInterval: 5,
    }
    mockedStartDesktopDeviceSession.mockResolvedValue(sessionData)

    const { POST } = await import('../../web/app/api/desktop/device/start/route')
    await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ agentAddress: ' 0xagent123 ' }),
    }) as any)

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

  it('confirms session with valid userCode', async () => {
    mockedCompleteDesktopDeviceSession.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      deviceCode: 'abc',
      userCode: 'ABCD-EFGH',
      deepLink: 'soulidity://auth?token=xxx',
      expiresAt: '2026-04-12T10:10:00.000Z',
      confirmedAt: '2026-04-12T10:05:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/complete/route')
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))
    const body = await response.json()

    expect(body.status).toBe('confirmed')
    expect(body.accountId).toBe('account-123')
  })
})
