import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())

const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetActiveGrantSlotForGrantee = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  desktopPet: {
    findUnique: vi.fn(),
  },
  soulAsset: {
    findMany: vi.fn(),
  },
  soulGrantRecord: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

function resetMocks() {
  vi.resetAllMocks()
  // Default: empty mirror — tests that exercise the mirror path
  // override per-call.
  mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])
  mockedPrisma.soulGrantRecord.updateMany.mockResolvedValue({ count: 0 })
}

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  requireMutationIdentity: mockedRequireIdentity,
}))
vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  requireMutationIdentity: mockedRequireIdentity,
}))

// Stub the Sui RPC helpers used by `findActiveAssetGrantsForPetOnChain`
// so the route's authoritative fallback never reaches the network in
// tests. Default behaviour is "chain has no active grants"; tests that
// exercise the chain-only branch override these per-call.
vi.mock('@soulidity/sdk', async () => {
  const actual = await vi.importActual<typeof import('@soulidity/sdk')>('@soulidity/sdk')
  return {
    ...actual,
    getSoulStateObject: mockedGetSoulStateObject,
    getActiveGrantSlotForGrantee: mockedGetActiveGrantSlotForGrantee,
    getRequiredSoulidityEnv: vi.fn(() => '0xdeadbeef'),
  }
})

const ACCOUNT_ID = 'account-1'
const OTHER_ACCOUNT_ID = 'account-2'
const PET_ID = '11111111-1111-4111-8111-111111111111'
const HUMAN_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const AGENT_ADDRESS = '0xagent'

const HUMAN_IDENTITY = {
  accountId: ACCOUNT_ID,
  memberId: HUMAN_MEMBER_ID,
  kind: 'human' as const,
}
const AGENT_IDENTITY = {
  accountId: ACCOUNT_ID,
  memberId: 'agent-member',
  kind: 'agent' as const,
}

function makePet(
  overrides: Partial<{
    accountId: string
    agentAddress: string
    desktopAccessTokenHash: string | null
    agentStatus: string | null
  }> = {},
) {
  return {
    id: PET_ID,
    accountId: overrides.accountId ?? ACCOUNT_ID,
    agentAddress: overrides.agentAddress ?? AGENT_ADDRESS,
    desktopAccessTokenHash:
      overrides.desktopAccessTokenHash !== undefined
        ? overrides.desktopAccessTokenHash
        : 'hash-of-dtk',
    agentMember: {
      agentStatus: overrides.agentStatus !== undefined ? overrides.agentStatus : 'active',
    },
  }
}

function jsonRequest() {
  return new Request(`http://localhost/api/account/pets/${PET_ID}/grantable-souls`)
}

