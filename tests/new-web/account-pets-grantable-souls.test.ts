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
}))

function resetMocks() {
  vi.resetAllMocks()
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

  it('runs the two split queries (grantable + active) and surfaces both lists', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())

    // First call → grantable list (currently owned + protected sprite + no active grant for this pet)
    // Second call → souls already covered by active asset-scope grant
    let call = 0
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: { where: unknown }) => {
      call += 1
      if (call === 1) {
        // grantable side
        expect(args.where).toMatchObject({
          currentOwnerMemberId: HUMAN_MEMBER_ID,
          activeSpriteDownloadPolicy: { in: ['owner_only', 'allowlist'] },
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
      // active side
      expect(args.where).toMatchObject({
        currentOwnerMemberId: HUMAN_MEMBER_ID,
        grantRecords: {
          some: expect.objectContaining({
            status: 'active',
            granteeAddress: AGENT_ADDRESS,
            scopes: { has: 'assets' },
          }),
        },
      })
      return [{
        onChainId: '0xowned-2',
        stateOnChainId: '0xstate-2',
        name: 'Owned B',
        imageUrl: 'image-b.png',
        previewImages: [],
        grantRecords: [{ onChainId: '0xgrant-1', expiresAt: null }],
      }]
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
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: { where: unknown }) => {
      // The route should only run the active-grant query in this state.
      expect(args.where).toMatchObject({
        currentOwnerMemberId: HUMAN_MEMBER_ID,
        grantRecords: {
          some: expect.objectContaining({
            granteeAddress: AGENT_ADDRESS,
            scopes: { has: 'assets' },
          }),
        },
      })
      return [{
        onChainId: '0xowned-2',
        stateOnChainId: '0xstate-2',
        name: 'Owned B',
        imageUrl: 'image-b.png',
        previewImages: [],
        grantRecords: [{ onChainId: '0xgrant-1', expiresAt: null }],
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
    // Only the active-grant query should have run.
    expect(mockedPrisma.soulAsset.findMany).toHaveBeenCalledTimes(1)
  })

  it('grantable query excludes Souls that already have an active asset-scope grant for this pet', async () => {
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { GET } = await import('../../web/app/api/account/pets/[id]/grantable-souls/route')
    await GET(jsonRequest(), { params: Promise.resolve({ id: PET_ID }) })

    const grantableCall = mockedPrisma.soulAsset.findMany.mock.calls[0]?.[0] as {
      where: {
        grantRecords: {
          none: {
            status: string
            granteeAddress: string
            scopes: { has: string }
          }
        }
      }
    }
    expect(grantableCall.where.grantRecords.none).toMatchObject({
      status: 'active',
      granteeAddress: AGENT_ADDRESS,
      scopes: { has: 'assets' },
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

    // Branch by the `where` shape so this test does not depend on
    // Promise.all evaluation order across the parallel mirror queries.
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
      take?: number
    }) => {
      // (1) grantable mirror query — `activeSpriteDownloadPolicy: { in: [...] }`
      if (args.where?.activeSpriteDownloadPolicy) {
        return []
      }
      // (2) active-grant mirror query — `grantRecords: { some: ... }`
      if ((args.where?.grantRecords as { some?: unknown } | undefined)?.some) {
        return []
      }
      // (3) on-chain helper's owned-Soul enumeration — `take: 200`, slim select.
      if (args.take === 200 && args.select && !args.select.name) {
        return [{ onChainId: '0xsoul-onchain', stateOnChainId: '0xstate-onchain' }]
      }
      // (4) enrichment lookup — `onChainId: { in: [...] }` with display select.
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
    // Sanity-check the call sequence: 2 mirror queries, then the on-chain
    // enumeration, then the enrichment lookup.
    expect(mockedPrisma.soulAsset.findMany).toHaveBeenCalledTimes(4)
    expect(mockedGetActiveGrantSlotForGrantee).toHaveBeenCalledTimes(1)
  })

  it('skips the on-chain fallback entirely when the mirror already returned active grants (no extra RPC)', async () => {
    // Sanity check that the common fast path stays single-DB-call and
    // never reaches `findActiveAssetGrantsForPetOnChain` — the on-chain
    // re-check is only there for the mirror-empty edge case.
    mockedRequireIdentity.mockResolvedValue({ identity: HUMAN_IDENTITY })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(makePet())
    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where: Record<string, unknown>
    }) => {
      if (args.where?.activeSpriteDownloadPolicy) return []
      if ((args.where?.grantRecords as { some?: unknown } | undefined)?.some) {
        return [{
          onChainId: '0xowned-mirror',
          stateOnChainId: '0xstate-mirror',
          name: 'Mirror Soul',
          imageUrl: 'mirror-image.png',
          previewImages: [],
          grantRecords: [{ onChainId: '0xgrant-mirror', expiresAt: null }],
        }]
      }
      throw new Error('Unexpected soulAsset.findMany call when mirror was non-empty')
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
    expect(mockedGetSoulStateObject).not.toHaveBeenCalled()
    expect(mockedGetActiveGrantSlotForGrantee).not.toHaveBeenCalled()
  })
})
