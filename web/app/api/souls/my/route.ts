import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@web/lib/souls/repository'

export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  const [authored, owned] = await Promise.all([
    prisma.soulAsset.findMany({
      where: { creatorMemberId: identity.memberId },
      select: soulAssetSummarySelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.soulAsset.findMany({
      where: { currentOwnerMemberId: identity.memberId },
      select: soulAssetSummarySelect,
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return NextResponse.json({
    authored: toSoulAssetSummaryList(authored),
    owned: toSoulAssetSummaryList(owned),
  })
}
