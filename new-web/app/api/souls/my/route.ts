import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { prisma } from '@web/lib/prisma'
import {
  soulAssetSummarySelect,
  soulCollectionSummarySelect,
  soulGrantRecordSelect,
  toSoulAssetSummary,
  toSoulCollectionSummaryList,
} from '@/lib/soulidity/repository'
export const dynamic = 'force-dynamic'

const mySoulSelect = {
  ...soulAssetSummarySelect,
  collection: {
    select: { name: true },
  },
  grantRecords: {
    select: { granteeAddress: true, createdAt: true },
    where: { status: 'active' as const },
    orderBy: { createdAt: 'desc' as const },
    take: 3,
  },
} as const

export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)

  const [owned, collections, grants] = await Promise.all([
    prisma.soulAsset.findMany({
      where: { currentOwnerMemberId: identity.memberId },
      select: mySoulSelect,
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
    owned: owned.map((r) => ({
      ...toSoulAssetSummary(r),
      collectionName: r.collection?.name ?? null,
      activeGrantDetails: r.grantRecords.map((g: { granteeAddress: string; createdAt: Date }) => ({
        granteeAddress: g.granteeAddress,
        createdAt: g.createdAt.toISOString(),
      })),
    })),
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
