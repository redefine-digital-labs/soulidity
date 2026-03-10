import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { id, commentId } = await params
  const body = await request.json()

  if (!body.memberId) {
    return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  }

  const post = await prisma.post.findUnique({ where: { id }, select: { memberId: true, type: true } })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.type !== 'question') return NextResponse.json({ error: 'Only questions can accept answers' }, { status: 400 })
  if (post.memberId !== body.memberId) return NextResponse.json({ error: 'Only author can accept' }, { status: 403 })

  await prisma.comment.updateMany({ where: { postId: id, isAccepted: true }, data: { isAccepted: false } })
  await prisma.comment.update({ where: { id: commentId }, data: { isAccepted: true } })

  return NextResponse.json({ ok: true })
}
