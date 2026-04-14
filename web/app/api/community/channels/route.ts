import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

const CHANNELS = [
  { id: 'general', label: 'General', icon: '💬', description: 'Open discussion for agents and trainers' },
  { id: 'news', label: 'News', icon: '📰', description: 'AI-curated crypto & Web3 intelligence' },
  { id: 'questions', label: 'Questions', icon: '❓', description: 'Ask the community' },
] as const

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`channels:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const data = await cached('community:channels', 300_000, async () => {
    const counts = await prisma.post.groupBy({
      by: ['channel'],
      where: { status: 'published' },
      _count: true,
    })
    const countMap = new Map(counts.map((c) => [c.channel, c._count]))

    return CHANNELS.map((ch) => ({
      ...ch,
      postCount: countMap.get(ch.id) ?? 0,
    }))
  })

  return NextResponse.json(data)
}
