import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ID = `0x${'1'.repeat(64)}`, CONTENT_ID = `0x${'2'.repeat(64)}`
const mockedFindContentVersionsByRouteId = vi.hoisted(() => vi.fn())
vi.mock('@/lib/soulidity/repository', () => ({ findContentVersionsByRouteId: mockedFindContentVersionsByRouteId }))

// Retained read endpoint has other callers. Standalone writes now use exact
// browser transactions; their original semantics live in mutation/Move suites.
describe('GET /api/souls/[id]/content', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.resetModules() })
  it('paginates one requested content kind/name without inventing a parallel DTO', async () => {
    const page = { soulOnChainId: SOUL_ID, contentOnChainId: CONTENT_ID, kind: 2, name: 'market-scout',
      items: [{ id: 'version-2', kind: 2, name: 'market-scout', versionIndex: 2 }], nextCursor: 'next-cursor', total: 3 }
    mockedFindContentVersionsByRouteId.mockResolvedValue(page)
    const { GET } = await import('../../web/app/api/souls/[id]/content/route')
    const response = await GET(new Request(`http://localhost/api/souls/${SOUL_ID}/content?kind=skill&name=market-scout&cursor=cursor-1&limit=2`),
      { params: Promise.resolve({ id: SOUL_ID }) })
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual(page)
    expect(mockedFindContentVersionsByRouteId).toHaveBeenCalledWith(SOUL_ID, 2, { name: 'market-scout', cursor: 'cursor-1', limit: 2 })
  })
})
