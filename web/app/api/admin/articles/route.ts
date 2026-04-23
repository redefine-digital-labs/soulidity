import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const requestedStatus = request.nextUrl.searchParams.get('status')
  const parsedLimit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, MAX_LIMIT))

  const where: Record<string, unknown> = {}
  if (requestedStatus) where.status = requestedStatus

  const articles = await prisma.article.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      rawItem: { select: { url: true, sourceName: true, rawData: true } },
    },
  })

  return NextResponse.json(articles)
}
