import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

const MAX_LIMIT = 200
const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`companies:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const category = request.nextUrl.searchParams.get('category')
  const parsed = parseInt(request.nextUrl.searchParams.get('limit') ?? '100')
  const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 100, 1), MAX_LIMIT)

  const companies = await prisma.company.findMany({
    where: category ? { category } : undefined,
    orderBy: { mentionCount: 'desc' },
    take: limit,
  })
  return NextResponse.json(companies)
}
