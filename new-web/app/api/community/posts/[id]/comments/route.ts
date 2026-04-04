import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const { id } = await params
  const body = await request.json()

  if (!body.content || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content required' }, { status: 400 })
  }

  const content = body.content.trim()
  if (content.length === 0 || content.length > 10_000) {
    return NextResponse.json({ error: 'content must be 1-10000 characters' }, { status: 400 })
  }

  const [comment] = await prisma.$transaction([
    prisma.comment.create({
      data: {
        postId: id,
        memberId: identity!.memberId,
        content,
      },
    }),
    prisma.post.update({
      where: { id },
      data: { commentCount: { increment: 1 } },
    }),
  ])

  return NextResponse.json(comment, { status: 201 })
}
