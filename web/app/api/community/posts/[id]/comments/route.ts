import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAuth } from '@web/lib/auth/require-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth()
  if (error) return error

  const { id } = await params
  const body = await request.json()

  if (!body.content) {
    return NextResponse.json({ error: 'content required' }, { status: 400 })
  }

  const comment = await prisma.comment.create({
    data: {
      postId: id,
      memberId: session!.memberId,
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
