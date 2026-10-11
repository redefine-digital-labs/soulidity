import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      rawItem: { select: { url: true, sourceName: true } },
      companies: { include: { company: true } },
    },
  })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (article.status !== 'published') {
    const { error } = await requireAdmin()
    if (error) return error
  }

  return NextResponse.json({
    ...article,
    source_url: article.rawItem?.url,
    source_name: article.rawItem?.sourceName,
    companies: article.companies.map(ac => ac.company),
    rawItem: undefined,
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin({ mutation: request })
  if (error) return error

  const { id } = await params
  const body = await request.json()

  // Map both snake_case and camelCase keys to Prisma camelCase fields
  const keyMap: Record<string, string> = {
    title_zh: 'titleZh', title_en: 'titleEn',
    summary_zh: 'summaryZh', summary_en: 'summaryEn',
    analysis_zh: 'analysisZh', analysis_en: 'analysisEn',
    tags: 'tags', status: 'status',
    // Also accept camelCase directly
    titleZh: 'titleZh', titleEn: 'titleEn',
    summaryZh: 'summaryZh', summaryEn: 'summaryEn',
    analysisZh: 'analysisZh', analysisEn: 'analysisEn',
  }
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    const mapped = keyMap[key]
    if (mapped) data[mapped] = value
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const updated = await prisma.article.update({ where: { id }, data })
  return NextResponse.json(updated)
}
