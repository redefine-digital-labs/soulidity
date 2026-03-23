import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findUnique: vi.fn() },
}))
const mockedDbCreateRelease = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbCreateRelease: mockedDbCreateRelease,
}))

describe('soul release route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
  })

  it('fails closed instead of accepting direct release mirrors', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          releaseOnChainId: '0xrelease',
          version: '1.0.0',
          walrusBlobRef: 'blob-1',
          contentHash: 'deadbeef',
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('release publishing'),
    })
    expect(mockedRequireIdentity).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.soulSeries.findUnique).not.toHaveBeenCalled()
    expect(mockedDbCreateRelease).not.toHaveBeenCalled()
  })
})
