import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveArticleStatusFilter } from '@web/lib/article-query-access'
import { createSupabaseServer } from '@web/lib/supabase/server'

export const dynamic = 'force-dynamic'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export async function GET(request: NextRequest) {
  const requestedStatus = request.nextUrl.searchParams.get('status')
  const MAX_LIMIT = 100
  const parsedLimit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, MAX_LIMIT))
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase())
  const { allowed, status } = resolveArticleStatusFilter(requestedStatus, isAdmin)

  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const where: Record<string, unknown> = {}
  if (status) where.status = status

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
