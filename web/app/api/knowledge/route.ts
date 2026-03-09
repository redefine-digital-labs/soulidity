import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const contentType = searchParams.get('contentType')
  const q = searchParams.get('q')

  const where: any = { status: 'raw', mergedIntoId: null }
  if (category) where.category = category
  if (contentType) where.contentType = contentType
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
    ]
  }

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    include: {
      sources: {
        include: {
          rawItem: { select: { url: true, sourceName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json(entries)
}
