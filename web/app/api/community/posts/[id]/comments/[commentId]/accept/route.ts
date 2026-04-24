import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireIdentity } from '@/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const { id, commentId } = await params

  const post = await prisma.post.findFirst({ where: { id, status: 'published' }, select: { memberId: true, type: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.type !== 'question') return NextResponse.json({ error: 'Only questions can accept answers' }, { status: 400 })
  if (post.memberId !== identity!.memberId) return NextResponse.json({ error: 'Only author can accept' }, { status: 403 })

  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { postId: true } })
  if (!comment || comment.postId !== id) {
    return NextResponse.json({ error: 'Comment does not belong to this post' }, { status: 400 })
  }

  // Serialize concurrent accept operations on the same post via row lock + transaction
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "posts" WHERE "id" = ${id}::uuid FOR UPDATE`
    await tx.comment.updateMany({ where: { postId: id, isAccepted: true }, data: { isAccepted: false } })
    await tx.comment.update({ where: { id: commentId }, data: { isAccepted: true } })
  })

  return NextResponse.json({ ok: true })
}
