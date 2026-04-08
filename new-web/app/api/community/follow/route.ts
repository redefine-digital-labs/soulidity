import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity, resolveIdentity } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

// GET /api/community/follow?memberId=xxx
// Returns follow status + counts for a given member
export async function GET(request: NextRequest) {
  const memberId = request.nextUrl.searchParams.get('memberId')
  if (!memberId) {
    return NextResponse.json({ error: 'memberId required' }, { status: 400 })
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
}

// POST /api/community/follow
// Body: { targetMemberId: string }
// Toggles follow state. Returns { following: boolean, followerCount: number }
export async function POST(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const body = await request.json()
  const targetMemberId: string | undefined = body.targetMemberId
  if (!targetMemberId || typeof targetMemberId !== 'string') {
    return NextResponse.json({ error: 'targetMemberId required' }, { status: 400 })
  }

  if (targetMemberId === identity!.memberId) {
    return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 })
  }

  // Verify target exists
  const target = await prisma.member.findUnique({
    where: { id: targetMemberId },
    select: { id: true },
  })
  if (!target) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
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
}
