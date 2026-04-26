import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireMutationIdentity } from '@/lib/auth/identity'
import { takeRateLimitToken } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const VOTE_RATE_LIMIT = { max: 30, windowMs: 60 * 1000 } as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireMutationIdentity(request)
  if (error) return error

  const { limited, retryAfterSeconds } = await takeRateLimitToken(
    `community-vote:${identity.memberId}`,
    VOTE_RATE_LIMIT,
  )
  if (limited) {
    return NextResponse.json(
      { error: 'Vote rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const { id: postId } = await params
  const body = await request.json()
  const direction = body.direction

  if (direction !== 1 && direction !== -1) {
    return NextResponse.json({ error: 'direction must be 1 or -1' }, { status: 400 })
  }

  // Check post exists and is published
  const post = await prisma.post.findFirst({ where: { id: postId, status: 'published' }, select: { id: true } })
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Serialize concurrent votes on the same post via row lock + transaction.
  // Uses atomic delta increments (not recount) so historical like_count from
  // before the post_votes table is preserved.
  const { likeCount, userVote } = await prisma.$transaction(async (tx) => {
    // Lock the post row to prevent interleaved updates
    await tx.$queryRaw`SELECT "id" FROM "posts" WHERE "id" = ${postId}::uuid FOR UPDATE`

    const existing = await tx.postVote.findUnique({
      where: { postId_memberId: { postId, memberId: identity.memberId } },
    })

    let delta: number
    let votedDirection: number | null

    if (existing && existing.direction === direction) {
      // Same direction = toggle off (unvote)
      await tx.postVote.delete({ where: { id: existing.id } })
      delta = -existing.direction
      votedDirection = null
    } else if (existing) {
      // Different direction = flip
      await tx.postVote.update({ where: { id: existing.id }, data: { direction } })
      delta = direction - existing.direction
      votedDirection = direction
    } else {
      // New vote
      await tx.postVote.create({ data: { postId, memberId: identity.memberId, direction } })
      delta = direction
      votedDirection = direction
    }

    // Atomic delta update — preserves historical like_count
    const [updated] = await tx.$queryRaw<[{ like_count: number }]>`
      UPDATE "posts"
      SET "like_count" = "like_count" + ${delta}
      WHERE "id" = ${postId}::uuid
      RETURNING "like_count"
    `

    return { likeCount: Number(updated.like_count), userVote: votedDirection }
  })

  return NextResponse.json({ likeCount, userVote })
}
