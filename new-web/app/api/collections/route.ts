import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken, getAnonymousRateLimitFingerprint, getRequestIp } from '@web/lib/rate-limit'
import {
  soulCollectionSummarySelect,
  toSoulCollectionSummaryList,
} from '@/lib/soulidity/repository'

export const dynamic = 'force-dynamic'

const COLLECTION_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 50

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited, retryAfterSeconds } = await takeRateLimitToken(`collections:${ip}`, COLLECTION_RATE_LIMIT)
    if (limited) {
      return NextResponse.json(
        { error: 'Too many collection requests, try again later' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      )
    }
  }

  const page = parsePositiveInteger(request.nextUrl.searchParams.get('page'), DEFAULT_PAGE)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInteger(request.nextUrl.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
  )
  const q = request.nextUrl.searchParams.get('q')?.trim() || ''

  const where: Record<string, unknown> = {}
  if (request.nextUrl.searchParams.get('listed') !== 'false') {
    where.listingStatus = 'listed'
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.soulCollectionAsset.findMany({
      where,
      select: soulCollectionSummarySelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.soulCollectionAsset.count({ where }),
  ])

  return NextResponse.json({
    items: toSoulCollectionSummaryList(items),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}
