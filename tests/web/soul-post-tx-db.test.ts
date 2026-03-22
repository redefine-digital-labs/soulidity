import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: {
    updateMany: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('post-tx db pricing mirror', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedPrisma.soulSeries.updateMany.mockResolvedValue({ count: 1 })
  })

  it('rounds tiny positive atomic USDC values up to at least one cent in the mirror', async () => {
    const { dbUpdatePricingPlan } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbUpdatePricingPlan({
      seriesOnChainId: '0xseries',
      planType: 'onetime',
      planOnChainId: '0xplan',
      priceUsdc: 9_999n,
    })

    expect(mockedPrisma.soulSeries.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xseries' },
      data: {
        oneTimePriceUsdc: 1,
        oneTimePlanOnChainId: '0xplan',
      },
    })
  })
})
