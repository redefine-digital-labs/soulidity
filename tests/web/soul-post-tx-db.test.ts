import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  soulRelease: {
    upsert: vi.fn(),
  },
  soulPassSnapshot: {
    upsert: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('post-tx db pricing mirror', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedPrisma.soulSeries.findUnique.mockResolvedValue({ id: 'series-db-1' })
    mockedPrisma.soulSeries.upsert.mockResolvedValue({})
    mockedPrisma.soulSeries.update.mockResolvedValue({})
    mockedPrisma.soulSeries.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.soulRelease.upsert.mockResolvedValue({ id: 'release-db-1' })
    mockedPrisma.soulPassSnapshot.upsert.mockResolvedValue({})
    mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
  })

  it('does not overwrite the stored author fields when a series mirror already exists', async () => {
    const { dbCreateSeries } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbCreateSeries({
      seriesOnChainId: '0xseries',
      authorAddress: '0xauthor',
      authorMemberId: 'member-1',
      name: 'Signal Soul',
      description: 'A recovered mirror',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
    })

    expect(mockedPrisma.soulSeries.upsert).toHaveBeenCalledWith({
      where: { onChainId: '0xseries' },
      create: expect.objectContaining({
        authorAddress: '0xauthor',
        authorMemberId: 'member-1',
      }),
      update: expect.not.objectContaining({
        authorAddress: '0xauthor',
        authorMemberId: 'member-1',
      }),
    })
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

  it('rejects subscription pricing plans without a positive period', async () => {
    const { dbUpdatePricingPlan } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbUpdatePricingPlan({
      seriesOnChainId: '0xseries',
      planType: 'subscription',
      planOnChainId: '0xplan',
      priceUsdc: 1_000_000n,
    })).rejects.toThrow('subscription pricing plans require a positive periodMs')

    expect(mockedPrisma.soulSeries.updateMany).not.toHaveBeenCalled()
  })

  it('rejects subscription pricing plans whose period exceeds the safe JS integer range', async () => {
    const { dbUpdatePricingPlan } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbUpdatePricingPlan({
      seriesOnChainId: '0xseries',
      planType: 'subscription',
      planOnChainId: '0xplan',
      priceUsdc: 1_000_000n,
      periodMs: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    })).rejects.toThrow('subscription periodMs exceeds supported range')

    expect(mockedPrisma.soulSeries.updateMany).not.toHaveBeenCalled()
  })

  it('rejects perpetual pass mirrors that omit the locked release id', async () => {
    const { dbCreatePass } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbCreatePass({
      passOnChainId: '0xpass',
      seriesOnChainId: '0xseries',
      ownerAddress: '0xowner',
      ownerMemberId: 'member-1',
      passType: 'perpetual',
      mintTxDigest: '0xdigest',
    })).rejects.toThrow('perpetual passes require a lockedReleaseId')

    expect(mockedPrisma.soulPassSnapshot.upsert).not.toHaveBeenCalled()
  })

  it('updates the release-series association when reprocessing an existing release mirror', async () => {
    const { dbCreateRelease } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbCreateRelease({
      releaseOnChainId: '0xrelease',
      seriesDbId: 'series-db-2',
      version: '1.1.0',
      walrusBlobRef: 'blob-2',
      publicMetadataRef: 'meta-2',
      contentHash: 'deadbeef',
      changelog: 'Patch release',
    })

    expect(mockedPrisma.soulRelease.upsert).toHaveBeenCalledWith({
      where: { onChainId: '0xrelease' },
      create: {
        onChainId: '0xrelease',
        seriesId: 'series-db-2',
        version: '1.1.0',
        walrusBlobRef: 'blob-2',
        publicMetadataRef: 'meta-2',
        contentHash: 'deadbeef',
        changelog: 'Patch release',
      },
      update: {
        seriesId: 'series-db-2',
        version: '1.1.0',
        walrusBlobRef: 'blob-2',
        publicMetadataRef: 'meta-2',
        contentHash: 'deadbeef',
        changelog: 'Patch release',
      },
    })
    expect(mockedPrisma.soulSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-db-2' },
      data: { latestReleaseId: 'release-db-1' },
    })
  })

  it('rejects subscription pass mirrors that try to persist a locked release id', async () => {
    const { dbCreatePass } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbCreatePass({
      passOnChainId: '0xpass',
      seriesOnChainId: '0xseries',
      ownerAddress: '0xowner',
      ownerMemberId: 'member-1',
      passType: 'subscription',
      lockedReleaseId: '0xrelease',
      mintTxDigest: '0xdigest',
    })).rejects.toThrow('subscription passes cannot set lockedReleaseId')

    expect(mockedPrisma.soulPassSnapshot.upsert).not.toHaveBeenCalled()
  })
})
