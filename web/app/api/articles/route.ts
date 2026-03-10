import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveArticleStatusFilter } from '@web/lib/article-query-access'
import { createSupabaseServer } from '@web/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestedStatus = request.nextUrl.searchParams.get('status')
  const directionId = request.nextUrl.searchParams.get('directionId')
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50')
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { allowed, status } = resolveArticleStatusFilter(requestedStatus, Boolean(user))

  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (directionId) where.directionId = directionId

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
