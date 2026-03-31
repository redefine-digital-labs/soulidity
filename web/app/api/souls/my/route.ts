import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { prisma } from '@web/lib/prisma'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@web/lib/souls/repository'

export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  const primaryWalletAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)

  const [authored, owned, allowlisted] = await Promise.all([
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
    primaryWalletAddress
      ? prisma.soulAsset.findMany({
          where: {
            allowlistAddress: primaryWalletAddress,
            NOT: { currentOwnerMemberId: identity.memberId },
          },
          select: soulAssetSummarySelect,
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    authored: toSoulAssetSummaryList(authored),
    owned: toSoulAssetSummaryList(owned),
    allowlisted: toSoulAssetSummaryList(allowlisted),
  })
}
