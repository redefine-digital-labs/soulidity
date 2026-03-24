import { describe, expect, it, vi } from 'vitest'
import { reconcileSoulLatestReleases } from '../../src/db/reconcile-soul-latest-releases.ts'

describe('reconcileSoulLatestReleases', () => {
  it('continues reconciling later series after a per-series failure', async () => {
    const prisma = {
      soulSeries: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'series-db-1',
            onChainId: `0x${'1'.repeat(64)}`,
            latestReleaseId: 'release-db-1',
          },
          {
            id: 'series-db-2',
            onChainId: `0x${'2'.repeat(64)}`,
            latestReleaseId: 'release-db-stale',
          },
        ]),
        update: vi.fn(),
      },
      soulRelease: {
        findFirst: vi.fn().mockResolvedValueOnce(null),
      },
    } as any

    const getVerifiedSeriesState = vi.fn()
      .mockRejectedValueOnce(new Error('rpc timeout'))
      .mockResolvedValueOnce({ latestReleaseId: `0x${'3'.repeat(64)}` })
    const resolveReleaseByOnChainId = vi.fn().mockResolvedValue({ id: 'release-db-latest' })
    const onSeriesError = vi.fn()

    const summary = await reconcileSoulLatestReleases({
      prisma,
      soulPackageId: `0x${'9'.repeat(64)}`,
      getVerifiedSeriesState,
      resolveReleaseByOnChainId,
      onSeriesError,
    })

    expect(summary).toEqual({
      scanned: 2,
      updated: 1,
      backfilled: 1,
      cleared: 0,
      errors: 1,
    })
    expect(resolveReleaseByOnChainId).toHaveBeenCalledTimes(1)
    expect(resolveReleaseByOnChainId).toHaveBeenCalledWith({
      db: prisma,
      releaseOnChainId: `0x${'3'.repeat(64)}`,
      seriesDbId: 'series-db-2',
      seriesOnChainId: `0x${'2'.repeat(64)}`,
      seriesLatestReleaseOnChainId: `0x${'3'.repeat(64)}`,
      soulPackageId: `0x${'9'.repeat(64)}`,
    })
    expect(onSeriesError).toHaveBeenCalledWith({
      series: {
        id: 'series-db-1',
        onChainId: `0x${'1'.repeat(64)}`,
        latestReleaseId: 'release-db-1',
      },
      error: expect.any(Error),
    })
  })
})
