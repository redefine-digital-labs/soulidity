import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedResolveDesktopDeviceAccount = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@/lib/desktop/device-session', () => ({
  resolveDesktopDeviceAccount: mockedResolveDesktopDeviceAccount,
}))

describe('desktop request auth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('accepts a confirmed desktop device session header as account auth', async () => {
    mockedResolveDesktopDeviceAccount.mockResolvedValue('account-123')

    const { DESKTOP_DEVICE_CODE_HEADER, requireDesktopAccountAccess } = await import(
      '../../web/lib/desktop/request-auth.ts'
    )

    const result = await requireDesktopAccountAccess(new Request('http://localhost/api/desktop/me', {
      headers: {
        [DESKTOP_DEVICE_CODE_HEADER]: 'device-code-123',
      },
    }))

    expect(mockedResolveDesktopDeviceAccount).toHaveBeenCalledWith('device-code-123')
    expect(mockedRequireIdentity).not.toHaveBeenCalled()
    expect(result).toEqual({
      error: null,
      accountId: 'account-123',
      transport: 'desktop-device',
    })
  })

  it('falls back to the signed-in browser identity when no desktop device session header is present', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: {
        accountId: 'browser-account-123',
        memberId: 'member-123',
        kind: 'human',
      },
    })

    const { requireDesktopAccountAccess } = await import('../../web/lib/desktop/request-auth.ts')
    const result = await requireDesktopAccountAccess(new Request('http://localhost/api/desktop/me'))

    expect(mockedResolveDesktopDeviceAccount).not.toHaveBeenCalled()
    expect(mockedRequireIdentity).toHaveBeenCalled()
    expect(result).toEqual({
      error: null,
      accountId: 'browser-account-123',
      transport: 'web',
    })
  })

  it('rejects an invalid desktop device session header', async () => {
    mockedResolveDesktopDeviceAccount.mockResolvedValue(null)

    const { DESKTOP_DEVICE_CODE_HEADER, requireDesktopAccountAccess } = await import(
      '../../web/lib/desktop/request-auth.ts'
    )
    const result = await requireDesktopAccountAccess(new Request('http://localhost/api/desktop/me', {
      headers: {
        [DESKTOP_DEVICE_CODE_HEADER]: 'missing-device-code',
      },
    }))

    expect(result.accountId).toBeNull()
    expect(result.error).toBeInstanceOf(Response)
    expect(result.transport).toBe('desktop-device')
    expect(result.error?.status).toBe(401)
    await expect(result.error?.json()).resolves.toEqual({
      error: 'Desktop device session is invalid or expired',
    })
  })

  it('rejects non-human browser identities for desktop profile routes', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: {
        accountId: 'agent-account-123',
        memberId: 'member-123',
        kind: 'agent',
      },
    })

    const { requireDesktopAccountAccess } = await import('../../web/lib/desktop/request-auth.ts')
    const result = await requireDesktopAccountAccess(new Request('http://localhost/api/desktop/me'))

    expect(result.accountId).toBeNull()
    expect(result.error).toBeInstanceOf(Response)
    expect(result.transport).toBe('web')
    expect(result.error?.status).toBe(403)
    await expect(result.error?.json()).resolves.toEqual({
      error: 'Only human accounts can access desktop profile routes',
    })
  })
})
