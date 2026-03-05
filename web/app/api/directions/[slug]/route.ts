import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const direction = await prisma.direction.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, nameZh: true, icon: true } },
    },
  })

  if (!direction) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(direction)
}
