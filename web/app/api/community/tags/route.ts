import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cached } from '@/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@/lib/rate-limit'
import { parseCommunityTags } from '@shared/community-tags'

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
      where: {
        status: 'published',
        NOT: { tags: { isEmpty: true } },
      },
      select: { tags: true },
    })

    return Array.from(
      new Set(
        rows.flatMap((row) => parseCommunityTags(row.tags))
      )
    )
  })

  return NextResponse.json(tags)
}
