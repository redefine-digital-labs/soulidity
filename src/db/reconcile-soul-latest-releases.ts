import { createPrisma, type PrismaClient } from './database.js'

async function importWebModule<T>(specifier: string): Promise<T> {
  const loadedModule = await import(specifier)
  return ((loadedModule as { default?: T }).default ?? loadedModule) as T
}

type ReconcileSeriesRow = {
  id: string
  onChainId: string
  latestReleaseId: string | null
}

type ReconcileSummary = {
  scanned: number
  updated: number
  backfilled: number
  cleared: number
  errors: number
}

type VerifiedSeriesStateReader = (
  seriesOnChainId: string,
  expectedPackageId?: string | null,
) => Promise<{ latestReleaseId: string | null }>

type ReleaseResolver = (params: {
  db: PrismaClient
  releaseOnChainId: string
  seriesDbId: string
  seriesOnChainId: string
  seriesLatestReleaseOnChainId: string | null
  soulPackageId: string
}) => Promise<{ id: string | null }>

export async function reconcileSoulLatestReleases(params: {
  prisma: PrismaClient
  soulPackageId: string
  getVerifiedSeriesState: VerifiedSeriesStateReader
  resolveReleaseByOnChainId: ReleaseResolver
  onSeriesError?: (context: { series: ReconcileSeriesRow, error: unknown }) => void
}): Promise<ReconcileSummary> {
  const seriesRows = await params.prisma.soulSeries.findMany({
    select: {
      id: true,
      onChainId: true,
      latestReleaseId: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const summary: ReconcileSummary = {
    scanned: 0,
    updated: 0,
    backfilled: 0,
    cleared: 0,
    errors: 0,
  }

  for (const series of seriesRows) {
    summary.scanned += 1

    try {
      const seriesState = await params.getVerifiedSeriesState(series.onChainId, params.soulPackageId)
      if (!seriesState.latestReleaseId) {
        if (series.latestReleaseId) {
          await params.prisma.soulSeries.update({
            where: { id: series.id },
            data: { latestReleaseId: null },
          })
          summary.cleared += 1
        }
        continue
      }

      const existingLatest = await params.prisma.soulRelease.findFirst({
        where: {
          onChainId: seriesState.latestReleaseId,
          seriesId: series.id,
        },
        select: { id: true },
      })

      const resolvedRelease = await params.resolveReleaseByOnChainId({
        db: params.prisma,
        releaseOnChainId: seriesState.latestReleaseId,
        seriesDbId: series.id,
        seriesOnChainId: series.onChainId,
        seriesLatestReleaseOnChainId: seriesState.latestReleaseId,
        soulPackageId: params.soulPackageId,
      })

      if (!existingLatest) {
        summary.backfilled += 1
      }
      if (series.latestReleaseId !== resolvedRelease.id) {
        summary.updated += 1
      }
    } catch (error) {
      summary.errors += 1
      params.onSeriesError?.({ series, error })
    }
  }

  return summary
}

async function main() {
  const soulPackageId = process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID
  if (!soulPackageId) {
    throw new Error('NEXT_PUBLIC_SOUL_PACKAGE_ID is required')
  }

  const { getVerifiedSeriesState } = await importWebModule<typeof import('../../web/lib/souls/on-chain-verification.ts')>(
    '../../web/lib/souls/on-chain-verification.ts',
  )
  const { resolveReleaseByOnChainId } = await importWebModule<typeof import('../../web/lib/souls/release-resolution.ts')>(
    '../../web/lib/souls/release-resolution.ts',
  )

  const prisma = createPrisma()

  try {
    const summary = await reconcileSoulLatestReleases({
      prisma,
      soulPackageId,
      getVerifiedSeriesState,
      resolveReleaseByOnChainId,
      onSeriesError: ({ series, error }) => {
        console.error('[reconcile-soul-latest-releases] Failed to reconcile series', {
          seriesId: series.id,
          seriesOnChainId: series.onChainId,
          error,
        })
      },
    })

    console.log(JSON.stringify(summary, null, 2))
    if (summary.errors > 0) {
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

if (
  process.argv[1]?.endsWith('reconcile-soul-latest-releases.ts')
  || process.argv[1]?.endsWith('reconcile-soul-latest-releases.js')
) {
  await import('dotenv/config')
  await main().catch((error) => {
    console.error('[reconcile-soul-latest-releases] Failed', error)
    process.exitCode = 1
  })
}
