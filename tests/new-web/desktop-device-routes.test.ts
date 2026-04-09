import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedStartDesktopDeviceSession = vi.hoisted(() => vi.fn())
const mockedPollDesktopDeviceSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/device-session', () => ({
  startDesktopDeviceSession: mockedStartDesktopDeviceSession,
  pollDesktopDeviceSession: mockedPollDesktopDeviceSession,
}))

describe('desktop device routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('starts a device session with the desktop auth bootstrap payload', async () => {
    mockedStartDesktopDeviceSession.mockResolvedValue({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-10T04:00:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/start/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/start', {
      method: 'POST',
    }))

    expect(response.status).toBe(200)
    expect(mockedStartDesktopDeviceSession).toHaveBeenCalledWith()
    await expect(response.json()).resolves.toEqual({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-10T04:00:00.000Z',
      pollInterval: 5,
    })
  })

  it('polls a device session by device code', async () => {
    mockedPollDesktopDeviceSession.mockResolvedValue({
      status: 'pending',
      expiresAt: '2026-04-10T04:00:00.000Z',
      pollInterval: 5,
    })

    const { POST } = await import('../../web/app/api/desktop/device/poll/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/poll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceCode: 'device-code-123' }),
    }))

    expect(response.status).toBe(200)
    expect(mockedPollDesktopDeviceSession).toHaveBeenCalledWith('device-code-123')
    await expect(response.json()).resolves.toEqual({
      status: 'pending',
      expiresAt: '2026-04-10T04:00:00.000Z',
      pollInterval: 5,
    })
  })

  it('rejects poll requests without a device code', async () => {
    const { POST } = await import('../../web/app/api/desktop/device/poll/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/device/poll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
    expect(mockedPollDesktopDeviceSession).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'deviceCode is required',
    })
  })
})
