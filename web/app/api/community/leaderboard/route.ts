import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { cached } from '@web/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const dimension = request.nextUrl.searchParams.get('dimension') ?? 'active'

  const data = await cached(`leaderboard:${dimension}`, 300_000, async () => {
    if (dimension === 'active') {
      const members = await prisma.member.findMany({
        where: { kind: { not: 'system' } },
        select: {
          id: true,
          tgName: true,
          avatar: true,
          level: true,
          _count: { select: { posts: true, comments: true } },
        },
      })

      const ranked = members
        .map(m => ({
          rank: 0,
          id: m.id,
          tgName: m.tgName,
          avatar: m.avatar,
          level: m.level,
          score: m._count.posts * 10 + m._count.comments * 3,
          postCount: m._count.posts,
          commentCount: m._count.comments,
        }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
      ranked.forEach((r, i) => (r.rank = i + 1))

      return ranked
    }

    if (dimension === 'helpful') {
      const comments = await prisma.comment.groupBy({
        by: ['memberId'],
        where: { isAccepted: true, member: { kind: { not: 'system' } } },
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

      return comments.map((c, i) => ({
        rank: i + 1,
        ...memberMap.get(c.memberId),
        acceptedCount: c._count.id,
        score: c._count.id * 20,
      }))
    }

    return []
  })

  return NextResponse.json(data)
}
