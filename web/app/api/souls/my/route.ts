import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { serializeSoulPreviewImageList, serializeSoulPreviewImages } from '@web/lib/souls/serialization'

const MAX_MY_SOULS_RESULTS = 100

export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const [published, passes] = await Promise.all([
    prisma.soulSeries.findMany({
      where: { authorMemberId: identity.memberId },
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
      take: MAX_MY_SOULS_RESULTS,
    }),
    prisma.soulPassSnapshot.findMany({
      where: {
        ownerMemberId: identity.memberId,
        status: 'active',
        NOT: {
          passType: 'subscription',
          expiresAt: { lt: new Date() },
        },
      },
      select: {
        id: true,
        onChainId: true,
        passType: true,
        lockedReleaseId: true,
        expiresAt: true,
        agentGrant: true,
        status: true,
        createdAt: true,
        series: {
          select: {
            id: true,
            name: true,
            category: true,
            previewImages: true,
            onChainId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_MY_SOULS_RESULTS,
    }),
  ])

  return NextResponse.json({
    published: serializeSoulPreviewImageList(published),
    passes: passes.map((pass) => ({
      ...pass,
      series: serializeSoulPreviewImages(pass.series),
    })),
  })
}
