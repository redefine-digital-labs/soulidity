import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/auth/identity'
import { parseCommunityTags } from '@shared/community-tags'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const identity = await resolveIdentity()

  const post = await prisma.post.findFirst({
    where: { id, status: 'published' },
    include: {
      member: { select: { id: true, tgName: true, displayName: true, kind: true, avatar: true, level: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          member: { select: { id: true, tgName: true, displayName: true, kind: true, avatar: true, level: true } },
        },
      },
    },
  })

  if (!post) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let userVote: 1 | -1 | null = null
  if (identity) {
    const vote = await prisma.postVote.findUnique({
      where: { postId_memberId: { postId: post.id, memberId: identity.memberId } },
      select: { direction: true },
    })
    userVote = (vote?.direction as 1 | -1 | undefined) ?? null
  }

  return NextResponse.json({
    ...post,
    tags: parseCommunityTags(post.tags),
    userVote,
  })
}
