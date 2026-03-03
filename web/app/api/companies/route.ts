import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category')
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '100')

  const companies = await prisma.company.findMany({
    where: category ? { category } : undefined,
    orderBy: { mentionCount: 'desc' },
    take: limit,
  })
  return NextResponse.json(companies)
}
