import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@web/lib/souls/repository'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 50

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: NextRequest) {
  const page = parsePositiveInteger(request.nextUrl.searchParams.get('page'), DEFAULT_PAGE)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInteger(request.nextUrl.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
  )
  const q = request.nextUrl.searchParams.get('q')?.trim() || ''
  const category = request.nextUrl.searchParams.get('category')?.trim() || ''

  const where: Record<string, unknown> = {
    listingStatus: 'listed',
  }
  if (category) {
    where.category = category
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { tags: { has: q } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.soulAsset.findMany({
      where,
      select: soulAssetSummarySelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.soulAsset.count({ where }),
  ])

  return NextResponse.json({
    items: toSoulAssetSummaryList(items),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}
