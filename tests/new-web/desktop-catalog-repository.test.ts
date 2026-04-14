import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopCatalogEntry: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  starterPersonaAsset: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  soulAsset: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/services/walrus', () => ({
  materializeWalrusBlobUrls: (urls: string[]) => urls.map((u) => `https://walrus.test/${u}`),
  getBlobUrl: (id: string) => `https://walrus.test/blob/${id}`,
}))

describe('listDesktopCatalogItems', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns empty items when no entries exist', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([])
    mockedPrisma.desktopCatalogEntry.count.mockResolvedValue(0)

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns starter catalog items with correct shape', async () => {
    const entry = {
      id: 'entry-1',
      sourceType: 'starter',
      sourceRef: 'aurora',
      sortOrder: 0,
      updatedAt: new Date('2026-04-10'),
    }
    const starter = {
      slug: 'aurora',
      title: 'Aurora',
      description: 'A starter persona',
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc123',
      files: [],
      updatedAt: new Date('2026-04-10'),
    }

    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([entry])
    mockedPrisma.desktopCatalogEntry.count.mockResolvedValue(1)
    mockedPrisma.starterPersonaAsset.findMany.mockResolvedValue([starter])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'entry-1',
      sourceType: 'starter',
      title: 'Aurora',
    })
    expect(result.total).toBe(1)
  })
})

describe('findDesktopPersonaManifestById', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns null when entry does not exist', async () => {
    mockedPrisma.desktopCatalogEntry.findFirst.mockResolvedValue(null)

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    const result = await findDesktopPersonaManifestById('nonexistent')

    expect(result).toBeNull()
  })

  it('returns starter manifest with files', async () => {
    const entry = { id: 'entry-1', sourceType: 'starter', sourceRef: 'aurora' }
    const starter = {
      slug: 'aurora',
      title: 'Aurora',
      description: 'desc',
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc',
      files: [{ path: 'sprite.png', url: 'https://cdn.test/sprite.png', checksum: 'hash' }],
      updatedAt: new Date('2026-04-10'),
    }

    mockedPrisma.desktopCatalogEntry.findFirst.mockResolvedValue(entry)
    mockedPrisma.starterPersonaAsset.findUnique.mockResolvedValue(starter)

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    const result = await findDesktopPersonaManifestById('entry-1')

    expect(result).toMatchObject({
      id: 'entry-1',
      sourceType: 'starter',
      title: 'Aurora',
      version: '1.0',
      files: [{ path: 'sprite.png' }],
    })
  })

  it('filters by isPublished and isHidden', async () => {
    mockedPrisma.desktopCatalogEntry.findFirst.mockResolvedValue(null)

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    await findDesktopPersonaManifestById('hidden-entry')

    expect(mockedPrisma.desktopCatalogEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPublished: true,
          isHidden: false,
        }),
      }),
    )
  })
})
