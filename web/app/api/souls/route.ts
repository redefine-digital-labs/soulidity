import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@/lib/soulidity/repository'
import type { Prisma } from '../../../generated/prisma/client'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 50
export const dynamic = 'force-dynamic'

type SortOption = 'newest' | 'price_asc' | 'price_desc' | 'popular'

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseSortOption(value: string | null): SortOption {
  if (value === 'price_asc' || value === 'price_desc' || value === 'popular') return value
  return 'newest'
}

function buildOrderBy(sort: SortOption): Prisma.SoulAssetOrderByWithRelationInput {
  switch (sort) {
    case 'price_asc':
      return { listedPriceAtomic: 'asc' }
    case 'price_desc':
      return { listedPriceAtomic: 'desc' }
    case 'popular':
      return { activeGrantCount: 'desc' }
    case 'newest':
    default:
      return { createdAt: 'desc' }
  }
}

export function buildSoulsWhere(params: {
  q: string
  category: string
  minPriceRaw: string
  maxPriceRaw: string
  creator: string
}): Prisma.SoulAssetWhereInput {
  const { q, category, minPriceRaw, maxPriceRaw, creator } = params
  const where: Prisma.SoulAssetWhereInput = {
    listingStatus: 'listed',
  }

  if (category) {
    where.category = category
  }

  const conditions: Prisma.SoulAssetWhereInput[] = []

  if (q) {
    conditions.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ],
    })
  }

  if (minPriceRaw || maxPriceRaw) {
    const priceFilter: Prisma.DecimalNullableFilter = {}
    if (minPriceRaw) priceFilter.gte = minPriceRaw
    if (maxPriceRaw) priceFilter.lte = maxPriceRaw
    where.listedPriceAtomic = priceFilter
  }

  if (creator) {
    conditions.push({
      OR: [
        { creatorAddress: { contains: creator, mode: 'insensitive' } },
        {
          creatorMember: {
            OR: [
              { displayName: { contains: creator, mode: 'insensitive' } },
              { handle: { contains: creator, mode: 'insensitive' } },
            ],
          },
        },
      ],
    })
  }

  if (conditions.length > 0) {
    where.AND = conditions
  }

  return where
}

export async function GET(request: NextRequest) {
  const page = parsePositiveInteger(request.nextUrl.searchParams.get('page'), DEFAULT_PAGE)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInteger(request.nextUrl.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
  )
  const q = request.nextUrl.searchParams.get('q')?.trim() || ''
  const category = request.nextUrl.searchParams.get('category')?.trim() || ''
  const sort = parseSortOption(request.nextUrl.searchParams.get('sort'))
  const minPriceRaw = request.nextUrl.searchParams.get('minPrice')?.trim() || ''
  const maxPriceRaw = request.nextUrl.searchParams.get('maxPrice')?.trim() || ''
  const creator = request.nextUrl.searchParams.get('creator')?.trim() || ''

  const where = buildSoulsWhere({ q, category, minPriceRaw, maxPriceRaw, creator })

  const orderBy = buildOrderBy(sort)

  const [items, total] = await Promise.all([
    prisma.soulAsset.findMany({
      where,
      select: soulAssetSummarySelect,
      orderBy,
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
