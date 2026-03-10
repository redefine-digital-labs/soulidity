import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export async function GET() {
  const directions = await prisma.direction.findMany({
    orderBy: { createdAt: 'desc' },
    include: { category: { select: { id: true, name: true, nameZh: true, icon: true } } },
  })
  return NextResponse.json(directions)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const direction = await prisma.direction.create({
    data: {
      categoryId: body.categoryId,
      name: body.name,
      nameZh: body.nameZh,
      slug: body.slug ?? toSlug(body.name),
      description: body.description ?? null,
      descriptionZh: body.descriptionZh ?? null,
      icon: body.icon ?? '🔧',
      userCount: body.userCount ?? 0,
      rating: body.rating ?? 0,
      featured: body.featured ?? false,
    },
  })
  return NextResponse.json(direction, { status: 201 })
}
