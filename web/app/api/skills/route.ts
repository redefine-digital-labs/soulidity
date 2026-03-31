import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`skills:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const skills = await cached('skills:all', 300_000, async () => {
    return prisma.skill.findMany({
      orderBy: { downloads: 'desc' },
    })
  })

  return NextResponse.json(skills)
}
