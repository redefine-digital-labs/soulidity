import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category')
  const sort = request.nextUrl.searchParams.get('sort') ?? 'userCount'
  const featured = request.nextUrl.searchParams.get('featured')

  const where: any = { status: 'active' }
  if (category) {
    where.category = { name: category }
  }
  if (featured === 'true') {
    where.featured = true
  }

  const orderBy: any = sort === 'rating' ? { rating: 'desc' } :
                        sort === 'newest' ? { createdAt: 'desc' } :
                        { userCount: 'desc' }

  const directions = await prisma.direction.findMany({
    where,
    orderBy,
    include: {
      category: { select: { name: true, nameZh: true, icon: true } },
    },
  })

  return NextResponse.json(directions)
}
