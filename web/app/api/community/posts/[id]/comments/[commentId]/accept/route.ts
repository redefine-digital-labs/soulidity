import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAuth } from '@web/lib/auth/require-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { error, session } = await requireAuth()
  if (error) return error

  const { id, commentId } = await params

  const post = await prisma.post.findUnique({ where: { id }, select: { memberId: true, type: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.type !== 'question') return NextResponse.json({ error: 'Only questions can accept answers' }, { status: 400 })
  if (post.memberId !== session!.memberId) return NextResponse.json({ error: 'Only author can accept' }, { status: 403 })

  await prisma.comment.updateMany({ where: { postId: id, isAccepted: true }, data: { isAccepted: false } })
  await prisma.comment.update({ where: { id: commentId }, data: { isAccepted: true } })

  return NextResponse.json({ ok: true })
}
