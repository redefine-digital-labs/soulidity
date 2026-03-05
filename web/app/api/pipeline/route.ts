import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const articles = await prisma.article.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      rawItem: { select: { title: true, sourceName: true, score: true } },
      processLogs: {
        include: { role: { select: { name: true, label: true, sortOrder: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  return NextResponse.json(articles)
}
