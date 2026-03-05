import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      _count: { select: { directions: true } },
    },
  })
  return NextResponse.json(categories)
}
