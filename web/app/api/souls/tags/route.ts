import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT LOWER(tag) AS tag, COUNT(*) AS count
    FROM (
      SELECT unnest(tags) AS tag
      FROM "soul_assets"
      WHERE "listing_status" = 'listed'
    ) listed_tags
    GROUP BY LOWER(tag)
    ORDER BY count DESC, tag ASC
    LIMIT 50
  `
  const tags = result.map((r) => ({ tag: r.tag, count: Number(r.count) }))
  return NextResponse.json({ tags })
}
