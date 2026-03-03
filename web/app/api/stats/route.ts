import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [raw_new, articles_draft, articles_reviewed, published_today, companies_total] = await Promise.all([
    prisma.rawItem.count({ where: { status: 'new' } }),
    prisma.article.count({ where: { status: 'draft' } }),
    prisma.article.count({ where: { status: 'reviewed' } }),
    prisma.publication.count({ where: { publishedAt: { gte: today } } }),
    prisma.company.count(),
  ])

  return NextResponse.json({ raw_new, articles_draft, articles_reviewed, published_today, companies_total })
}