describe('GET /api/account/pets/[id]/grantable-souls', () => {
  beforeEach(resetMocks)

  it('returns 401 when no identity is resolved', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    expect(response.status).toBe(401)
    expect(mockedPrisma.desktopPet.findUnique).not.toHaveBeenCalled()
  })

  it('returns 403 for an agent identity', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: AGENT_IDENTITY })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    expect(response.status).toBe(403)
    expect(mockedPrisma.desktopPet.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the pet belongs to a different account (cross-account isolation)', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet({ accountId: OTHER_ACCOUNT_ID }))

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    expect(response.status).toBe(404)
    expect(mockedPrisma.soulAsset.findMany).not.toHaveBeenCalled()
  })

  it('returns 404 when the pet does not exist', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    expect(response.status).toBe(404)
    expect(mockedPrisma.soulAsset.findMany).not.toHaveBeenCalled()
  })

  it('runs the validated active-grant lookup + grantable + enrichment queries and surfaces both lists', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())

    // (a) Mirror has one active asset-scope grant row.
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([
      {
        onChainId: '0xgrant-1',
        soulOnChainId: '0xowned-2',
        expiresAt: null,
        soul: { stateOnChainId: '0xstate-2' },
      },
    ])
    // (b) Per-row chain validation confirms the slot is still live for
    // this grantee (R-001).
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-1',
      granteeAddress: AGENT_ADDRESS,
      scopeMask: 8,
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })

    // (c) Two soulAsset.findMany calls in parallel: grantable list +
    // active-grant Soul metadata enrichment.
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
    }) => {
      // Grantable list query: filtered by `activeSpriteDownloadPolicy`.
      if (args.where.activeSpriteDownloadPolicy) {
        expect(args.where).toMatchObject({
          currentOwnerMemberId: HUMAN_MEMBER_ID,
          activeSpriteDownloadPolicy: { in: ['owner_only', 'allowlist'] },
        })
        // Validated active soul ids must be excluded so the same Soul
        // does not appear in both lists.
        expect(args.where).toMatchObject({
          onChainId: { notIn: ['0xowned-2'] },
        })
        return [{
          onChainId: '0xowned-1',
          stateOnChainId: '0xstate-1',
          name: 'Owned A',
          imageUrl: 'image-a.png',
          previewImages: ['preview-a.png'],
          activeSpriteName: 'persona-sprite',
          activeSpriteVersionIndex: 3,
          activeSpriteDownloadPolicy: 'owner_only',
        }]
      }
      // Enrichment query: by validated active soul ids.
      const inFilter = (args.where.onChainId as { in?: string[] } | undefined)?.in
      if (inFilter) {
        expect(args.where).toMatchObject({
          onChainId: { in: ['0xowned-2'] },
          currentOwnerMemberId: HUMAN_MEMBER_ID,
        })
        return [{
          onChainId: '0xowned-2',
          stateOnChainId: '0xstate-2',
          name: 'Owned B',
          imageUrl: 'image-b.png',
          previewImages: [],
        }]
      }
      return []
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pet).toEqual({ id: PET_ID, agentAddress: AGENT_ADDRESS })
    expect(body.souls).toHaveLength(1)
    expect(body.souls[0]).toMatchObject({
      soulOnChainId: '0xowned-1',
      stateOnChainId: '0xstate-1',
      activeSpriteDownloadPolicy: 'owner_only',
    })
    expect(body.activeAssetGrants).toHaveLength(1)
    expect(body.activeAssetGrants[0]).toMatchObject({
      soulOnChainId: '0xowned-2',
      grantOnChainId: '0xgrant-1',
      expiresAt: null,
    })

    expect(mockedPrisma.soulAsset.findMany).toHaveBeenCalledTimes(2)
    // The mirror row was validated against the chain, not blindly
    // trusted (regression for R-001 stale-row class).
    expect(mockedGetSoulStateObject).toHaveBeenCalledTimes(1)
    expect(mockedGetActiveGrantSlotForGrantee).toHaveBeenCalledTimes(1)
  })

  it('grantable query restricts by currentOwnerMemberId (only Souls owned by the human caller)', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })

    const grantableCall = mockedPrisma.soulAsset.findMany.mock.calls[0]?.[0] as { where: { currentOwnerMemberId?: string } }
    expect(grantableCall.where.currentOwnerMemberId).toBe(HUMAN_MEMBER_ID)
  })

  it('returns no grantable souls but still lists active grants when the pet is in the partial-revoke state', async () => {
    // After `POST /api/desktop/me/revoke` runs the partial path
    // (active grants remain), the row stays alive but the bearer hash
    // is cleared and the agent member is disabled. From this state
    // the user must only be able to revoke — issuing fresh grants
    // would target an agent with no usable credential.
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(
      makePet({ desktopAccessTokenHash: null, agentStatus: 'disabled' }),
    )

    // Mirror has one row; chain validation confirms it.
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([
      {
        onChainId: '0xgrant-1',
        soulOnChainId: '0xowned-2',
        expiresAt: null,
        soul: { stateOnChainId: '0xstate-2' },
      },
    ])
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-1',
      granteeAddress: AGENT_ADDRESS,
      scopeMask: 8,
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })

    // Only the enrichment query should run — the partial-revoke pet
    // skips the grantable-list query entirely.
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
    }) => {
      const inFilter = (args.where.onChainId as { in?: string[] } | undefined)?.in
      expect(inFilter).toEqual(['0xowned-2'])
      expect(args.where).toMatchObject({
        currentOwnerMemberId: HUMAN_MEMBER_ID,
      })
      return [{
        onChainId: '0xowned-2',
        stateOnChainId: '0xstate-2',
        name: 'Owned B',
        imageUrl: 'image-b.png',
        previewImages: [],
      }]
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.souls).toEqual([])
    expect(body.activeAssetGrants).toHaveLength(1)
    expect(body.activeAssetGrants[0]).toMatchObject({
      soulOnChainId: '0xowned-2',
      grantOnChainId: '0xgrant-1',
    })
    // Only the enrichment query should have run for soulAsset.findMany.
    expect(mockedPrisma.soulAsset.findMany).toHaveBeenCalledTimes(1)
  })

  it('grantable query excludes Souls that already have an active asset-scope grant for this pet', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())

    // Validated active grants list contains one Soul; the grantable
    // query must exclude it via `onChainId: { notIn: [...] }` so the
    // same Soul never appears in both lists.
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([
      {
        onChainId: '0xgrant-existing',
        soulOnChainId: '0xowned-existing',
        expiresAt: null,
        soul: { stateOnChainId: '0xstate-existing' },
      },
    ])
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-existing',
      granteeAddress: AGENT_ADDRESS,
      scopeMask: 8,
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })

    const grantableCall = mockedPrisma.soulAsset.findMany.mock.calls.find(
      (call) =>
        (call[0] as { where: Record<string, unknown> }).where.activeSpriteDownloadPolicy != null,
    )
    expect(grantableCall).toBeDefined()
    expect((grantableCall![0] as { where: Record<string, unknown> }).where).toMatchObject({
      currentOwnerMemberId: HUMAN_MEMBER_ID,
      activeSpriteDownloadPolicy: { in: ['owner_only', 'allowlist'] },
      onChainId: { notIn: ['0xowned-existing'] },
    })
  })

  it('falls back to the chain when the SoulGrantRecord mirror is empty but the chain has an active asset-scope grant (R-001)', async () => {
    // Regression for R-001 / F-432: the cookie unlink blocker
    // (`/api/account/pets/[id]`) returns 409 when the
    // `findActiveAssetGrantsForPet` chain re-check finds an active
    // asset-scope grant the mirror missed (mirror POST raced/failed,
    // grant issued from a non-UI surface, etc.). The revoke modal opened
    // by `PetCard` calls THIS route — if it kept reading only the
    // mirror it would surface an empty list and the user would have no
    // signing surface for the very grant blocking unlink. The route
    // therefore must run the same authoritative chain fallback.
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())

    // Branch by the `where` / `take` shape so this test does not depend
    // on Promise.all evaluation order.
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
      take?: number
    }) => {
      // (1) grantable list query.
      if (args.where?.activeSpriteDownloadPolicy) {
        return []
      }
      // (2) on-chain helper's owned-Soul enumeration — `take:
      // MAX_ONCHAIN_RECHECK_SOULS + 1 = 201` (one row past the cap to
      // detect overflow without a separate count round-trip), slim
      // select.
      if (args.take === 201 && args.select && !args.select.name) {
        return [{ onChainId: '0xsoul-onchain', stateOnChainId: '0xstate-onchain' }]
      }
      // (3) enrichment lookup — `onChainId: { in: [...] }` with display select.
      if ((args.where?.onChainId as { in?: string[] } | undefined)?.in) {
        return [{
          onChainId: '0xsoul-onchain',
          stateOnChainId: '0xstate-onchain',
          name: 'Chain-only Soul',
          imageUrl: 'chain-image.png',
          previewImages: ['chain-preview.png'],
        }]
      }
      return []
    })
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-onchain',
      granteeAddress: AGENT_ADDRESS,
      scopeMask: 8, // SOUL_GRANT_SCOPE_ASSETS
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    // The on-chain grant must show up in the revoke modal payload with
    // the same Soul display fields the mirror branch would have surfaced.
    expect(body.activeAssetGrants).toHaveLength(1)
    expect(body.activeAssetGrants[0]).toMatchObject({
      soulOnChainId: '0xsoul-onchain',
      stateOnChainId: '0xstate-onchain',
      name: 'Chain-only Soul',
      previewImage: 'chain-preview.png',
      grantOnChainId: '0xgrant-onchain',
      expiresAt: null,
    })
    expect(mockedGetActiveGrantSlotForGrantee).toHaveBeenCalledTimes(1)
  })

  it('surfaces incompleteRecheck=owner-soul-overflow when the on-chain re-check cannot enumerate every Soul (R-001)', async () => {
    // Regression for R-001: when the chain re-check is incomplete
    // (caller owns more Souls than the per-call cap, or transient
    // RPC failure), the route must surface that to the UI instead of
    // returning an empty active-grants list. Otherwise the PetCard
    // shows "no grants to revoke" while the cookie DELETE blocker
    // (using the same helper) returns 503 — leaving the user with no
    // signing surface and no explanation.
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())

    const overflowingOwnedSouls = Array.from({ length: 201 }, (_, i) => ({
      onChainId: `0xsoul-${i}`,
      stateOnChainId: `0xstate-${i}`,
    }))
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      take?: number
      select?: Record<string, unknown>
    }) => {
      if (args.where?.activeSpriteDownloadPolicy) return []
      // On-chain helper's owned-Soul enumeration — `take: 201`.
      if (args.take === 201 && args.select && !args.select.name) {
        return overflowingOwnedSouls
      }
      return []
    })
    // Every state read returns zero grants — but the helper still
    // signals incomplete because the overflow row was present.
    mockedGetSoulStateObject.mockResolvedValue({
      activeGrantCount: 0,
      activeGrants: [],
      activeGrantsTableId: null,
      ownershipEpoch: 1,
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.activeAssetGrants).toEqual([])
    expect(body.incompleteRecheck).toEqual({ reason: 'owner-soul-overflow' })
  })

  it('surfaces incompleteRecheck=rpc-error when an on-chain SoulState read fails (R-001)', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      take?: number
      select?: Record<string, unknown>
    }) => {
      if (args.where?.activeSpriteDownloadPolicy) return []
      if (args.take === 201 && args.select && !args.select.name) {
        return [{ onChainId: '0xsoul-1', stateOnChainId: '0xstate-1' }]
      }
      return []
    })
    mockedGetSoulStateObject.mockRejectedValueOnce(new Error('RPC timeout'))

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.activeAssetGrants).toEqual([])
    expect(body.incompleteRecheck).toEqual({ reason: 'rpc-error' })
  })

  it('skips the empty-mirror chain enumeration when the mirror+chain already validated active grants (only per-row validation runs)', async () => {
    // R-001 fix: even when the mirror has rows we MUST per-row
    // validate them against the chain so a stale `status='active'`
    // row can't surface as a phantom revokable grant. We do, however,
    // still skip the empty-mirror full owned-Soul enumeration when at
    // least one mirror row validates clean — so `take: 201` enumeration
    // never fires.
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([
      {
        onChainId: '0xgrant-mirror',
        soulOnChainId: '0xowned-mirror',
        expiresAt: null,
        soul: { stateOnChainId: '0xstate-mirror' },
      },
    ])
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-mirror',
      granteeAddress: AGENT_ADDRESS,
      scopeMask: 8,
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
      take?: number
    }) => {
      // Grantable-list query.
      if (args.where?.activeSpriteDownloadPolicy) return []
      // Enrichment lookup for the validated active grant.
      if ((args.where?.onChainId as { in?: string[] } | undefined)?.in) {
        return [{
          onChainId: '0xowned-mirror',
          stateOnChainId: '0xstate-mirror',
          name: 'Mirror Soul',
          imageUrl: 'mirror-image.png',
          previewImages: [],
        }]
      }
      // Empty-mirror chain enumeration MUST NOT fire.
      if (args.take === 201) {
        throw new Error('Empty-mirror chain enumeration should not run when validation surfaces grants')
      }
      throw new Error('Unexpected soulAsset.findMany call shape')
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.activeAssetGrants).toHaveLength(1)
    expect(body.activeAssetGrants[0]).toMatchObject({
      soulOnChainId: '0xowned-mirror',
      grantOnChainId: '0xgrant-mirror',
    })
    // Per-row validation ran exactly once for the single mirror row.
    expect(mockedGetSoulStateObject).toHaveBeenCalledTimes(1)
    expect(mockedGetActiveGrantSlotForGrantee).toHaveBeenCalledTimes(1)
  })

  it('self-heals stale mirror rows whose chain slot is gone, then falls through to the chain-only fallback (R-001)', async () => {
    // Regression for R-001 stale-row class: a `status='active'` row
    // whose on-chain slot is gone (revoke TX landed, mirror POST
    // missed, OR ownership transfer bumped ownership_epoch) used to
    // surface as a phantom revokable grant. The route now validates
    // against the chain, marks the row `invalidated`, and falls
    // through to the empty-mirror chain enumeration so the user
    // genuinely sees an empty active-grants list.
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValueOnce([
      {
        onChainId: '0xgrant-stale',
        soulOnChainId: '0xowned-stale',
        expiresAt: null,
        soul: { stateOnChainId: '0xstate-stale' },
      },
    ])
    // Chain validation: state shows zero active slots.
    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 0,
      activeGrants: [],
      activeGrantsTableId: null,
      ownershipEpoch: 1,
    })
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
      take?: number
    }) => {
      // Grantable-list query: no excluded ids because validation
      // emptied the active list.
      if (args.where?.activeSpriteDownloadPolicy) {
        expect(args.where).not.toHaveProperty('onChainId')
        return []
      }
      // Empty-mirror chain enumeration runs with no owned Souls.
      if (args.take === 201) {
        return []
      }
      return []
    })

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    const response = await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.activeAssetGrants).toEqual([])
    // Self-heal write fired so the next call converges without
    // operator intervention.
    expect(mockedPrisma.soulGrantRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onChainId: { in: ['0xgrant-stale'] } },
        data: expect.objectContaining({ status: 'invalidated' }),
      }),
    )
  })
})
