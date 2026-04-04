import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { prisma } from '@web/lib/prisma'
import {
  soulAssetSummarySelect,
  soulCollectionSummarySelect,
  soulGrantRecordSelect,
  toSoulAssetSummaryList,
  toSoulCollectionSummaryList,
} from '@/lib/soulidity/repository'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)

  const [authored, owned, granted, collections, grants] = await Promise.all([
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
    prisma.soulAsset.findMany({
      where: {
        grantRecords: {
          some: {
            status: 'active',
            OR: [
              { granteeMemberId: identity.memberId },
              ...(walletAddresses.length > 0 ? [{ granteeAddress: { in: walletAddresses } }] : []),
            ],
          },
        },
        currentOwnerMemberId: {
          not: identity.memberId,
        },
      },
      select: soulAssetSummarySelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.soulCollectionAsset.findMany({
      where: {
        OR: [
          { creatorMemberId: identity.memberId },
          { currentHolderMemberId: identity.memberId },
        ],
      },
      select: soulCollectionSummarySelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.soulGrantRecord.findMany({
      where: {
        OR: [
          { issuedByMemberId: identity.memberId },
          { granteeMemberId: identity.memberId },
          ...(walletAddresses.length > 0 ? [{ granteeAddress: { in: walletAddresses } }] : []),
        ],
      },
      select: soulGrantRecordSelect,
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return NextResponse.json({
    authored: toSoulAssetSummaryList(authored),
    owned: toSoulAssetSummaryList(owned),
    granted: toSoulAssetSummaryList(granted),
    collections: toSoulCollectionSummaryList(collections),
    grants: grants.map((grant) => ({
      id: grant.id,
      onChainId: grant.onChainId,
      soulOnChainId: grant.soulOnChainId,
      issuedByAddress: grant.issuedByAddress,
      issuedByMemberId: grant.issuedByMemberId,
      granteeAddress: grant.granteeAddress,
      granteeMemberId: grant.granteeMemberId,
      scopes: grant.scopes.map((scope) => scope === 'skills' ? 'skills' : scope === 'memory' ? 'memory' : 'seal'),
      status: grant.status === 'revoked'
        ? 'revoked'
        : grant.status === 'expired'
          ? 'expired'
          : grant.status === 'superseded'
            ? 'superseded'
            : grant.status === 'invalidated'
              ? 'invalidated'
              : 'active',
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      endedAt: grant.endedAt?.toISOString() ?? null,
      replacedByGrantOnChainId: grant.replacedByGrantOnChainId,
      createdAt: grant.createdAt.toISOString(),
      updatedAt: grant.updatedAt.toISOString(),
    })),
  })
}
