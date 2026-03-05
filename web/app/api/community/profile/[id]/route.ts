import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const member = await prisma.member.findUnique({
    where: { id },
    include: {
      posts: {
        where: { status: 'published' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          direction: { select: { nameZh: true, icon: true } },
        },
      },
      achievements: {
        include: {
          achievement: true,
        },
      },
    },
  })

  if (!member) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(member)
}
