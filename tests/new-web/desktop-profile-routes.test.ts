import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())
const mockedGetDesktopMe = vi.hoisted(() => vi.fn())
const mockedSetDesktopActivePersona = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/auth', () => ({
  requireDesktopIdentity: mockedRequireDesktopIdentity,
}))

vi.mock('@/lib/desktop/profile', () => {
  class MockedDesktopActivePersonaNotFoundError extends Error {
    constructor(message = 'Desktop active persona was not found') {
      super(message)
      this.name = 'DesktopActivePersonaNotFoundError'
    }
  }

  class MockedDesktopPetNotFoundError extends Error {
    constructor(message = 'Desktop pet not found for this account') {
      super(message)
      this.name = 'DesktopPetNotFoundError'
    }
  }

  return {
    DesktopActivePersonaNotFoundError: MockedDesktopActivePersonaNotFoundError,
    DesktopPetNotFoundError: MockedDesktopPetNotFoundError,
    getDesktopMe: mockedGetDesktopMe,
    setDesktopActivePersona: mockedSetDesktopActivePersona,
  }
})

const PET_IDENTITY = {
  id: 'pet-abc',
  accountId: 'account-123',
  agentAddress: '0xagent123',
  agentMemberId: 'member-agent-1',
}

describe('GET /api/desktop/me', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      desktopPet: PET_IDENTITY,
    })
  })

  it('returns the signed-in desktop profile (with pet identity)', async () => {
    const meResponse = {
      profile: {
        accountId: 'account-123',
        agentAddress: '0xagent123',
        primarySuiAddress: null,
        activeSourceType: null,
        activeSourceRef: null,
        preferences: null,
        lastSyncedAt: null,
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      activePersona: null,
    }
    mockedGetDesktopMe.mockResolvedValue(meResponse)

    const { GET } = await import('../../web/app/api/desktop/me/route')
    const response = await GET(new Request('http://localhost/api/desktop/me'))
    const body = await response.json()

    expect(body.profile.accountId).toBe('account-123')
    expect(body.profile.agentAddress).toBe('0xagent123')
    expect(mockedGetDesktopMe).toHaveBeenCalledWith({
      accountId: 'account-123',
      desktopPetId: PET_IDENTITY.id,
    })
  })

  it('returns 403 when desktop pet identity is missing (browser cookie path)', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      identity: { accountId: 'account-123', kind: 'human' },
    })

    const { GET } = await import('../../web/app/api/desktop/me/route')
    const response = await GET(new Request('http://localhost/api/desktop/me'))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Desktop pet identity required')
    expect(mockedGetDesktopMe).not.toHaveBeenCalled()
  })

  it('returns 404 when DesktopPetNotFoundError is thrown', async () => {
    const { DesktopPetNotFoundError } = await import('../../web/lib/desktop/profile')
    mockedGetDesktopMe.mockRejectedValue(new DesktopPetNotFoundError())

    const { GET } = await import('../../web/app/api/desktop/me/route')
    const response = await GET(new Request('http://localhost/api/desktop/me'))

    expect(response.status).toBe(404)
  })

  it('rejects non-human identities', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      error: Response.json({ error: 'Only human accounts can access desktop endpoints' }, { status: 403 }),
    })

    const { GET } = await import('../../web/app/api/desktop/me/route')
    const response = await GET(new Request('http://localhost/api/desktop/me'))

    expect(response.status).toBe(403)
  })
})

describe('PUT /api/desktop/me/active-persona', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      desktopPet: PET_IDENTITY,
    })
  })

  it('updates active persona using desktopPet id', async () => {
    const meResponse = {
      profile: {
        accountId: 'account-123',
        agentAddress: '0xagent123',
        primarySuiAddress: null,
        activeSourceType: 'starter',
        activeSourceRef: 'aurora',
        preferences: null,
        lastSyncedAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      activePersona: { title: 'Aurora' },
    }
    mockedSetDesktopActivePersona.mockResolvedValue(meResponse)

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'starter', sourceRef: 'aurora' }),
    }))
    const body = await response.json()

    expect(body.profile.activeSourceType).toBe('starter')
    expect(mockedSetDesktopActivePersona).toHaveBeenCalledWith({
      accountId: 'account-123',
      desktopPetId: PET_IDENTITY.id,
      sourceType: 'starter',
      sourceRef: 'aurora',
    })
  })

  it('returns 403 when desktop pet identity is missing (browser cookie path)', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      identity: { accountId: 'account-123', kind: 'human' },
    })

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'starter', sourceRef: 'aurora' }),
    }))

    expect(response.status).toBe(403)
    expect(mockedSetDesktopActivePersona).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid sourceType', async () => {
    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'invalid', sourceRef: 'test' }),
    }))

    expect(response.status).toBe(400)
  })

  it('returns 404 when persona not found', async () => {
    const { DesktopActivePersonaNotFoundError } = await import('../../web/lib/desktop/profile')
    mockedSetDesktopActivePersona.mockRejectedValue(new DesktopActivePersonaNotFoundError())

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'starter', sourceRef: 'nonexistent' }),
    }))

    expect(response.status).toBe(404)
  })

  it('returns 404 when DesktopPetNotFoundError is thrown', async () => {
    const { DesktopPetNotFoundError } = await import('../../web/lib/desktop/profile')
    mockedSetDesktopActivePersona.mockRejectedValue(new DesktopPetNotFoundError())

    const { PUT } = await import('../../web/app/api/desktop/me/active-persona/route')
    const response = await PUT(new Request('http://localhost', {
      method: 'PUT',
      body: JSON.stringify({ sourceType: 'starter', sourceRef: 'aurora' }),
    }))

    expect(response.status).toBe(404)
  })
})
