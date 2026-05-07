import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  desktopPet: {
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  member: {
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

function resetMocks() {
  vi.resetAllMocks()
  mockedPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => fn(mockedPrisma),
  )
}

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

vi.mock('@/lib/desktop/auth', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/desktop/auth')>('@/lib/desktop/auth')
  return {
    ...actual,
    requireDesktopIdentity: mockedRequireDesktopIdentity,
  }
})

const PET_IDENTITY = {
  id: 'pet-abc',
  accountId: 'account-123',
  agentAddress: '0xagent123',
  agentMemberId: 'member-agent-1',
}

function buildRequest(): Request {
  return new Request('http://localhost', { method: 'POST' })
}

describe('POST /api/desktop/me/revoke', () => {
  beforeEach(() => {
    resetMocks()
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: PET_IDENTITY.accountId,
      desktopPet: PET_IDENTITY,
    })
  })

  it('deletes the pet, disables the member, and clears every key + pending field', async () => {
    mockedPrisma.desktopPet.delete.mockResolvedValue({ id: PET_IDENTITY.id })
    mockedPrisma.member.update.mockResolvedValue({ id: PET_IDENTITY.agentMemberId })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })

    expect(mockedPrisma.desktopPet.delete).toHaveBeenCalledWith({
      where: { id: PET_IDENTITY.id, accountId: PET_IDENTITY.accountId },
    })

    expect(mockedPrisma.member.update).toHaveBeenCalledWith({
      where: { id: PET_IDENTITY.agentMemberId },
      data: {
        agentStatus: 'disabled',
        apiKey: null,
        apiKeyHash: null,
        apiKeyRotationId: null,
        pendingApiKeyHash: null,
        pendingApiKeyRotationId: null,
        pendingApiKeyRotationExpiresAt: null,
      },
    })
  })

  it('returns 404 when the pet was already deleted (P2025)', async () => {
    const error = Object.assign(new Error('No record'), { code: 'P2025' })
    mockedPrisma.desktopPet.delete.mockRejectedValue(error)

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(404)
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 403 when desktop pet identity is missing (browser cookie path)', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: PET_IDENTITY.accountId,
      identity: { accountId: PET_IDENTITY.accountId, kind: 'human' },
    })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('Desktop pet identity required')
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
  })

  it('returns 401 when desktop access token is invalid', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      error: Response.json({ error: 'Invalid desktop access token' }, { status: 401 }),
    })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())

    expect(response.status).toBe(401)
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
  })
})

describe('post-revoke effects on token + agent key resolution', () => {
  beforeEach(resetMocks)

  it('verifyDesktopAccessToken returns null because the pet row is gone', async () => {
    // Simulate the pet row being absent after revoke.
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)

    const { verifyDesktopAccessToken } = await import('../../web/lib/desktop/auth')
    const result = await verifyDesktopAccessToken('dtk_deadbeef')

    expect(result).toBeNull()
  })

  it('resolveAgentByApiKey returns null because apiKeyHash is cleared and status is disabled', async () => {
    // After revoke, the member row has apiKeyHash=null and agentStatus='disabled'.
    // findFirst with `apiKeyHash: <hash>, agentStatus: 'active'` therefore returns null.
    mockedPrisma.member.findFirst.mockResolvedValue(null)

    const { resolveAgentByApiKey } = await import('../../web/lib/auth/resolve-agent')
    const result = await resolveAgentByApiKey('sk-deadbeef')

    expect(result).toBeNull()
    expect(mockedPrisma.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentStatus: 'active',
        }),
      }),
    )
  })
})
