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

const ACCOUNT_ID = 'account-123'
const PET_ID = 'pet-123'

function setupAccountAndProfile() {
  mockedPrisma.account.findUnique.mockResolvedValue({
    members: [{ walletBindings: [{ address: '0xprimary999' }] }],
  })
  mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
    accountId: ACCOUNT_ID,
    preferences: null,
    updatedAt: new Date('2026-04-10'),
  })
}

describe('getDesktopMe (T4 — active source on DesktopPet)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns the pet-level active source fields hydrated into the profile shape', async () => {
    setupAccountAndProfile()
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent999',
      activeSourceType: 'starter',
      activeSourceRef: 'aurora',
      lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
    })

    const manifest = {
      id: 'entry-1',
      sourceType: 'starter',
      sourceRef: 'aurora',
      title: 'Aurora',
    }
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue(manifest)

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_ID })

    expect(result.profile.accountId).toBe(ACCOUNT_ID)
    expect(result.profile.agentAddress).toBe('0xagent999')
    expect(result.profile.primarySuiAddress).toBe('0xprimary999')
    expect(result.profile.activeSourceType).toBe('starter')
    expect(result.profile.activeSourceRef).toBe('aurora')
    expect(result.profile.lastSyncedAt).toBe('2026-05-01T00:00:00.000Z')
    expect(result.activePersona).toMatchObject({ title: 'Aurora' })
    expect(mockedFindDesktopPersonaManifestBySource).toHaveBeenCalledWith({
      sourceType: 'starter',
      sourceRef: 'aurora',
    })
  })

  it('returns null active persona when pet has no active source', async () => {
    setupAccountAndProfile()
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent000',
      activeSourceType: null,
      activeSourceRef: null,
      lastSyncedAt: null,
    })

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_ID })

    expect(result.activePersona).toBeNull()
    expect(result.profile.agentAddress).toBe('0xagent000')
    expect(result.profile.activeSourceType).toBeNull()
    expect(result.profile.activeSourceRef).toBeNull()
    expect(result.profile.lastSyncedAt).toBeNull()
    expect(mockedFindDesktopPersonaManifestBySource).not.toHaveBeenCalled()
  })

  it('falls back to creating the DesktopProfile row if missing, while reading pet directly', async () => {
    mockedPrisma.account.findUnique.mockResolvedValue({
      members: [{ walletBindings: [] }],
    })
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopProfile.create.mockResolvedValue({
      accountId: ACCOUNT_ID,
      preferences: null,
      updatedAt: new Date('2026-04-10'),
    })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent111',
      activeSourceType: null,
      activeSourceRef: null,
      lastSyncedAt: null,
    })

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_ID })

    expect(mockedPrisma.desktopProfile.findUnique).toHaveBeenCalledOnce()
    expect(mockedPrisma.desktopProfile.create).toHaveBeenCalledOnce()
    expect(result.profile.primarySuiAddress).toBeNull()
    expect(result.activePersona).toBeNull()
  })

  it('throws DesktopPetNotFoundError when pet does not exist', async () => {
    setupAccountAndProfile()
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)

    const { getDesktopMe, DesktopPetNotFoundError } = await import('../../web/lib/desktop/profile')
    await expect(
      getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_ID }),
    ).rejects.toBeInstanceOf(DesktopPetNotFoundError)
  })

  it('throws DesktopPetNotFoundError when pet belongs to a different account', async () => {
    setupAccountAndProfile()
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID,
      accountId: 'account-other',
      agentAddress: '0xagent999',
      activeSourceType: null,
      activeSourceRef: null,
      lastSyncedAt: null,
    })

    const { getDesktopMe, DesktopPetNotFoundError } = await import('../../web/lib/desktop/profile')
    await expect(
      getDesktopMe({ accountId: ACCOUNT_ID, desktopPetId: PET_ID }),
    ).rejects.toBeInstanceOf(DesktopPetNotFoundError)
  })
})

describe('setDesktopActivePersona (T4 — writes to DesktopPet)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('writes activeSource* + lastSyncedAt to the pet via composite where clause', async () => {
    setupAccountAndProfile()
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue({ id: 'entry-1' })
    mockedPrisma.desktopPet.update.mockResolvedValue({
      id: PET_ID,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent999',
      activeSourceType: 'starter',
      activeSourceRef: 'aurora',
      lastSyncedAt: new Date('2026-05-07T10:00:00.000Z'),
    })

    const { setDesktopActivePersona } = await import('../../web/lib/desktop/profile')
    const fixedNow = new Date('2026-05-07T10:00:00.000Z')
    const result = await setDesktopActivePersona({
      accountId: ACCOUNT_ID,
      desktopPetId: PET_ID,
      sourceType: 'starter',
      sourceRef: 'aurora',
      now: fixedNow,
    })

    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith({
      where: { id: PET_ID, accountId: ACCOUNT_ID },
      data: {
        activeSourceType: 'starter',
        activeSourceRef: 'aurora',
        lastSyncedAt: fixedNow,
      },
      select: expect.any(Object),
    })
    expect(result.profile.activeSourceType).toBe('starter')
    expect(result.profile.activeSourceRef).toBe('aurora')
    expect(result.profile.lastSyncedAt).toBe('2026-05-07T10:00:00.000Z')
  })

  it('clears active source when sourceType + sourceRef are both null', async () => {
    setupAccountAndProfile()
    mockedPrisma.desktopPet.update.mockResolvedValue({
      id: PET_ID,
      accountId: ACCOUNT_ID,
      agentAddress: '0xagent999',
      activeSourceType: null,
      activeSourceRef: null,
      lastSyncedAt: new Date('2026-05-07T10:00:00.000Z'),
    })

    const { setDesktopActivePersona } = await import('../../web/lib/desktop/profile')
    await setDesktopActivePersona({
      accountId: ACCOUNT_ID,
      desktopPetId: PET_ID,
      sourceType: null,
      sourceRef: null,
    })

    expect(mockedFindDesktopPersonaManifestBySource).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith({
      where: { id: PET_ID, accountId: ACCOUNT_ID },
      data: expect.objectContaining({
        activeSourceType: null,
        activeSourceRef: null,
        lastSyncedAt: expect.any(Date),
      }),
      select: expect.any(Object),
    })
  })

  it('throws DesktopActivePersonaNotFoundError when manifest missing', async () => {
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue(null)

    const { setDesktopActivePersona, DesktopActivePersonaNotFoundError } = await import(
      '../../web/lib/desktop/profile'
    )
    await expect(
      setDesktopActivePersona({
        accountId: ACCOUNT_ID,
        desktopPetId: PET_ID,
        sourceType: 'starter',
        sourceRef: 'missing',
      }),
    ).rejects.toBeInstanceOf(DesktopActivePersonaNotFoundError)

    expect(mockedPrisma.desktopPet.update).not.toHaveBeenCalled()
  })

  it('translates Prisma P2025 RecordNotFound into DesktopPetNotFoundError', async () => {
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue({ id: 'entry-1' })
    const recordNotFound = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    mockedPrisma.desktopPet.update.mockRejectedValue(recordNotFound)

    const { setDesktopActivePersona, DesktopPetNotFoundError } = await import(
      '../../web/lib/desktop/profile'
    )
    await expect(
      setDesktopActivePersona({
        accountId: ACCOUNT_ID,
        desktopPetId: PET_ID,
        sourceType: 'starter',
        sourceRef: 'aurora',
      }),
    ).rejects.toBeInstanceOf(DesktopPetNotFoundError)
  })
})
