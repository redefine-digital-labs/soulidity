import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'
import { isUuid } from '@web/lib/is-uuid'
import { serializeSoulPreviewImages } from '@web/lib/souls/serialization'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const where = isUuid(id)
    ? { OR: [{ id }, { onChainId: id }], status: 'active' as const }
    : { onChainId: id, status: 'active' as const }

  const series = await prisma.soulSeries.findFirst({
    where,
    include: {
      releases: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          onChainId: true,
          version: true,
          changelog: true,
          createdAt: true,
        },
      },
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
  })

  if (!series) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Check if current user has a pass
  let userPass = null
  try {
    const identity = await resolveIdentity()
    if (identity?.memberId) {
      const now = new Date()
      userPass = await prisma.soulPassSnapshot.findFirst({
        where: {
          seriesId: series.id,
          ownerMemberId: identity.memberId,
          status: 'active',
          NOT: {
            passType: 'subscription',
            expiresAt: { lt: now },
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
        },
      })
    }
  } catch {
    // Not authenticated — that's fine
  }

  return NextResponse.json({ ...serializeSoulPreviewImages(series), userPass })
}
