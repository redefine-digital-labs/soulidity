import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`soul-categories:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const categories = await cached('soul:categories', 300_000, async () => {
    const rows = await prisma.soulAsset.findMany({
      where: { listingStatus: 'listed' },
      select: { category: true },
      distinct: ['category'],
    })

    return rows
      .map((c) => c.category)
      .filter(Boolean)
      .sort()
  })

  return NextResponse.json(categories)
}
