import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireIdentity, resolveIdentity } from '@/lib/auth/identity'
import { resolveMemberSpaceId } from '@/lib/community/resolve-space'

export const dynamic = 'force-dynamic'

// GET /api/community/follow?memberId=xxx
// Returns follow status + counts for a given member
export async function GET(request: NextRequest) {
  try {
  const rawMemberId = request.nextUrl.searchParams.get('memberId')
  if (!rawMemberId) {
    return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  }
  const memberId = await resolveMemberSpaceId(rawMemberId)
  if (!memberId) {
    return NextResponse.json({ isFollowing: false, followerCount: 0, followingCount: 0 })
  }

  const [followerCount, followingCount] = await Promise.all([
    prisma.follow.count({ where: { followingId: memberId } }),
    prisma.follow.count({ where: { followerId: memberId } }),
  ])

  const identity = await resolveIdentity()
  let isFollowing = false
  if (identity) {
    const row = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: identity.memberId,
          followingId: memberId,
        },
      },
      select: { id: true },
    })
    isFollowing = !!row
  }

  return NextResponse.json({ isFollowing, followerCount, followingCount })
  } catch (e: any) {
    console.error('[GET /api/community/follow] Unhandled error:', e)
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 })
  }
}

// POST /api/community/follow
// Body: { targetMemberId: string }
// Toggles follow state. Returns { following: boolean, followerCount: number }
export async function POST(request: NextRequest) {
  try {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const body = await request.json()
  const rawTargetMemberId: string | undefined = body.targetMemberId
  if (!rawTargetMemberId || typeof rawTargetMemberId !== 'string') {
    return NextResponse.json({ error: 'targetMemberId required' }, { status: 400 })
  }
  const targetMemberId = await resolveMemberSpaceId(rawTargetMemberId)
  if (!targetMemberId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (targetMemberId === identity!.memberId) {
    return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 })
  }

  const existing = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: identity!.memberId,
        followingId: targetMemberId,
      },
    },
  })

  let following: boolean
  if (existing) {
    try {
      await prisma.follow.delete({ where: { id: existing.id } })
    } catch (e: any) {
      if (e?.code !== 'P2025') throw e // already deleted by concurrent request
    }
    following = false
  } else {
    try {
      await prisma.follow.create({
        data: {
          followerId: identity!.memberId,
          followingId: targetMemberId,
        },
      })
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e // already created by concurrent request
    }
    following = true
  }

  const followerCount = await prisma.follow.count({ where: { followingId: targetMemberId } })

  return NextResponse.json({ following, followerCount })
  } catch (e: any) {
    console.error('[POST /api/community/follow] Unhandled error:', e)
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 })
  }
}
