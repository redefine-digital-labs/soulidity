import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cached } from '@/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`tags:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const tags = await cached('community:tags', 300_000, async () => {
    const rows = await prisma.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT TRIM(t) AS tag
      FROM posts, unnest(tags) AS t
      WHERE status = 'published' AND TRIM(t) <> ''
      ORDER BY tag
    `
    return rows.map((r) => r.tag)
  })

  return NextResponse.json(tags)
}
