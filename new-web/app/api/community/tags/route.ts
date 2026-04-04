import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`tags:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const tags = await cached('community:tags', 300_000, async () => {
    const rows = await prisma.post.findMany({
      where: { status: 'published', tags: { not: null } },
      select: { tags: true },
      distinct: ['tags'],
    })

    return Array.from(
      new Set(
        rows.flatMap(r => (r.tags ? r.tags.split(',').map(t => t.trim()) : []))
          .filter(Boolean)
      )
    )
  })

  return NextResponse.json(tags)
}
