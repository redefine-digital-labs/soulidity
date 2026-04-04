import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const { id, commentId } = await params

  const post = await prisma.post.findUnique({ where: { id }, select: { memberId: true, type: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.type !== 'question') return NextResponse.json({ error: 'Only questions can accept answers' }, { status: 400 })
  if (post.memberId !== identity!.memberId) return NextResponse.json({ error: 'Only author can accept' }, { status: 403 })

  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { postId: true } })
  if (!comment || comment.postId !== id) {
    return NextResponse.json({ error: 'Comment does not belong to this post' }, { status: 400 })
  }

  await prisma.comment.updateMany({ where: { postId: id, isAccepted: true }, data: { isAccepted: false } })
  await prisma.comment.update({ where: { id: commentId }, data: { isAccepted: true } })

  return NextResponse.json({ ok: true })
}
