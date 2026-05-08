import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  desktopPet: {
    delete: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  member: {
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  soulGrantRecord: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

function resetMocks() {
  vi.resetAllMocks()
  mockedPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => fn(mockedPrisma),
  )
  // Default: no active asset-scope grants. Tests targeting the partial
  // teardown branch override this with their own resolved value.
  mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])
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

  it('does a PARTIAL teardown when active asset-scope grants exist on-chain — keeps the pet row visible for owner-side cleanup', async () => {
    // Active grants survive a row delete; the revoke route must keep the
    // DesktopPet row alive so /account/pets can target it for revoke.
    // The route resolves the account's human member id first and only
    // counts grants on Souls owned by that human as blockers (so a grant
    // issued by a different owner's Soul to this pet's address does not
    // strand the pet row — see findActiveAssetGrantsForPet).
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'human-member-1' })
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      {
        onChainId: '0xgrant-1',
        soulOnChainId: '0xsoul-1',
        expiresAt: null,
      },
    ])
    mockedPrisma.desktopPet.update.mockResolvedValue({ id: PET_IDENTITY.id })
    mockedPrisma.member.update.mockResolvedValue({ id: PET_IDENTITY.agentMemberId })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.partial).toBe(true)
    expect(body.reason).toBe('active-asset-grants-remain')
    expect(body.activeAssetGrants).toHaveLength(1)
    expect(body.activeAssetGrants[0]).toMatchObject({
      grantOnChainId: '0xgrant-1',
      soulOnChainId: '0xsoul-1',
    })

    // Critical: no full delete. The pet row is preserved so the owner can
    // target the lingering on-chain grants from /account/pets.
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
    // Credentials cleared so the local dtk_ + sk- both stop working.
    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith({
      where: { id: PET_IDENTITY.id, accountId: PET_IDENTITY.accountId },
      data: {
        desktopAccessTokenHash: null,
        desktopAccessTokenIssuedAt: null,
      },
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

  it('passes allowExpiredDesktopToken: true through to requireDesktopIdentity (so a 90-day-stale dtk_ still revokes a still-existing pet)', async () => {
    // Regression for R-001: without this flag, a `dtk_*` whose
    // `desktopAccessTokenIssuedAt` is past the 90-day rotation window
    // would be rejected at requireDesktopIdentity even when the
    // underlying DesktopPet row still exists, returning 401. The desktop
    // reset helper would then misclassify that 401 as "pet already gone"
    // and erase its keypair while leaving an active pet/member/api-key
    // behind on the server.
    mockedPrisma.desktopPet.delete.mockResolvedValue({ id: PET_IDENTITY.id })
    mockedPrisma.member.update.mockResolvedValue({ id: PET_IDENTITY.agentMemberId })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    await POST(buildRequest())

    expect(mockedRequireDesktopIdentity).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        mutation: true,
        allowExpiredDesktopToken: true,
      }),
    )
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
