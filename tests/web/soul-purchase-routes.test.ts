import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('Soul purchase and renew routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1' },
    })
    mockedPrisma.soulSeries.findUnique.mockResolvedValue({
      id: 'series-1',
      onChainId: '0xseries',
      oneTimePriceUsdc: 1200,
      subPriceUsdc: 500,
    })
  })

  it('returns 503 for purchase requests without attempting to parse client-submitted tx digests', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/purchase', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{invalid-json',
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul purchases are temporarily disabled until verified settlement is fully wired.',
    })
  })

  it('returns 503 for renew requests without attempting to parse client-submitted tx digests', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/renew/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/renew', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{invalid-json',
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul renewals are temporarily disabled until verified settlement is fully wired.',
    })
  })
})
