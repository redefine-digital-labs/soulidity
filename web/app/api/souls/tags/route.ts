import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
import { getCachedSoulTags, setCachedSoulTags } from './cache'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cached = getCachedSoulTags()
  if (cached) {
    return NextResponse.json(cached)
  }

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
  const value = { tags }
  setCachedSoulTags(value)
  return NextResponse.json(value)
}
