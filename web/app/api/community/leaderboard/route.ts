import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const dimension = request.nextUrl.searchParams.get('dimension') ?? 'active'
  const directionId = request.nextUrl.searchParams.get('directionId')

  if (dimension === 'active') {
    const members = await prisma.member.findMany({
      select: {
        id: true,
        tgName: true,
        avatar: true,
        level: true,
        exp: true,
        _count: { select: { posts: true, comments: true } },
      },
      orderBy: { exp: 'desc' },
      take: 20,
    })

    const ranked = members.map((m, i) => ({
      rank: i + 1,
      id: m.id,
      tgName: m.tgName,
      avatar: m.avatar,
      level: m.level,
      score: m._count.posts * 10 + m._count.comments * 3,
      postCount: m._count.posts,
      commentCount: m._count.comments,
    }))
    ranked.sort((a, b) => b.score - a.score)
    ranked.forEach((r, i) => (r.rank = i + 1))

    return NextResponse.json(ranked)
  }

  if (dimension === 'helpful') {
    const comments = await prisma.comment.groupBy({
      by: ['memberId'],
      where: { isAccepted: true },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    })

    const memberIds = comments.map(c => c.memberId)
    const members = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, tgName: true, avatar: true, level: true },
    })
    const memberMap = new Map(members.map(m => [m.id, m]))

    const ranked = comments.map((c, i) => ({
      rank: i + 1,
      ...memberMap.get(c.memberId),
      acceptedCount: c._count.id,
      score: c._count.id * 20,
    }))

    return NextResponse.json(ranked)
  }

  if (dimension === 'direction' && directionId) {
    const posts = await prisma.post.groupBy({
      by: ['memberId'],
      where: { directionId, status: 'published' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    })

    const memberIds = posts.map(p => p.memberId)
    const members = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, tgName: true, avatar: true, level: true },
    })
    const memberMap = new Map(members.map(m => [m.id, m]))

    const ranked = posts.map((p, i) => ({
      rank: i + 1,
      ...memberMap.get(p.memberId),
      postCount: p._count.id,
      score: p._count.id * 10,
    }))

    return NextResponse.json(ranked)
  }

  return NextResponse.json([])
}
