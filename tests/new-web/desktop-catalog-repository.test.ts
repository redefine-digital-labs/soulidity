import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    desktopCatalogEntry: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    starterPersonaAsset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    soulAsset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import {
  buildDesktopCatalogWhere,
  findDesktopPersonaManifestById,
  listDesktopCatalogItems,
} from '../../web/lib/desktop/repository'

describe('buildDesktopCatalogWhere', () => {
  it('defaults anonymous catalog queries to published + visible entries only', () => {
    expect(buildDesktopCatalogWhere()).toEqual({
      isPublished: true,
      isHidden: false,
    })
  })

  it('allows opting into hidden/unpublished entries when explicitly requested', () => {
    expect(
      buildDesktopCatalogWhere({
        includeHidden: true,
        includeUnpublished: true,
        sourceType: 'soul',
      }),
    ).toEqual({
      sourceType: 'soul',
    })
  })
})

describe('listDesktopCatalogItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps starter and curated soul entries into one shared catalog response shape', async () => {
    const starterUpdatedAt = new Date('2026-04-10T00:00:00.000Z')
    const soulUpdatedAt = new Date('2026-04-10T01:00:00.000Z')

    mockPrisma.desktopCatalogEntry.findMany.mockResolvedValue([
      {
        id: 'catalog-starter',
        sourceType: 'starter',
        sourceRef: 'starter-aurora',
        sortOrder: 10,
        updatedAt: starterUpdatedAt,
      },
      {
        id: 'catalog-soul',
        sourceType: 'soul',
        sourceRef: '0xsoul-curated',
        sortOrder: 20,
        updatedAt: soulUpdatedAt,
      },
    ])
    mockPrisma.desktopCatalogEntry.count.mockResolvedValue(2)
    mockPrisma.starterPersonaAsset.findMany.mockResolvedValue([
      {
        slug: 'starter-aurora',
        title: 'Aurora Starter',
        description: 'Starter persona for anonymous onboarding.',
        coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
        thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
        updatedAt: starterUpdatedAt,
      },
    ])
    mockPrisma.soulAsset.findMany.mockResolvedValue([
      {
        onChainId: '0xsoul-curated',
        name: 'Aurora Curated Soul',
        description: 'Curated soul for desktop catalog development.',
        imageUrl: 'https://cdn.example.com/souls/aurora/cover.png',
        previewImages: ['https://cdn.example.com/souls/aurora/preview.png'],
        updatedAt: soulUpdatedAt,
      },
    ])

    const result = await listDesktopCatalogItems({
      page: 1,
      pageSize: 12,
    })

    expect(mockPrisma.desktopCatalogEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isPublished: true,
          isHidden: false,
        },
        orderBy: [
          { sortOrder: 'asc' },
          { updatedAt: 'desc' },
        ],
        skip: 0,
        take: 12,
      }),
    )

    expect(mockPrisma.starterPersonaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slug: {
            in: ['starter-aurora'],
          },
        },
      }),
    )

    expect(mockPrisma.soulAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          onChainId: {
            in: ['0xsoul-curated'],
          },
        },
      }),
    )

    expect(result).toEqual({
      items: [
        {
          id: 'catalog-starter',
          sourceType: 'starter',
          sourceRef: 'starter-aurora',
          title: 'Aurora Starter',
          description: 'Starter persona for anonymous onboarding.',
          coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
          thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
          updatedAt: '2026-04-10T00:00:00.000Z',
        },
        {
          id: 'catalog-soul',
          sourceType: 'soul',
          sourceRef: '0xsoul-curated',
          title: 'Aurora Curated Soul',
          description: 'Curated soul for desktop catalog development.',
          coverImage: 'https://cdn.example.com/souls/aurora/cover.png',
          thumbnail: 'https://cdn.example.com/souls/aurora/preview.png',
          updatedAt: '2026-04-10T01:00:00.000Z',
        },
      ],
      total: 2,
    })
  })
})

describe('findDesktopPersonaManifestById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps starter assets into the desktop persona manifest contract', async () => {
    const updatedAt = new Date('2026-04-10T02:00:00.000Z')

    mockPrisma.desktopCatalogEntry.findUnique.mockResolvedValue({
      id: 'catalog-starter',
      sourceType: 'starter',
      sourceRef: 'starter-aurora',
    })
    mockPrisma.starterPersonaAsset.findUnique.mockResolvedValue({
      slug: 'starter-aurora',
      title: 'Aurora Starter',
      description: 'Starter persona for anonymous onboarding.',
      coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
      thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
      version: '1.0.0',
      checksum: 'sha256-aurora-bundle-v1',
      files: [
        {
          path: 'persona.json',
          url: 'https://cdn.example.com/starters/aurora/persona.json',
          checksum: 'sha256-aurora-persona-v1',
        },
      ],
      updatedAt,
    })

    const result = await findDesktopPersonaManifestById('catalog-starter')

    expect(mockPrisma.desktopCatalogEntry.findUnique).toHaveBeenCalledWith({
      where: { id: 'catalog-starter' },
      select: expect.objectContaining({
        id: true,
        sourceType: true,
        sourceRef: true,
      }),
    })
    expect(mockPrisma.starterPersonaAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'starter-aurora' },
      }),
    )
    expect(result).toEqual({
      id: 'catalog-starter',
      sourceType: 'starter',
      sourceRef: 'starter-aurora',
      title: 'Aurora Starter',
      description: 'Starter persona for anonymous onboarding.',
      coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
      thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
      version: '1.0.0',
      checksum: 'sha256-aurora-bundle-v1',
      files: [
        {
          path: 'persona.json',
          url: 'https://cdn.example.com/starters/aurora/persona.json',
          checksum: 'sha256-aurora-persona-v1',
        },
      ],
      updatedAt: '2026-04-10T02:00:00.000Z',
    })
  })

  it('maps curated soul assets into a synthetic desktop manifest backed by the main content blob', async () => {
    const updatedAt = new Date('2026-04-10T03:00:00.000Z')

    mockPrisma.desktopCatalogEntry.findUnique.mockResolvedValue({
      id: 'catalog-soul',
      sourceType: 'soul',
      sourceRef: '0xsoul-curated',
    })
    mockPrisma.soulAsset.findUnique.mockResolvedValue({
      onChainId: '0xsoul-curated',
      name: 'Aurora Curated Soul',
      description: 'Curated soul for desktop catalog development.',
      imageUrl: 'https://cdn.example.com/souls/aurora/cover.png',
      previewImages: ['https://cdn.example.com/souls/aurora/preview.png'],
      contentBlobId: 'blob-desktop-seed-aurora',
      updatedAt,
    })

    const result = await findDesktopPersonaManifestById('catalog-soul')

    expect(mockPrisma.soulAsset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { onChainId: '0xsoul-curated' },
      }),
    )
    expect(result).toEqual({
      id: 'catalog-soul',
      sourceType: 'soul',
      sourceRef: '0xsoul-curated',
      title: 'Aurora Curated Soul',
      description: 'Curated soul for desktop catalog development.',
      coverImage: 'https://cdn.example.com/souls/aurora/cover.png',
      thumbnail: 'https://cdn.example.com/souls/aurora/preview.png',
      version: '2026-04-10T03:00:00.000Z',
      checksum: 'walrus:blob-desktop-seed-aurora',
      files: [
        {
          path: 'soul.bundle',
          url: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-desktop-seed-aurora',
          checksum: 'walrus:blob-desktop-seed-aurora',
        },
      ],
      updatedAt: '2026-04-10T03:00:00.000Z',
    })
  })
})
