import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedFindDesktopPersonaManifestBySource = vi.hoisted(() => vi.fn())
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    desktopProfile: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/desktop/repository', () => ({
  findDesktopPersonaManifestBySource: mockedFindDesktopPersonaManifestBySource,
}))

import {
  DesktopActivePersonaNotFoundError,
  getDesktopMe,
  setDesktopActivePersona,
} from '../../web/lib/desktop/profile'

describe('getDesktopMe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an account-scoped desktop profile and resolves the current active persona manifest', async () => {
    mockPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: 'starter',
      activeSourceRef: 'starter-aurora',
      preferences: { dock: 'compact' },
      lastSyncedAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T08:01:00.000Z'),
    })
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue({
      id: 'catalog-starter',
      sourceType: 'starter',
      sourceRef: 'starter-aurora',
      title: 'Aurora Starter',
      description: 'Starter persona for desktop bootstrap.',
      coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
      thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
      version: '1.0.0',
      checksum: 'sha256-aurora-v1',
      files: [],
      updatedAt: '2026-04-10T08:00:00.000Z',
    })

    const result = await getDesktopMe('account-123')

    expect(mockPrisma.desktopProfile.upsert).toHaveBeenCalledWith({
      where: { accountId: 'account-123' },
      create: {
        accountId: 'account-123',
      },
      update: {},
      select: {
        accountId: true,
        activeSourceType: true,
        activeSourceRef: true,
        preferences: true,
        lastSyncedAt: true,
        updatedAt: true,
      },
    })
    expect(mockedFindDesktopPersonaManifestBySource).toHaveBeenCalledWith({
      sourceType: 'starter',
      sourceRef: 'starter-aurora',
    })
    expect(result).toEqual({
      profile: {
        accountId: 'account-123',
        activeSourceType: 'starter',
        activeSourceRef: 'starter-aurora',
        preferences: { dock: 'compact' },
        lastSyncedAt: '2026-04-10T08:00:00.000Z',
        updatedAt: '2026-04-10T08:01:00.000Z',
      },
      activePersona: {
        id: 'catalog-starter',
        sourceType: 'starter',
        sourceRef: 'starter-aurora',
        title: 'Aurora Starter',
        description: 'Starter persona for desktop bootstrap.',
        coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
        thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
        version: '1.0.0',
        checksum: 'sha256-aurora-v1',
        files: [],
        updatedAt: '2026-04-10T08:00:00.000Z',
      },
    })
  })
})

describe('setDesktopActivePersona', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('syncs the account-level active persona without storing local installation details', async () => {
    const now = new Date('2026-04-10T09:30:00.000Z')

    mockedFindDesktopPersonaManifestBySource.mockResolvedValue({
      id: 'catalog-soul',
      sourceType: 'soul',
      sourceRef: '0xsoul-curated',
      title: 'Aurora Curated Soul',
      description: 'Curated soul for desktop sync.',
      coverImage: 'https://cdn.example.com/souls/aurora/cover.png',
      thumbnail: 'https://cdn.example.com/souls/aurora/thumb.png',
      version: '2026-04-10T09:00:00.000Z',
      checksum: 'walrus:blob-aurora',
      files: [],
      updatedAt: '2026-04-10T09:00:00.000Z',
    })
    mockPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
      activeSourceType: 'soul',
      activeSourceRef: '0xsoul-curated',
      preferences: { dock: 'compact' },
      lastSyncedAt: now,
      updatedAt: new Date('2026-04-10T09:31:00.000Z'),
    })

    const result = await setDesktopActivePersona('account-123', {
      sourceType: 'soul',
      sourceRef: '0xsoul-curated',
      now,
    })

    expect(mockedFindDesktopPersonaManifestBySource).toHaveBeenCalledWith({
      sourceType: 'soul',
      sourceRef: '0xsoul-curated',
    })
    expect(mockPrisma.desktopProfile.upsert).toHaveBeenCalledWith({
      where: { accountId: 'account-123' },
      create: {
        accountId: 'account-123',
        activeSourceType: 'soul',
        activeSourceRef: '0xsoul-curated',
        lastSyncedAt: now,
      },
      update: {
        activeSourceType: 'soul',
        activeSourceRef: '0xsoul-curated',
        lastSyncedAt: now,
      },
      select: {
        accountId: true,
        activeSourceType: true,
        activeSourceRef: true,
        preferences: true,
        lastSyncedAt: true,
        updatedAt: true,
      },
    })
    expect(result).toEqual({
      profile: {
        accountId: 'account-123',
        activeSourceType: 'soul',
        activeSourceRef: '0xsoul-curated',
        preferences: { dock: 'compact' },
        lastSyncedAt: '2026-04-10T09:30:00.000Z',
        updatedAt: '2026-04-10T09:31:00.000Z',
      },
      activePersona: {
        id: 'catalog-soul',
        sourceType: 'soul',
        sourceRef: '0xsoul-curated',
        title: 'Aurora Curated Soul',
        description: 'Curated soul for desktop sync.',
        coverImage: 'https://cdn.example.com/souls/aurora/cover.png',
        thumbnail: 'https://cdn.example.com/souls/aurora/thumb.png',
        version: '2026-04-10T09:00:00.000Z',
        checksum: 'walrus:blob-aurora',
        files: [],
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
    })
  })

  it('throws a typed error when the requested active persona does not exist in the desktop catalog', async () => {
    mockedFindDesktopPersonaManifestBySource.mockResolvedValue(null)

    await expect(
      setDesktopActivePersona('account-123', {
        sourceType: 'starter',
        sourceRef: 'missing-starter',
      }),
    ).rejects.toBeInstanceOf(DesktopActivePersonaNotFoundError)

    expect(mockPrisma.desktopProfile.upsert).not.toHaveBeenCalled()
  })
})
