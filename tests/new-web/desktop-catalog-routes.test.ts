import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedListDesktopCatalogItems = vi.hoisted(() => vi.fn())
const mockedFindDesktopPersonaManifestById = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/repository', () => ({
  listDesktopCatalogItems: mockedListDesktopCatalogItems,
  findDesktopPersonaManifestById: mockedFindDesktopPersonaManifestById,
}))

describe('desktop catalog routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns paginated anonymous desktop catalog items', async () => {
    mockedListDesktopCatalogItems.mockResolvedValue({
      items: [
        {
          id: 'catalog-starter',
          sourceType: 'starter',
          sourceRef: 'starter-aurora',
          title: 'Aurora Starter',
          description: 'Starter persona for anonymous onboarding.',
          coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
          thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
          updatedAt: '2026-04-10T02:00:00.000Z',
        },
      ],
      total: 7,
    })

    const { GET } = await import('../../web/app/api/desktop/catalog/route.ts')
    const response = await GET({
      nextUrl: new URL('http://localhost/api/desktop/catalog?page=2&pageSize=5'),
    } as never)

    expect(response.status).toBe(200)
    expect(mockedListDesktopCatalogItems).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
    })
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: 'catalog-starter',
          sourceType: 'starter',
          sourceRef: 'starter-aurora',
          title: 'Aurora Starter',
          description: 'Starter persona for anonymous onboarding.',
          coverImage: 'https://cdn.example.com/starters/aurora/cover.png',
          thumbnail: 'https://cdn.example.com/starters/aurora/thumb.png',
          updatedAt: '2026-04-10T02:00:00.000Z',
        },
      ],
      total: 7,
      page: 2,
      pageSize: 5,
      totalPages: 2,
    })
  })

  it('returns a desktop persona manifest for a known catalog id', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue({
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

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route.ts')
    const response = await GET(new Request('http://localhost/api/desktop/catalog/catalog-soul'), {
      params: Promise.resolve({ id: 'catalog-soul' }),
    })

    expect(response.status).toBe(200)
    expect(mockedFindDesktopPersonaManifestById).toHaveBeenCalledWith('catalog-soul')
    await expect(response.json()).resolves.toEqual({
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

  it('returns 404 when the desktop catalog detail cannot be found', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route.ts')
    const response = await GET(new Request('http://localhost/api/desktop/catalog/missing'), {
      params: Promise.resolve({ id: 'missing' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Not found',
    })
  })
})
