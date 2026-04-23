import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopCatalogEntry: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
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

const mockedResolveDesktopSpriteManifest = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/services/walrus', () => ({
  materializeWalrusBlobUrls: (urls: string[]) => urls.map((url) => `https://walrus.test/${url}`),
}))
vi.mock('@/lib/services/walrus', () => ({
  materializeWalrusBlobUrls: (urls: string[]) => urls.map((url) => `https://walrus.test/${url}`),
}))
vi.mock('@/lib/desktop/sprite-contract', () => ({
  resolveDesktopSpriteManifest: mockedResolveDesktopSpriteManifest,
}))

function makeSoul(overrides: Record<string, unknown> = {}) {
  return {
    onChainId: '0xsoul-1',
    name: 'Ghost Fox',
    description: 'Listed soul',
    imageUrl: 'cover.png',
    previewImages: ['preview.png'],
    metadataOnChainId: '0xmetadata-1',
    activeSpriteAssetName: 'persona-sprite',
    activeSpriteVersionIndex: 0,
    activeSpriteDownloadPolicy: 'public',
    spriteConfigJson: JSON.stringify({
      frameWidth: 64,
      frameHeight: 64,
      columns: 4,
      animations: {
        idle: { frames: [0, 1], fps: 8, loop: true },
      },
    }),
    spriteMoodMapJson: JSON.stringify({ idle: 'idle' }),
    listingStatus: 'listed',
    listedPriceAtomic: { toString: () => '1250000' },
    updatedAt: new Date('2026-04-20T00:00:00.000Z'),
    assetVersions: [{
      assetName: 'persona-sprite',
      versionIndex: 0,
      visibility: 'public',
      assetType: 'sprite',
      blobId: 'sprite-blob',
      blobObjectId: '0xblob',
    }],
    ...overrides,
  }
}

describe('listDesktopCatalogItems', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedResolveDesktopSpriteManifest.mockResolvedValue({
      downloadPolicy: 'public',
      config: { src: 'persona-sprite.png' },
      publicUrl: 'https://walrus.test/blob/sprite',
    })
  })

  it('returns empty items when no entries exist', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns starter catalog items with listing fields defaulted', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([{
      id: 'entry-1',
      sourceType: 'starter',
      sourceRef: 'aurora',
      sortOrder: 0,
      updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    }])
    mockedPrisma.starterPersonaAsset.findMany.mockResolvedValue([{
      slug: 'aurora',
      title: 'Aurora',
      description: 'A starter persona',
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc123',
      files: [],
      updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    }])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result.items[0]).toMatchObject({
      id: 'entry-1',
      sourceType: 'starter',
      title: 'Aurora',
      listingStatus: null,
      listedPriceAtomic: null,
      spriteDownloadPolicy: 'public',
    })
  })

  it('returns listed souls with price and sprite policy', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([makeSoul()])

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result).toMatchObject({
      total: 1,
      items: [{
        id: 'soul:0xsoul-1',
        sourceType: 'soul',
        sourceRef: '0xsoul-1',
        title: 'Ghost Fox',
        thumbnail: 'https://walrus.test/preview.png',
        listingStatus: 'listed',
        listedPriceAtomic: '1250000',
        spriteDownloadPolicy: 'public',
      }],
    })
    expect(mockedResolveDesktopSpriteManifest).toHaveBeenCalledWith({
      metadataOnChainId: '0xmetadata-1',
      activeSpriteAssetName: 'persona-sprite',
      activeSpriteVersionIndex: 0,
      activeSpriteDownloadPolicy: 'public',
      spriteConfigJson: expect.any(String),
      spriteMoodMapJson: expect.any(String),
      assetVersions: [expect.objectContaining({ versionIndex: 0 })],
    })
  })

  it('filters public marketplace souls to listed entries only', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([{
      id: 'entry-soul',
      sourceType: 'soul',
      sourceRef: '0xsoul-held',
      sortOrder: 0,
      updatedAt: new Date('2026-04-11T00:00:00.000Z'),
    }])
    mockedPrisma.starterPersonaAsset.findMany.mockResolvedValue([])
    mockedPrisma.soulAsset.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeSoul({ onChainId: '0xsoul-listed' })])

    const { listDesktopCatalogItems } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItems({ page: 1, pageSize: 12 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe('soul:0xsoul-listed')
    expect(mockedPrisma.soulAsset.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        onChainId: { in: ['0xsoul-held'] },
        listingStatus: 'listed',
      }),
    }))
  })
})

