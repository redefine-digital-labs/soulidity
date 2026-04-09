import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedCompleteDesktopDeviceSession = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@/lib/desktop/device-session', () => ({
  completeDesktopDeviceSession: mockedCompleteDesktopDeviceSession,
}))

describe('desktop device complete route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: {
        accountId: 'account-123',
        memberId: 'member-123',
        kind: 'human',
      },
    })
  })

  it('confirms a device session for the signed-in account', async () => {
    mockedCompleteDesktopDeviceSession.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      deepLink: 'soulidity://auth/device?deviceCode=device-code-123&status=confirmed',
      expiresAt: '2026-04-10T04:05:00.000Z',
      confirmedAt: '2026-04-10T04:01:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/complete/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))

    expect(response.status).toBe(200)
    expect(mockedCompleteDesktopDeviceSession).toHaveBeenCalledWith('ABCD-EFGH', 'account-123')
    await expect(response.json()).resolves.toEqual({
      status: 'confirmed',
      accountId: 'account-123',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      deepLink: 'soulidity://auth/device?deviceCode=device-code-123&status=confirmed',
      expiresAt: '2026-04-10T04:05:00.000Z',
      confirmedAt: '2026-04-10T04:01:00.000Z',
      pollInterval: 5,
    })
  })

  it('rejects anonymous completion requests', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: '请先登录' }), { status: 401 }),
      identity: null,
    })

    const { POST } = await import('../../web/app/api/desktop/device/complete/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))

    expect(response.status).toBe(401)
    expect(mockedCompleteDesktopDeviceSession).not.toHaveBeenCalled()
  })

  it('rejects non-human identities', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: {
        accountId: 'account-123',
        memberId: 'member-123',
        kind: 'agent',
      },
    })

    const { POST } = await import('../../web/app/api/desktop/device/complete/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))

    expect(response.status).toBe(403)
    expect(mockedCompleteDesktopDeviceSession).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Only human accounts can confirm a desktop device',
    })
  })

  it('rejects completion requests without a user code', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/complete/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
    expect(mockedCompleteDesktopDeviceSession).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'userCode is required',
    })
  })
})
