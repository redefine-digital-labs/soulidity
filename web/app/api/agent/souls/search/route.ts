import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@/lib/soulidity/repository'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_SEARCH_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

export async function GET(request: NextRequest) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-search:${auth.agent.agentMemberId}`,
    AGENT_SEARCH_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent search requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim().slice(0, 200) || ''
  const tag = url.searchParams.get('tag')?.trim().slice(0, 200) || ''
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const where: Record<string, unknown> = { listingStatus: 'listed' }
  if (tag) where.tags = { has: tag.toLowerCase() }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { tags: { has: q.toLowerCase() } },
    ]
  }

  const items = await prisma.soulAsset.findMany({
    where,
    select: soulAssetSummarySelect,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })

  return NextResponse.json({
    items: toSoulAssetSummaryList(items),
    offset,
    limit,
  })
}
