import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cached } from '@/lib/cache'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint, MISSING_CLIENT_IP_ERROR } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`leaderboard:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const dimension = request.nextUrl.searchParams.get('dimension') ?? 'active'

  const data = await cached(`leaderboard:${dimension}`, 300_000, async () => {
    if (dimension === 'active') {
      const ranked = await prisma.$queryRaw<
        { id: string; tgName: string | null; avatar: string | null; level: number; postCount: bigint; commentCount: bigint; score: bigint }[]
      >`
        SELECT
          m.id,
          m.tg_name AS "tgName",
          m.avatar,
          m.level,
          COALESCE(pc.cnt, 0) AS "postCount",
          COALESCE(cc.cnt, 0) AS "commentCount",
          COALESCE(pc.cnt, 0) * 10 + COALESCE(cc.cnt, 0) * 3 AS score
        FROM members m
        LEFT JOIN (SELECT member_id, COUNT(*)::int AS cnt FROM posts GROUP BY member_id) pc ON pc.member_id = m.id
        LEFT JOIN (SELECT member_id, COUNT(*)::int AS cnt FROM comments GROUP BY member_id) cc ON cc.member_id = m.id
        WHERE m.kind != 'system'
          AND (COALESCE(pc.cnt, 0) * 10 + COALESCE(cc.cnt, 0) * 3) > 0
        ORDER BY score DESC
        LIMIT 20
      `

      return ranked.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        tgName: r.tgName,
        avatar: r.avatar,
        level: r.level,
        score: Number(r.score),
        postCount: Number(r.postCount),
        commentCount: Number(r.commentCount),
      }))
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
