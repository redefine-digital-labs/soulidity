import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, tgName: true, displayName: true, kind: true, avatar: true, level: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: {
          member: { select: { id: true, tgName: true, displayName: true, kind: true, avatar: true, level: true } },
        },
      },
    },
  })

  if (!post) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(post)
}
