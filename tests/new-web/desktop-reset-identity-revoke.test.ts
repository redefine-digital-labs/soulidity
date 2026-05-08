import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())

const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetActiveGrantSlotForGrantee = vi.hoisted(() => vi.fn())

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
  soulAsset: {
    findMany: vi.fn(),
  },
  soulGrantRecord: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
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
  // Default: stale-row self-heal is a no-op; tests that drive a stale
  // row through validation override per-call.
  mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 0 })
  // Default: caller owns no Souls, so the on-chain re-check inside
  // `findActiveAssetGrantsForPet` is a no-op. Tests that exercise the
  // on-chain branch override this with their own resolved value.
  mockedPrisma.soulAsset.findMany.mockResolvedValue([])
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

// Stub the Sui RPC helpers used by the authoritative on-chain re-check so
// tests never hit the network. Both default to "no grants on chain"; the
// dedicated re-check tests override per-call.
vi.mock('@soulidity/sdk', async () => {
  const actual = await vi.importActual<typeof import('@soulidity/sdk')>('@soulidity/sdk')
  return {
    ...actual,
    getSoulStateObject: mockedGetSoulStateObject,
    getActiveGrantSlotForGrantee: mockedGetActiveGrantSlotForGrantee,
    getRequiredSoulidityEnv: vi.fn(() => '0xdeadbeef'),
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
        soul: { stateOnChainId: '0xstate-1' },
      },
    ])
    // Per-row chain validation must confirm the slot is still live for
    // this grantee (R-001): the mirror row is trusted only when the
    // chain agrees.
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-1',
      granteeAddress: PET_IDENTITY.agentAddress,
      scopeMask: 8, // SOUL_GRANT_SCOPE_ASSETS
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })
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

  it('does a FULL teardown when a stale mirror row is self-healed because the chain has no slot (R-001)', async () => {
    // Regression for R-001: when `grant::revoke` lands on chain but the
    // post-TX mirror update is lost (browser navigated away,
    // `/api/account/pets/[id]/grant-mirror` failed before
    // `endSoulGrantProjectionFromChain` ran), the local mirror keeps a
    // `status='active'` row even though the chain slot is gone. Without
    // per-row chain validation, every subsequent bearer revoke would
    // see grants.length > 0 and preserve the pet row forever — the
    // user has no way to converge because re-signing revoke aborts
    // with `EGrantNotFound`. The blocker now self-heals the stale row
    // and the route proceeds with a clean full delete.
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'human-member-1' })
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([
      {
        onChainId: '0xgrant-stale',
        soulOnChainId: '0xsoul-stale',
        expiresAt: null,
        soul: { stateOnChainId: '0xstate-stale' },
      },
    ])
    // Mirror validation: chain has zero active slots for this Soul.
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 0,
      activeGrants: [],
      activeGrantsTableId: null,
      ownershipEpoch: 2, // ownership epoch advanced — every old grant slot is dead
    })
    mockedPrisma.soulGrantRecord.updateMany.mockResolvedValueOnce({ count: 1 })
    // Post-validation chain-only fallback: enumerate owned Souls and
    // re-confirm there are no live grants.
    mockedPrisma.soulAsset.findMany.mockResolvedValueOnce([])
    mockedPrisma.desktopPet.delete.mockResolvedValue({ id: PET_IDENTITY.id })
    mockedPrisma.member.update.mockResolvedValue({ id: PET_IDENTITY.agentMemberId })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    // Full teardown — no partial flag.
    expect(body).toEqual({ ok: true })
    // Stale row got self-healed so future calls converge.
    expect(mockedPrisma.soulGrantRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onChainId: { in: ['0xgrant-stale'] } },
        data: expect.objectContaining({ status: 'invalidated' }),
      }),
    )
    expect(mockedPrisma.desktopPet.delete).toHaveBeenCalledWith({
      where: { id: PET_IDENTITY.id, accountId: PET_IDENTITY.accountId },
    })
  })

  it('does a PARTIAL teardown when the mirror is empty but the chain still has an active asset-scope grant', async () => {
    // Regression for R-001: the pet authorize flow signs
    // `grant::issue_to_grantee` first and only mirrors the result via
    // `/api/account/pets/[id]/grant-mirror` afterward. If that mirror
    // POST fails (or the grant was issued from outside this UI), the
    // bearer-revoke blocker would otherwise see an empty mirror and
    // tear the pet row down — leaving the live on-chain grant with no
    // convergent revoke surface. The blocker therefore falls through to
    // an authoritative on-chain re-check, which this test seeds.
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'human-member-1' })
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([])
    mockedPrisma.soulAsset.findMany.mockResolvedValueOnce([
      { onChainId: '0xsoul-onchain', stateOnChainId: '0xstate-onchain' },
    ])
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-onchain',
      granteeAddress: PET_IDENTITY.agentAddress,
      scopeMask: 8, // SOUL_GRANT_SCOPE_ASSETS
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })
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
      grantOnChainId: '0xgrant-onchain',
      soulOnChainId: '0xsoul-onchain',
    })
    // Critical: the on-chain re-check must keep the pet row alive even
    // when the mirror was empty.
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
  })

  it('does a PARTIAL teardown when the on-chain re-check is incomplete due to owner-soul overflow (R-001)', async () => {
    // Regression for R-001: when the caller owns more Souls than the
    // per-call cap, the on-chain re-check can no longer prove there
    // are no active grants. The bearer revoke route must fail closed —
    // preserve the pet row so /account/pets keeps a revoke surface for
    // any grant we couldn't see, and clear desktop credentials so the
    // local `dtk_*`/`sk-*` stop working immediately.
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'human-member-1' })
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([])
    const overflowingOwnedSouls = Array.from({ length: 201 }, (_, i) => ({
      onChainId: `0xsoul-${i}`,
      stateOnChainId: `0xstate-${i}`,
    }))
    mockedPrisma.soulAsset.findMany.mockResolvedValueOnce(overflowingOwnedSouls)
    mockedGetSoulStateObject.mockResolvedValue({
      activeGrantCount: 0,
      activeGrants: [],
      activeGrantsTableId: null,
      ownershipEpoch: 1,
    })
    mockedPrisma.desktopPet.update.mockResolvedValue({ id: PET_IDENTITY.id })
    mockedPrisma.member.update.mockResolvedValue({ id: PET_IDENTITY.agentMemberId })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.partial).toBe(true)
    expect(body.reason).toBe('on-chain-recheck-incomplete')
    expect(body.incompleteReason).toBe('owner-soul-overflow')
    expect(body.activeAssetGrants).toEqual([])
    // Critical: row preserved, credentials cleared.
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith({
      where: { id: PET_IDENTITY.id, accountId: PET_IDENTITY.accountId },
      data: {
        desktopAccessTokenHash: null,
        desktopAccessTokenIssuedAt: null,
      },
    })
  })

  it('does a PARTIAL teardown when an on-chain SoulState read fails transiently (R-001)', async () => {
    // Same fail-closed contract: a transient RPC failure on a single
    // owned Soul means we can't prove that Soul has no active grant
    // for the grantee. The bearer revoke must preserve the pet row.
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'human-member-1' })
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([])
    mockedPrisma.soulAsset.findMany.mockResolvedValueOnce([
      { onChainId: '0xsoul-1', stateOnChainId: '0xstate-1' },
    ])
    mockedGetSoulStateObject.mockRejectedValueOnce(new Error('RPC timeout'))
    mockedPrisma.desktopPet.update.mockResolvedValue({ id: PET_IDENTITY.id })
    mockedPrisma.member.update.mockResolvedValue({ id: PET_IDENTITY.agentMemberId })

    const { POST } = await import('../../web/app/api/desktop/me/revoke/route')
    const response = await POST(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.partial).toBe(true)
    expect(body.reason).toBe('on-chain-recheck-incomplete')
    expect(body.incompleteReason).toBe('rpc-error')
    expect(mockedPrisma.desktopPet.delete).not.toHaveBeenCalled()
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
