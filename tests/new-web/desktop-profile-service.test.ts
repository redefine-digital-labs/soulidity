import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

const mockedFindDesktopPersonaManifestBySource = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@/lib/desktop/repository', () => ({
  findDesktopPersonaManifestBySource: mockedFindDesktopPersonaManifestBySource,
}))

describe('getDesktopMe', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns profile with null activePersona when no source set', async () => {
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: null,
      activeSourceRef: null,
      preferences: null,
      lastSyncedAt: null,
      updatedAt: new Date('2026-04-10'),
    })

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe('account-123')

    expect(result.profile.accountId).toBe('account-123')
    expect(result.activePersona).toBeNull()
  })

  it('falls back to upsert when profile does not exist', async () => {
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: null,
      activeSourceRef: null,
      preferences: null,
      lastSyncedAt: null,
      updatedAt: new Date('2026-04-10'),
    })

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe('account-123')

    expect(mockedPrisma.desktopProfile.findUnique).toHaveBeenCalledOnce()
    expect(mockedPrisma.desktopProfile.upsert).toHaveBeenCalledOnce()
    expect(result.profile.accountId).toBe('account-123')
    expect(result.activePersona).toBeNull()
  })

  it('returns activePersona when source is set', async () => {
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: 'starter',
      activeSourceRef: 'aurora',
      preferences: null,
      lastSyncedAt: null,
      updatedAt: new Date('2026-04-10'),
    })

    const manifest = {
      id: 'entry-1',
      sourceType: 'starter',
      sourceRef: 'aurora',
      title: 'Aurora',
      description: null,
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc',
      files: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    }
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue(manifest)

    const { getDesktopMe } = await import('../../web/lib/desktop/profile')
    const result = await getDesktopMe('account-123')

    expect(result.activePersona).toMatchObject({ title: 'Aurora' })
  })
})
