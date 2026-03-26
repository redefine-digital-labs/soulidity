import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { serializeAtomicUsdcAmount } from '@web/lib/souls/price-format'

const MAX_SOUL_QUERY_PARAM_LENGTH = 200

function readOptionalBoundedQuery(value: string | null, name: string): { value?: string; error?: string } {
  if (value == null) return {}

  const normalized = value.trim()
  if (!normalized) return {}
  if (normalized.length > MAX_SOUL_QUERY_PARAM_LENGTH) {
    return { error: `${name} must be at most ${MAX_SOUL_QUERY_PARAM_LENGTH} characters` }
  }

  return { value: normalized }
}

export async function GET(req: NextRequest) {
  const { agent: _agent, response } = await requireAgentApiKey(req)
  if (!_agent) return response

  const url = req.nextUrl
  const qParam = readOptionalBoundedQuery(url.searchParams.get('q'), 'q')
  if (qParam.error) {
    return NextResponse.json({ error: qParam.error }, { status: 400 })
  }
  const categoryParam = readOptionalBoundedQuery(url.searchParams.get('category'), 'category')
  if (categoryParam.error) {
    return NextResponse.json({ error: categoryParam.error }, { status: 400 })
  }
  const q = qParam.value || ''
  const category = categoryParam.value
  const rawLimit = Number(url.searchParams.get('limit') || '20')
  const rawOffset = Number(url.searchParams.get('offset') || '0')
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 20
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0

  const where: Record<string, unknown> = { status: 'active' }
  if (category) where.category = category
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { tags: { has: q } },
    ]
  }

  const items = await prisma.soulSeries.findMany({
    where,
    select: {
      id: true,
      onChainId: true,
      name: true,
      description: true,
      category: true,
      tags: true,
      oneTimePriceUsdc: true,
      subPriceUsdc: true,
      subPeriodDays: true,
    },
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
  })

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      oneTimePriceUsdc: serializeAtomicUsdcAmount(item.oneTimePriceUsdc),
      subPriceUsdc: serializeAtomicUsdcAmount(item.subPriceUsdc),
    })),
    offset,
    limit,
  })
}
