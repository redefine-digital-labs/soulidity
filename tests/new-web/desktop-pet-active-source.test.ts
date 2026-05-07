import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
  },
  desktopProfile: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  desktopPet: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const mockedFindDesktopPersonaManifestBySource = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@/lib/desktop/repository', () => ({
  findDesktopPersonaManifestBySource: mockedFindDesktopPersonaManifestBySource,
}))

// A6 acceptance: per-pet active source isolation. Two pets in the same
// account must not share active-source state, and cross-pet writes must
// be rejected even when accountId matches.
describe('desktop pet active source isolation', () => {
  const ACCOUNT_ID = 'account-shared'
  const PET_1 = 'pet-001'
  const PET_2 = 'pet-002'

  // Simulated DB rows — mutated by `desktopPet.update` so subsequent
  // `findUnique` calls reflect the post-write state.
  const petRows = new Map<string, {
    id: string
    accountId: string
    agentAddress: string
    activeSourceType: string | null
    activeSourceRef: string | null
    lastSyncedAt: Date | null
  }>()

  beforeEach(() => {
    vi.resetAllMocks()
    petRows.clear()
    petRows.set(PET_1, {
      id: PET_1,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent1',
      activeSourceType: null,
      activeSourceRef: null,
      lastSyncedAt: null,
    })
    petRows.set(PET_2, {
      id: PET_2,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent2',
      activeSourceType: null,
      activeSourceRef: null,
      lastSyncedAt: null,
    })

    mockedPrisma.account.findUnique.mockResolvedValue({
      members: [{ walletBindings: [{ address: '0xprimary' }] }],
    })
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
      accountId: ACCOUNT_ID,
      preferences: null,
      updatedAt: new Date('2026-04-10'),
    })

    mockedPrisma.desktopPet.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      const row = petRows.get(args.where.id)
      return row ?? null
    })

    mockedPrisma.desktopPet.update.mockImplementation(
      async (args: {
        where: { id: string; accountId: string }
        data: {
          activeSourceType: string | null
          activeSourceRef: string | null
          lastSyncedAt: Date
        }
      }) => {
        const row = petRows.get(args.where.id)
        if (!row || row.accountId !== args.where.accountId) {
          const err = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
          throw err
        }
        row.activeSourceType = args.data.activeSourceType
        row.activeSourceRef = args.data.activeSourceRef
        row.lastSyncedAt = args.data.lastSyncedAt
        return row
      },
    )

    mockedFindDesktopPersonaManifestBySource.mockImplementation(
      async ({ sourceType, sourceRef }: { sourceType: string; sourceRef: string }) => ({
        id: `${sourceType}:${sourceRef}`,
        sourceType,
        sourceRef,
        title: `${sourceRef}-manifest`,
      }),
    )
  })

  it('writing source A to pet1 does not change pet2 active source', async () => {
    const { setDesktopActivePersona, getDesktopMe } = await import('../../web/lib/desktop/profile')

    await setDesktopActivePersona({
      accountId: ACCOUNT_ID,
      desktopPetId: PET_1,
      sourceType: 'starter',
      sourceRef: 'aurora',
    })

    const pet1Me = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_1 })
    const pet2Me = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_2 })

    expect(pet1Me.profile.activeSourceType).toBe('starter')
    expect(pet1Me.profile.activeSourceRef).toBe('aurora')
    expect(pet2Me.profile.activeSourceType).toBeNull()
    expect(pet2Me.profile.activeSourceRef).toBeNull()
  })

  it('after both pets have sources, getDesktopMe returns the per-pet value', async () => {
    const { setDesktopActivePersona, getDesktopMe } = await import('../../web/lib/desktop/profile')

    await setDesktopActivePersona({
      accountId: ACCOUNT_ID,
      desktopPetId: PET_1,
      sourceType: 'starter',
      sourceRef: 'aurora',
    })
    await setDesktopActivePersona({
      accountId: ACCOUNT_ID,
      desktopPetId: PET_2,
      sourceType: 'starter',
      sourceRef: 'borealis',
    })

    const pet1Me = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_1 })
    const pet2Me = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_2 })

    expect(pet1Me.profile.activeSourceRef).toBe('aurora')
    expect(pet1Me.activePersona).toMatchObject({ sourceRef: 'aurora' })
    expect(pet2Me.profile.activeSourceRef).toBe('borealis')
    expect(pet2Me.activePersona).toMatchObject({ sourceRef: 'borealis' })
  })

  it('cross-pet write attempt with mismatched account throws DesktopPetNotFoundError', async () => {
    const { setDesktopActivePersona, DesktopPetNotFoundError } = await import(
      '../../web/lib/desktop/profile'
    )

    // Try writing to pet1 from a different accountId — Prisma composite
    // where {id, accountId} returns RecordNotFound, which we translate.
    await expect(
      setDesktopActivePersona({
        accountId: 'account-other',
        desktopPetId: PET_1,
        sourceType: 'starter',
        sourceRef: 'aurora',
      }),
    ).rejects.toBeInstanceOf(DesktopPetNotFoundError)

    // Pet1 row is untouched.
    expect(petRows.get(PET_1)?.activeSourceType).toBeNull()
  })
})
