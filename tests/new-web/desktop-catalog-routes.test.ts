import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedListDesktopCatalogItems = vi.hoisted(() => vi.fn())
const mockedFindDesktopPersonaManifestById = vi.hoisted(() => vi.fn())

vi.mock('@/lib/desktop/repository', () => ({
  listDesktopCatalogItems: mockedListDesktopCatalogItems,
  findDesktopPersonaManifestById: mockedFindDesktopPersonaManifestById,
}))

describe('GET /api/desktop/catalog', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns paginated catalog items with defaults', async () => {
    mockedListDesktopCatalogItems.mockResolvedValue({ items: [], total: 0 })

    const { GET } = await import('../../web/app/api/desktop/catalog/route')
    const request = new Request('http://localhost/api/desktop/catalog')
    const nextRequest = Object.assign(request, {
      nextUrl: new URL('http://localhost/api/desktop/catalog'),
    })
    const response = await GET(nextRequest as any)
    const body = await response.json()

    expect(body).toMatchObject({ items: [], total: 0, page: 1, pageSize: 12 })
    expect(mockedListDesktopCatalogItems).toHaveBeenCalledWith({ page: 1, pageSize: 12 })
  })

  it('clamps pageSize to MAX_PAGE_SIZE', async () => {
    mockedListDesktopCatalogItems.mockResolvedValue({ items: [], total: 0 })

    const { GET } = await import('../../web/app/api/desktop/catalog/route')
    const request = new Request('http://localhost/api/desktop/catalog?pageSize=999')
    const nextRequest = Object.assign(request, {
      nextUrl: new URL('http://localhost/api/desktop/catalog?pageSize=999'),
    })
    const response = await GET(nextRequest as any)
    const body = await response.json()

    expect(body.pageSize).toBe(50)
  })
})

describe('GET /api/desktop/catalog/[id]', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 404 when manifest not found', async () => {
    mockedFindDesktopPersonaManifestById.mockResolvedValue(null)

    const { GET } = await import('../../web/app/api/desktop/catalog/[id]/route')
    const response = await GET(
      new Request('http://localhost/api/desktop/catalog/entry-1'),
      { params: Promise.resolve({ id: 'entry-1' }) },
    )

    expect(response.status).toBe(404)
  })
})
