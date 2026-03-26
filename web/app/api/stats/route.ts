import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'

export async function GET() {
  const stats = await cached('stats', 60_000, async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [raw_new, articles_draft, articles_rejected, published_today, companies_total] = await Promise.all([
      prisma.rawItem.count({ where: { status: 'new' } }),
      prisma.article.count({ where: { status: 'draft' } }),
      prisma.article.count({ where: { status: 'rejected' } }),
      prisma.publication.count({ where: { publishedAt: { gte: today } } }),
      prisma.company.count(),
    ])

    return { raw_new, articles_draft, articles_rejected, published_today, companies_total }
  })

  return NextResponse.json(stats)
}
