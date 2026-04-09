import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetDesktopMe = vi.hoisted(() => vi.fn())
const mockedSetDesktopActivePersona = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@/lib/desktop/profile', () => {
  class MockedDesktopActivePersonaNotFoundError extends Error {
    constructor(message = 'Desktop active persona was not found') {
      super(message)
      this.name = 'DesktopActivePersonaNotFoundError'
    }
  }

  return {
    DesktopActivePersonaNotFoundError: MockedDesktopActivePersonaNotFoundError,
    getDesktopMe: mockedGetDesktopMe,
    setDesktopActivePersona: mockedSetDesktopActivePersona,
  }
})

describe('desktop me routes', () => {
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

  it('returns the signed-in desktop profile and active persona', async () => {
    mockedGetDesktopMe.mockResolvedValue({
      profile: {
        accountId: 'account-123',
        activeSourceType: 'starter',
        activeSourceRef: 'starter-aurora',
        preferences: { dock: 'compact' },
        lastSyncedAt: '2026-04-10T08:00:00.000Z',
        updatedAt: '2026-04-10T08:01:00.000Z',
      },
      activePersona: {
        id: 'catalog-starter',
        sourceType: 'starter',
        sourceRef: 'starter-aurora',
        title: 'Aurora Starter',
        description: 'Starter persona for desktop bootstrap.',
        coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
        thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
        version: '1.0.0',
        checksum: 'sha256-aurora-v1',
        files: [],
        updatedAt: '2026-04-10T08:00:00.000Z',
      },
    })

    const { GET } = await import('../../web/app/api/desktop/me/route.ts')
    const response = await GET(new Request('http://localhost/api/desktop/me'))

    expect(response.status).toBe(200)
    expect(mockedGetDesktopMe).toHaveBeenCalledWith('account-123')
    await expect(response.json()).resolves.toEqual({
      profile: {
        accountId: 'account-123',
        activeSourceType: 'starter',
        activeSourceRef: 'starter-aurora',
        preferences: { dock: 'compact' },
        lastSyncedAt: '2026-04-10T08:00:00.000Z',
        updatedAt: '2026-04-10T08:01:00.000Z',
      },
      activePersona: {
        id: 'catalog-starter',
        sourceType: 'starter',
        sourceRef: 'starter-aurora',
        title: 'Aurora Starter',
        description: 'Starter persona for desktop bootstrap.',
        coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
        thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
        version: '1.0.0',
        checksum: 'sha256-aurora-v1',
        files: [],
        updatedAt: '2026-04-10T08:00:00.000Z',
      },
    })
  })

  it('rejects anonymous desktop profile reads', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: '请先登录' }), { status: 401 }),
      identity: null,
    })

    const { GET } = await import('../../web/app/api/desktop/me/route.ts')
    const response = await GET(new Request('http://localhost/api/desktop/me'))

    expect(response.status).toBe(401)
    expect(mockedGetDesktopMe).not.toHaveBeenCalled()
  })

  it('updates the signed-in active persona', async () => {
    mockedSetDesktopActivePersona.mockResolvedValue({
      profile: {
        accountId: 'account-123',
        activeSourceType: 'soul',
        activeSourceRef: '0xsoul-curated',
        preferences: null,
        lastSyncedAt: '2026-04-10T09:30:00.000Z',
        updatedAt: '2026-04-10T09:31:00.000Z',
      },
      activePersona: {
        id: 'catalog-soul',
        sourceType: 'soul',
        sourceRef: '0xsoul-curated',
        title: 'Aurora Curated Soul',
        description: 'Curated soul for desktop sync.',
        coverImage: 'https://cdn.example.com/souls/aurora/cover.png',
        thumbnail: 'https://cdn.example.com/souls/aurora/thumb.png',
        version: '2026-04-10T09:00:00.000Z',
        checksum: 'walrus:blob-aurora',
        files: [],
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
    })

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route.ts')
    const response = await PUT(new Request('http://localhost/api/desktop/me/active-persona', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'soul',
        sourceRef: '0xsoul-curated',
      }),
    }))

    expect(response.status).toBe(200)
    expect(mockedSetDesktopActivePersona).toHaveBeenCalledWith('account-123', {
      sourceType: 'soul',
      sourceRef: '0xsoul-curated',
    })
  })

  it('rejects non-human active persona updates', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: {
        accountId: 'account-123',
        memberId: 'member-123',
        kind: 'agent',
      },
    })

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route.ts')
    const response = await PUT(new Request('http://localhost/api/desktop/me/active-persona', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'starter',
        sourceRef: 'starter-aurora',
      }),
    }))

    expect(response.status).toBe(403)
    expect(mockedSetDesktopActivePersona).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Only human accounts can sync a desktop active persona',
    })
  })

  it('validates sourceType/sourceRef pairs for active persona updates', async () => {
    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route.ts')
    const response = await PUT(new Request('http://localhost/api/desktop/me/active-persona', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'starter',
      }),
    }))

    expect(response.status).toBe(400)
    expect(mockedSetDesktopActivePersona).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'sourceType and sourceRef must both be provided',
    })
  })

  it('returns 404 when the requested active persona is not in the desktop catalog', async () => {
    const { DesktopActivePersonaNotFoundError } = await import('@/lib/desktop/profile')
    mockedSetDesktopActivePersona.mockRejectedValueOnce(
      new DesktopActivePersonaNotFoundError('Desktop active persona was not found'),
    )

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route.ts')
    const response = await PUT(new Request('http://localhost/api/desktop/me/active-persona', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'starter',
        sourceRef: 'missing-starter',
      }),
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Desktop active persona was not found',
    })
  })
})
