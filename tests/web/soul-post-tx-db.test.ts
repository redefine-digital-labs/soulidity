import { beforeEach, describe, expect, it, vi } from 'vitest'

const AUTHOR_ADDRESS = `0x${'a'.repeat(64)}`
const OTHER_ADDRESS = `0x${'b'.repeat(64)}`

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  soulRelease: {
    upsert: vi.fn(),
    update: vi.fn(),
  },
  soulPassSnapshot: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
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
    mockedPrisma.soulSeries.findUnique.mockResolvedValue({
      id: 'series-db-1',
      authorMemberId: 'member-1',
      authorAddress: AUTHOR_ADDRESS,
    })
    mockedPrisma.soulSeries.upsert.mockResolvedValue({})
    mockedPrisma.soulSeries.update.mockResolvedValue({})
    mockedPrisma.soulSeries.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.soulRelease.upsert.mockResolvedValue({ id: 'release-db-1' })
    mockedPrisma.soulRelease.update.mockResolvedValue({ id: 'release-db-1' })
    mockedPrisma.soulPassSnapshot.upsert.mockResolvedValue({})
    mockedPrisma.soulPassSnapshot.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
  })

  it('refreshes the stored author address while preserving the existing author member binding', async () => {
    const { dbCreateSeries } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbCreateSeries({
      seriesOnChainId: '0xseries',
      authorAddress: AUTHOR_ADDRESS,
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
        authorAddress: AUTHOR_ADDRESS,
        authorMemberId: 'member-1',
      }),
      update: expect.objectContaining({
        authorAddress: AUTHOR_ADDRESS,
      }),
    })
    const upsertArgs = mockedPrisma.soulSeries.upsert.mock.calls[0]?.[0]
    expect(upsertArgs?.update).not.toHaveProperty('authorMemberId')
  })

  it('rejects a series mirror when the stored author does not match the on-chain author', async () => {
    mockedPrisma.soulSeries.findUnique.mockResolvedValueOnce({
      id: 'series-db-1',
      authorMemberId: 'member-other',
      authorAddress: OTHER_ADDRESS,
    })

    const { dbCreateSeries } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbCreateSeries({
      seriesOnChainId: '0xseries',
      authorAddress: AUTHOR_ADDRESS,
      authorMemberId: 'member-1',
      name: 'Signal Soul',
      description: 'A recovered mirror',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
    })).rejects.toThrow('existing Soul series author does not match the submitted on-chain author')

    expect(mockedPrisma.soulSeries.upsert).not.toHaveBeenCalled()
  })

  it('treats invalid stored author addresses as mismatches instead of falling back to raw string compare', async () => {
    mockedPrisma.soulSeries.findUnique.mockResolvedValueOnce({
      id: 'series-db-1',
      authorMemberId: 'member-1',
      authorAddress: 'not-a-sui-address',
    })

    const { dbCreateSeries } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbCreateSeries({
      seriesOnChainId: '0xseries',
      authorAddress: 'not-a-sui-address',
      authorMemberId: 'member-1',
      name: 'Signal Soul',
      description: 'A recovered mirror',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-1'],
    })).rejects.toThrow('existing Soul series author does not match the submitted on-chain author')

    expect(mockedPrisma.soulSeries.upsert).not.toHaveBeenCalled()
  })

  it('persists tiny positive atomic USDC values without rounding them to display cents', async () => {
    const { dbUpdatePricingPlan } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbUpdatePricingPlan({
      seriesOnChainId: '0xseries',
      planType: 'onetime',
      planOnChainId: '0xplan',
      priceUsdc: 9_999n,
    })

    const updateManyArgs = mockedPrisma.soulSeries.updateMany.mock.calls.at(-1)?.[0]
    expect(updateManyArgs).toMatchObject({
      where: { onChainId: '0xseries' },
      data: {
        oneTimePlanOnChainId: '0xplan',
      },
    })
    expect(updateManyArgs?.data.oneTimePriceUsdc?.toString()).toBe('9999')
  })

  it('persists the full atomic u64 price instead of converting it to display cents', async () => {
    const { dbUpdatePricingPlan } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbUpdatePricingPlan({
      seriesOnChainId: '0xseries',
      planType: 'onetime',
      planOnChainId: '0xplan',
      priceUsdc: 18_446_744_073_709_551_615n,
    })

    const updateManyArgs = mockedPrisma.soulSeries.updateMany.mock.calls.at(-1)?.[0]
    expect(updateManyArgs?.data.oneTimePriceUsdc?.toString()).toBe('18446744073709551615')
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

  it('creates a pass mirror after resolving the series lookup', async () => {
    mockedPrisma.soulPassSnapshot.upsert.mockResolvedValueOnce({
      id: 'pass-db-1',
      onChainId: '0xpass',
      passType: 'perpetual',
      seriesId: 'series-db-1',
    })
    const { dbCreatePass } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbCreatePass({
      passOnChainId: '0xpass',
      seriesOnChainId: '0xseries',
      ownerAddress: '0xowner',
      ownerMemberId: 'member-1',
      passType: 'perpetual',
      lockedReleaseId: '0xrelease',
      mintTxDigest: '0xdigest',
    })).resolves.toMatchObject({
      id: 'pass-db-1',
      onChainId: '0xpass',
      passType: 'perpetual',
    })

    expect(mockedPrisma.soulSeries.findUnique).toHaveBeenCalledWith({
      where: { onChainId: '0xseries' },
    })
    expect(mockedPrisma.soulPassSnapshot.upsert).toHaveBeenCalledWith({
      where: { onChainId: '0xpass' },
      create: {
        onChainId: '0xpass',
        seriesId: 'series-db-1',
        ownerAddress: '0xowner',
        ownerMemberId: 'member-1',
        passType: 'perpetual',
        lockedReleaseId: '0xrelease',
        expiresAt: null,
        mintTxDigest: '0xdigest',
      },
      update: {
        seriesId: 'series-db-1',
        ownerAddress: '0xowner',
        ownerMemberId: 'member-1',
        passType: 'perpetual',
        lockedReleaseId: '0xrelease',
        expiresAt: null,
        mintTxDigest: '0xdigest',
      },
    })
  })

  it('rejects pass mirrors when the target series does not exist in the database', async () => {
    mockedPrisma.soulSeries.findUnique.mockResolvedValueOnce(null)
    const { dbCreatePass } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbCreatePass({
      passOnChainId: '0xpass',
      seriesOnChainId: '0xmissing-series',
      ownerAddress: '0xowner',
      ownerMemberId: 'member-1',
      passType: 'subscription',
      mintTxDigest: '0xdigest',
    })).rejects.toThrow('Series 0xmissing-series not found in DB')

    expect(mockedPrisma.soulPassSnapshot.upsert).not.toHaveBeenCalled()
  })

  it('updates the release-series association when reprocessing an existing release mirror', async () => {
    const { dbCreateRelease } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbCreateRelease({
      releaseOnChainId: `0x${'1'.repeat(64)}`,
      seriesDbId: 'series-db-2',
      seriesLatestReleaseOnChainId: `0x${'1'.repeat(64)}`,
      version: '1.1.0',
      walrusBlobRef: 'blob-2',
      publicMetadataRef: 'meta-2',
      contentHash: 'deadbeef',
      changelog: 'Patch release',
    })

    expect(mockedPrisma.soulRelease.upsert).toHaveBeenCalledWith({
      where: { onChainId: `0x${'1'.repeat(64)}` },
      create: {
        onChainId: `0x${'1'.repeat(64)}`,
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

  it('does not overwrite the stored latest release pointer when backfilling an older release mirror', async () => {
    const { dbCreateRelease } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbCreateRelease({
      releaseOnChainId: `0x${'2'.repeat(64)}`,
      seriesDbId: 'series-db-2',
      seriesLatestReleaseOnChainId: `0x${'3'.repeat(64)}`,
      version: '1.0.0',
      walrusBlobRef: 'blob-older',
      publicMetadataRef: 'meta-older',
      contentHash: 'beadfeed',
      changelog: 'Backfilled older release',
    })

    expect(mockedPrisma.soulRelease.upsert).toHaveBeenCalledWith({
      where: { onChainId: `0x${'2'.repeat(64)}` },
      create: {
        onChainId: `0x${'2'.repeat(64)}`,
        seriesId: 'series-db-2',
        version: '1.0.0',
        walrusBlobRef: 'blob-older',
        publicMetadataRef: 'meta-older',
        contentHash: 'beadfeed',
        changelog: 'Backfilled older release',
      },
      update: {
        seriesId: 'series-db-2',
        version: '1.0.0',
        walrusBlobRef: 'blob-older',
        publicMetadataRef: 'meta-older',
        contentHash: 'beadfeed',
        changelog: 'Backfilled older release',
      },
    })
    expect(mockedPrisma.soulSeries.update).not.toHaveBeenCalled()
  })

  it('rebinds an existing same-version release row when on-chain ids drift in development data', async () => {
    mockedPrisma.soulRelease.upsert.mockRejectedValueOnce({ code: 'P2002' })

    const { dbCreateRelease } = await import('../../web/lib/souls/post-tx-db.ts')

    await dbCreateRelease({
      releaseOnChainId: `0x${'4'.repeat(64)}`,
      seriesDbId: 'series-db-2',
      seriesLatestReleaseOnChainId: `0x${'4'.repeat(64)}`,
      version: '1.2.0',
      walrusBlobRef: 'blob-rebound',
      publicMetadataRef: 'meta-rebound',
      contentHash: 'cafebabe',
      changelog: 'Rebound latest release',
    })

    expect(mockedPrisma.soulRelease.update).toHaveBeenCalledWith({
      where: {
        seriesId_version: {
          seriesId: 'series-db-2',
          version: '1.2.0',
        },
      },
      data: {
        onChainId: `0x${'4'.repeat(64)}`,
        walrusBlobRef: 'blob-rebound',
        publicMetadataRef: 'meta-rebound',
        contentHash: 'cafebabe',
        changelog: 'Rebound latest release',
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

  it('sets the agent grant on an existing pass snapshot', async () => {
    const { dbSetAgentGrant } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbSetAgentGrant({
      passOnChainId: '0xpass',
      agentAddress: '0xagent',
    })).resolves.toBeUndefined()

    expect(mockedPrisma.soulPassSnapshot.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xpass' },
      data: { agentGrant: '0xagent' },
    })
  })

  it('throws when setting an agent grant for a missing pass snapshot', async () => {
    mockedPrisma.soulPassSnapshot.updateMany.mockResolvedValueOnce({ count: 0 })
    const { dbSetAgentGrant } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbSetAgentGrant({
      passOnChainId: '0xmissing',
      agentAddress: '0xagent',
    })).rejects.toThrow('Pass 0xmissing not found')
  })

  it('clears the agent grant on an existing pass snapshot', async () => {
    const { dbRevokeAgentGrant } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbRevokeAgentGrant({
      passOnChainId: '0xpass',
    })).resolves.toBeUndefined()

    expect(mockedPrisma.soulPassSnapshot.updateMany).toHaveBeenCalledWith({
      where: { onChainId: '0xpass' },
      data: { agentGrant: null },
    })
  })

  it('throws when revoking an agent grant for a missing pass snapshot', async () => {
    mockedPrisma.soulPassSnapshot.updateMany.mockResolvedValueOnce({ count: 0 })
    const { dbRevokeAgentGrant } = await import('../../web/lib/souls/post-tx-db.ts')

    await expect(dbRevokeAgentGrant({
      passOnChainId: '0xmissing',
    })).rejects.toThrow('Pass 0xmissing not found')
  })

  describe('dbRenewPass', () => {
    it('updates expiresAt, lastRenewTxDigest and lastSyncedAt for a subscription pass', async () => {
      const { dbRenewPass } = await import('../../web/lib/souls/post-tx-db.ts')
      const newExpiresAt = new Date('2030-01-01T00:00:00.000Z')

      await expect(dbRenewPass({
        passOnChainId: '0xpass',
        newExpiresAt,
        renewTxDigest: '0xdigest',
      })).resolves.toBeUndefined()

      expect(mockedPrisma.soulPassSnapshot.updateMany).toHaveBeenCalledWith({
        where: { onChainId: '0xpass', passType: 'subscription' },
        data: expect.objectContaining({
          expiresAt: newExpiresAt,
          lastRenewTxDigest: '0xdigest',
          lastSyncedAt: expect.any(Date),
        }),
      })
    })

    it('throws when no subscription pass matches the given onChainId', async () => {
      mockedPrisma.soulPassSnapshot.updateMany.mockResolvedValueOnce({ count: 0 })
      const { dbRenewPass } = await import('../../web/lib/souls/post-tx-db.ts')

      await expect(dbRenewPass({
        passOnChainId: '0xmissing',
        newExpiresAt: new Date(),
        renewTxDigest: '0xdigest',
      })).rejects.toThrow('Subscription pass 0xmissing not found')
    })

    it('throws for a perpetual pass because the where clause filters on passType subscription', async () => {
      // perpetual passes will not match the subscription filter → count: 0
      mockedPrisma.soulPassSnapshot.updateMany.mockResolvedValueOnce({ count: 0 })
      const { dbRenewPass } = await import('../../web/lib/souls/post-tx-db.ts')

      await expect(dbRenewPass({
        passOnChainId: '0xperpetual',
        newExpiresAt: new Date(),
        renewTxDigest: '0xdigest',
      })).rejects.toThrow('Subscription pass 0xperpetual not found')
    })
  })
})
