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

  if (!body.content) {
    return NextResponse.json({ error: 'content required' }, { status: 400 })
  }

  const comment = await prisma.comment.create({
    data: {
      postId: id,
      memberId: identity!.memberId,
      content: body.content,
    },
  })

  // Increment comment count
  await prisma.post.update({
    where: { id },
    data: { commentCount: { increment: 1 } },
  })

  return NextResponse.json(comment, { status: 201 })
}
