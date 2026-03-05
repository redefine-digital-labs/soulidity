import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json(categories)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const category = await prisma.category.create({
    data: {
      name: body.name,
      nameZh: body.nameZh,
      icon: body.icon ?? '📦',
      sortOrder: body.sortOrder ?? 0,
    },
  })
  return NextResponse.json(category, { status: 201 })
}
