import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())

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

function makePet(overrides: Partial<{ accountId: string; agentAddress: string }> = {}) {
  return {
    id: PET_ID,
    accountId: overrides.accountId ?? ACCOUNT_ID,
    agentAddress: overrides.agentAddress ?? AGENT_ADDRESS,
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
})
