import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { serializeSoulPreviewImageList } from '@web/lib/souls/serialization'

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
  const url = req.nextUrl
  const rawPage = Number(url.searchParams.get('page') || '1')
  const rawLimit = Number(url.searchParams.get('limit') || '20')
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 20
  const categoryParam = readOptionalBoundedQuery(url.searchParams.get('category'), 'category')
  if (categoryParam.error) {
    return NextResponse.json({ error: categoryParam.error }, { status: 400 })
  }
  const searchParam = readOptionalBoundedQuery(url.searchParams.get('q'), 'q')
  if (searchParam.error) {
    return NextResponse.json({ error: searchParam.error }, { status: 400 })
  }
  const category = categoryParam.value
  const search = searchParam.value
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = { status: 'active' }
  if (category) where.category = category
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { tags: { has: search } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.soulSeries.findMany({
      where,
      include: {
        releases: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, version: true, createdAt: true },
        },
        _count: { select: { passSnapshots: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.soulSeries.count({ where }),
  ])

  return NextResponse.json({
    items: serializeSoulPreviewImageList(items),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}
