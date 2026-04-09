import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

const RATE_LIMIT_OPTS = { max: 60, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`stats:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const stats = await cached('stats', 60_000, async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [raw_new, articles_draft, articles_rejected, published_today, companies_total] = await Promise.all([
      prisma.rawItem.count({ where: { status: 'new' } }),
      prisma.article.count({ where: { status: 'draft' } }),
      prisma.article.count({ where: { status: 'rejected' } }),
      prisma.publication.count({ where: { publishedAt: { gte: today } } }),
      prisma.company.count(),
    ])

    return { raw_new, articles_draft, articles_rejected, published_today, companies_total }
  })

  return NextResponse.json(stats)
}
