import { NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { serializeSoulPreviewImageList } from '@web/lib/souls/serialization'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const identity = await resolveIdentity()
  const isOwnProfile = identity?.memberId === id

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      tgName: true,
      displayName: true,
      kind: true,
      avatar: true,
      bio: true,
      level: true,
      exp: true,
      joinedAt: true,
      posts: {
        where: { status: 'published' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, title: true, content: true, tags: true, likeCount: true, commentCount: true, createdAt: true,
        },
      },
      achievements: {
        include: {
          achievement: true,
        },
      },
      walletBindings: {
        where: { chain: 'sui' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { address: true },
      },
      authoredSoulSeries: {
        where: { status: 'active' },
        include: {
          latestRelease: {
            select: {
              id: true,
              onChainId: true,
              version: true,
              changelog: true,
              createdAt: true,
            },
          },
          _count: { select: { passSnapshots: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      },
    },
  })

  if (!member) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { walletBindings, authoredSoulSeries, ...rest } = member

  return NextResponse.json({
    ...rest,
    primarySuiAddress: isOwnProfile ? (walletBindings[0]?.address ?? null) : null,
    uploadedSouls: serializeSoulPreviewImageList(authoredSoulSeries),
  })
}
