import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export interface ProtocolStats {
  totalSouls: number
  totalVolumeAtomic: string
  activeSoulGrants: number
  soulsSold30d: number
  creatorCount: number
  avgSoulPriceAtomic: string
  collectionsLaunched: number
}

export async function GET() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Prisma does not support cross-column comparisons in `where` clauses, so we
  // use $queryRaw for queries that need `current_owner_address != creator_address`.
  const [
    totalSouls,
    volumeRows,
    activeSoulGrants,
    sold30dRows,
    creatorCountAgg,
    avgPriceAgg,
    collectionsLaunched,
  ] = await Promise.all([
    // Total Souls minted (all statuses)
    prisma.soulAsset.count(),

    // Estimated trade volume: sum of current listed prices for traded Souls.
    // This is a mirror-based proxy, not actual settlement amounts.
    prisma.$queryRaw<[{ total: bigint | null }]>`
      SELECT SUM(listed_price_atomic) AS total
      FROM soul_assets
      WHERE current_owner_address != creator_address
        AND listed_price_atomic IS NOT NULL
    `,

    // Active SoulGrants
    prisma.soulGrantRecord.count({ where: { status: 'active' } }),

    // Estimated traded Souls in last 30 days: owner != creator with recent update.
    // May include relists or mirror refreshes — not actual sale events.
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM soul_assets
      WHERE current_owner_address != creator_address
        AND updated_at >= ${thirtyDaysAgo}
    `,

    // Distinct creator count via groupBy
    prisma.soulAsset.groupBy({
      by: ['creatorAddress'],
      _count: true,
    }),

    // Average listing price for currently listed Souls (not executed sale prices)
    prisma.soulAsset.aggregate({
      _avg: { listedPriceAtomic: true },
      where: { listingStatus: 'listed' },
    }),

    // Collections launched
    prisma.soulCollectionAsset.count(),
  ])

  const stats: ProtocolStats = {
    totalSouls,
    totalVolumeAtomic: (volumeRows[0]?.total ?? 0n).toString(),
    activeSoulGrants,
    soulsSold30d: Number(sold30dRows[0]?.count ?? 0n),
    creatorCount: creatorCountAgg.length,
    avgSoulPriceAtomic: avgPriceAgg._avg.listedPriceAtomic != null
      ? avgPriceAgg._avg.listedPriceAtomic.toString()
      : '0',
    collectionsLaunched,
  }

  return NextResponse.json(stats)
}