describe('listDesktopCatalogItemsBySourceRefs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedResolveDesktopSpriteManifest.mockResolvedValue({
      downloadPolicy: 'owner_only',
      config: { src: 'persona-sprite.png' },
    })
  })

  it('returns owned souls even when they are held', async () => {
    mockedPrisma.desktopCatalogEntry.findMany.mockResolvedValue([])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([
      makeSoul({ onChainId: '0xsoul-a', name: 'Soul A', listingStatus: 'held', listedPriceAtomic: null }),
      makeSoul({ onChainId: '0xsoul-b', name: 'Soul B', listingStatus: 'held', listedPriceAtomic: null }),
    ])

    const { listDesktopCatalogItemsBySourceRefs } = await import('../../web/lib/desktop/repository')
    const result = await listDesktopCatalogItemsBySourceRefs({
      sourceType: 'soul',
      sourceRefs: ['0xsoul-b', '0xsoul-a'],
    })

    expect(result.map((item) => item.id)).toEqual(['soul:0xsoul-b', 'soul:0xsoul-a'])
    expect(result.map((item) => item.spriteDownloadPolicy)).toEqual(['owner_only', 'owner_only'])
    expect(result.map((item) => item.listingStatus)).toEqual(['held', 'held'])
  })
})

describe('findDesktopPersonaManifestById', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedResolveDesktopSpriteManifest.mockResolvedValue({
      downloadPolicy: 'public',
      config: { src: 'persona-sprite.png' },
      publicUrl: 'https://walrus.test/blob/sprite',
      fileName: 'persona-sprite.png',
      configFileName: 'persona-sprite-config.json',
      assetName: 'persona-sprite',
      versionIndex: null,
      metadataOnChainId: '0xmetadata-1',
    })
  })

  it('returns starter manifest with files', async () => {
    const entryId = '11111111-1111-4111-8111-111111111111'
    mockedPrisma.desktopCatalogEntry.findFirst.mockResolvedValue({
      id: entryId,
      sourceType: 'starter',
      sourceRef: 'aurora',
    })
    mockedPrisma.starterPersonaAsset.findUnique.mockResolvedValue({
      slug: 'aurora',
      title: 'Aurora',
      description: 'desc',
      coverImage: 'cover.png',
      thumbnail: 'thumb.png',
      version: '1.0',
      checksum: 'abc',
      files: [{ path: 'sprite.png', url: 'https://cdn.test/sprite.png', checksum: 'hash' }],
      updatedAt: new Date('2026-04-10T00:00:00.000Z'),
    })

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    const result = await findDesktopPersonaManifestById(entryId)

    expect(result).toMatchObject({
      id: entryId,
      sourceType: 'starter',
      title: 'Aurora',
      files: [{ path: 'sprite.png' }],
      sprite: null,
    })
  })

  it('returns a sprite manifest for dynamic souls', async () => {
    mockedPrisma.soulAsset.findUnique.mockResolvedValue(makeSoul())

    const { findDesktopPersonaManifestById } = await import('../../web/lib/desktop/repository')
    const result = await findDesktopPersonaManifestById('soul:0xsoul-1')

    expect(result).toMatchObject({
      id: 'soul:0xsoul-1',
      sourceType: 'soul',
      routeId: '0xsoul-1',
      onChainId: '0xsoul-1',
      spriteDownloadPolicy: 'public',
      sprite: {
        downloadPolicy: 'public',
      },
      files: [],
    })
  })
})
