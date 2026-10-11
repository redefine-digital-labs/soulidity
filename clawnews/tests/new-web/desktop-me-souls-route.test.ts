import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())
const mockedListDesktopCatalogItemsBySourceRefs = vi.hoisted(() => vi.fn())

const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedGetActiveGrantSlotForGrantee = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  soulAsset: { findMany: vi.fn() },
  soulGrantRecord: { findMany: vi.fn() },
}))

function resetMocks() {
  vi.resetAllMocks()
  mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])
  mockedPrisma.soulAsset.findMany.mockResolvedValue([])
  mockedListDesktopCatalogItemsBySourceRefs.mockResolvedValue([])
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
vi.mock('@web/lib/desktop/auth', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/desktop/auth')>('@web/lib/desktop/auth')
  return {
    ...actual,
    requireDesktopIdentity: mockedRequireDesktopIdentity,
  }
})

vi.mock('@/lib/desktop/repository', () => ({
  listDesktopCatalogItemsBySourceRefs: mockedListDesktopCatalogItemsBySourceRefs,
}))
vi.mock('@web/lib/desktop/repository', () => ({
  listDesktopCatalogItemsBySourceRefs: mockedListDesktopCatalogItemsBySourceRefs,
}))

// Stub the Sui RPC helpers used by the on-chain re-check fallback so
// tests never touch the network. Tests that exercise the chain branch
// override per-call; default behaviour is "chain has no grants".
vi.mock('@soulidity/sdk', async () => {
  const actual = await vi.importActual<typeof import('@soulidity/sdk')>('@soulidity/sdk')
  return {
    ...actual,
    getSoulStateObject: mockedGetSoulStateObject,
    getActiveGrantSlotForGrantee: mockedGetActiveGrantSlotForGrantee,
    getRequiredSoulidityEnv: vi.fn(() => '0xdeadbeef'),
  }
})

// ── Fixtures ─────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'account-1'
const HUMAN_MEMBER_ID = '11111111-1111-4111-8111-111111111111'
const PET_AGENT_ADDRESS = '0xagent-1'
const SOUL_ON_CHAIN_ID = '0xsoul-1'
const SOUL_STATE_ID = '0xstate-1'

const PET_IDENTITY = {
  id: 'pet-abc',
  accountId: ACCOUNT_ID,
  agentAddress: PET_AGENT_ADDRESS,
  agentMemberId: 'member-agent-1',
}

function buildOwnedItem() {
  return {
    id: `soul:${SOUL_ON_CHAIN_ID}`,
    sourceType: 'soul' as const,
    sourceRef: SOUL_ON_CHAIN_ID,
    title: 'Owned protected Soul',
    description: 'desc',
    coverImage: 'cover.png',
    thumbnail: 'thumb.png',
    listingStatus: 'held' as const,
    listedPriceAtomic: null,
    spriteDownloadPolicy: 'owner_only' as const,
    activeSpriteName: 'persona-sprite',
    activeSpriteVersionIndex: 1,
    activeSpriteDownloadPolicy: 'owner_only' as const,
    updatedAt: '2026-05-08T00:00:00Z',
  }
}

function buildRequest(): Request {
  return new Request('http://localhost/api/desktop/me/souls')
}

