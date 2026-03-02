import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status')
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50')

  const articles = await prisma.article.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json(articles)
}
