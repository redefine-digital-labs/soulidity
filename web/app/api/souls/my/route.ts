import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import { prisma } from '@/lib/prisma'
import {
  soulAssetSummarySelect,
  soulCollectionSummarySelect,
  soulGrantRecordSelect,
  toSoulAssetSummary,
  toSoulCollectionSummaryList,
  toSoulGrantRecord,
} from '@/lib/soulidity/repository'
export const dynamic = 'force-dynamic'

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function jsonString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

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

  const [owned, collections, purchases, grants] = await Promise.all([
    prisma.soulAsset.findMany({
      where: {
        OR: [
          { currentOwnerMemberId: identity.memberId },
          ...(walletAddresses.length > 0 ? [{ currentOwnerAddress: { in: walletAddresses } }] : []),
        ],
      },
      select: mySoulSelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.soulCollectionAsset.findMany({
      where: {
        OR: [
          { creatorMemberId: identity.memberId },
          { currentHolderMemberId: identity.memberId },
          ...(walletAddresses.length > 0
            ? [
                { creatorAddress: { in: walletAddresses } },
                { currentHolderAddress: { in: walletAddresses } },
              ]
            : []),
        ],
      },
      select: soulCollectionSummarySelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.soulTxSync.findMany({
      where: {
        routeKey: 'buy',
        actorKey: identity.memberId,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
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

  const ownedNamesByOnChainId = new Map(owned.map((soul) => [soul.onChainId, soul.name]))

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
    purchases: purchases.map((purchase) => {
      const body = jsonRecord(purchase.responseBody)
      const soulOnChainId = jsonString(body.soulOnChainId) ?? purchase.resourceKey
      return {
        id: purchase.id,
        txDigest: purchase.txDigest,
        soulOnChainId,
        soulName: ownedNamesByOnChainId.get(soulOnChainId) ?? null,
        paidAtomic: jsonString(body.paidAtomic),
        totalAtomic: jsonString(body.totalAtomic),
        createdAt: purchase.createdAt.toISOString(),
      }
    }),
    grants: grants.map(toSoulGrantRecord),
  })
}