describe('GET /api/desktop/me/souls', () => {
  beforeEach(resetMocks)

  it('marks a Soul granted when the SoulGrantRecord mirror has an active asset-scope row', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      desktopPet: PET_IDENTITY,
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([{ onChainId: SOUL_ON_CHAIN_ID }])
    mockedListDesktopCatalogItemsBySourceRefs.mockResolvedValue([buildOwnedItem()])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      {
        onChainId: '0xgrant-mirror',
        soulOnChainId: SOUL_ON_CHAIN_ID,
        expiresAt: null,
        updatedAt: new Date('2026-05-08T00:00:00Z'),
      },
    ])

    const { GET } = await import('../../web/app/api/desktop/me/souls/route')
    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.souls).toHaveLength(1)
    expect(body.souls[0].agentSpriteGrant).toEqual({
      active: true,
      grantOnChainId: '0xgrant-mirror',
      expiresAt: null,
    })
    // Mirror was non-empty — the on-chain helper must NOT run.
    expect(mockedGetSoulStateObject).not.toHaveBeenCalled()
    expect(mockedGetActiveGrantSlotForGrantee).not.toHaveBeenCalled()
  })

  it('falls back to the chain when SoulGrantRecord mirror is empty but the chain has an active asset-scope grant (R-001)', async () => {
    // Regression for R-001: the desktop Library Download button is
    // gated by `agentSpriteGrant?.active`. If the wallet
    // `grant::issue_to_grantee` TX lands on chain but the subsequent
    // mirror POST (`/api/account/pets/[id]/grant-mirror`) fails, the
    // mirror has zero rows for this pet even though the manifest route
    // (`/api/desktop/catalog/[id]`) would authorize the download via
    // `resolveContentAccessPayload`. The renderer must therefore see
    // the same authoritative chain truth that the unlink/revoke
    // surfaces (`findActiveAssetGrantsForPet`) already use.
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      desktopPet: PET_IDENTITY,
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })

    mockedPrisma.soulAsset.findMany.mockImplementation(async (args: {
      where?: Record<string, unknown>
      select?: Record<string, unknown>
      take?: number
    }) => {
      // (1) Initial owned-Souls lookup in the route.
      if (args.select && 'onChainId' in args.select && !('stateOnChainId' in args.select)) {
        return [{ onChainId: SOUL_ON_CHAIN_ID }]
      }
      // (2) Owned-Souls enumeration inside `findActiveAssetGrantsForPetOnChain`
      // — `take: MAX_ONCHAIN_RECHECK_SOULS + 1 = 201` and a slim
      // `{ onChainId, stateOnChainId }` select.
      if (args.take === 201 && args.select && 'stateOnChainId' in args.select) {
        return [{ onChainId: SOUL_ON_CHAIN_ID, stateOnChainId: SOUL_STATE_ID }]
      }
      return []
    })
    mockedListDesktopCatalogItemsBySourceRefs.mockResolvedValue([buildOwnedItem()])
    // Mirror is empty — exactly the failure mode this fallback exists for.
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])

    mockedGetSoulStateObject.mockResolvedValueOnce({
      activeGrantCount: 1,
      activeGrants: [],
      activeGrantsTableId: '0xtable',
      ownershipEpoch: 1,
    })
    mockedGetActiveGrantSlotForGrantee.mockResolvedValueOnce({
      grantId: '0xgrant-onchain',
      granteeAddress: PET_AGENT_ADDRESS,
      scopeMask: 8, // SOUL_GRANT_SCOPE_ASSETS
      scopes: ['assets'],
      expiresAtMs: null,
      ownershipEpochSnapshot: 1,
    })

    const { GET } = await import('../../web/app/api/desktop/me/souls/route')
    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.souls).toHaveLength(1)
    // The chain-only grant must surface via `agentSpriteGrant` so the
    // renderer enables the protected Download button instead of
    // rendering "Authorize on web".
    expect(body.souls[0].agentSpriteGrant).toEqual({
      active: true,
      grantOnChainId: '0xgrant-onchain',
      expiresAt: null,
    })
    expect(mockedGetSoulStateObject).toHaveBeenCalledTimes(1)
    expect(mockedGetActiveGrantSlotForGrantee).toHaveBeenCalledTimes(1)
  })

  it('skips the chain fallback when the mirror already returned at least one grant (no extra RPC)', async () => {
    // The chain re-check is only there for the mirror-empty edge case;
    // the common path stays a single DB query.
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      desktopPet: PET_IDENTITY,
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([{ onChainId: SOUL_ON_CHAIN_ID }])
    mockedListDesktopCatalogItemsBySourceRefs.mockResolvedValue([buildOwnedItem()])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      {
        onChainId: '0xgrant-mirror',
        soulOnChainId: SOUL_ON_CHAIN_ID,
        expiresAt: null,
        updatedAt: new Date('2026-05-08T00:00:00Z'),
      },
    ])

    const { GET } = await import('../../web/app/api/desktop/me/souls/route')
    await GET(buildRequest())

    expect(mockedGetSoulStateObject).not.toHaveBeenCalled()
    expect(mockedGetActiveGrantSlotForGrantee).not.toHaveBeenCalled()
  })

  it('returns souls without the agentSpriteGrant marker for cookie callers (no desktopPet identity)', async () => {
    // Browser cookie callers are routed to /account/pets etc.; this
    // route only computes the agent grant marker when the auth carries
    // a desktopPet identity.
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: ACCOUNT_ID,
      identity: { kind: 'human', accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID },
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: HUMAN_MEMBER_ID })
    mockedPrisma.soulAsset.findMany.mockResolvedValue([{ onChainId: SOUL_ON_CHAIN_ID }])
    mockedListDesktopCatalogItemsBySourceRefs.mockResolvedValue([buildOwnedItem()])

    const { GET } = await import('../../web/app/api/desktop/me/souls/route')
    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.souls[0].agentSpriteGrant).toBeNull()
    // No grant marker was requested; the mirror query and chain helper
    // must not run.
    expect(mockedPrisma.soulGrantRecord.findMany).not.toHaveBeenCalled()
    expect(mockedGetSoulStateObject).not.toHaveBeenCalled()
  })
})
