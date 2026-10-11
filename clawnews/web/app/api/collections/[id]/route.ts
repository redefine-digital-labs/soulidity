import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import {
  findSoulCollectionDetailByRouteId,
  toSoulCollectionDetail,
} from '@/lib/soulidity/repository'
import { quoteCollectionPurchase } from '@soulidity/sdk'
import { getCachedMarketConfig } from '@soulidity/sdk'

export const dynamic = 'force-dynamic'

const COLLECTION_DETAIL_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const key = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (key) {
    const { limited, retryAfterSeconds } = await takeRateLimitToken(`collection-detail:${key}`, COLLECTION_DETAIL_RATE_LIMIT)
    if (limited) {
      return NextResponse.json(
        { error: 'Too many collection detail requests, try again later' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      )
    }
  }

  const { id } = await params

  // Resolve viewer identity (optional — anonymous viewers get isHolder=false, isCreator=false)
  const identity = await resolveIdentity()
  const viewerAddresses = identity
    ? await getMemberSuiWalletAddresses(identity.memberId).catch(() => [] as string[])
    : []

  const collection = await findSoulCollectionDetailByRouteId(id)
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  }

  const detail = toSoulCollectionDetail(collection)

  // Viewer ownership checks
  const isHolder = viewerAddresses.includes(detail.currentHolderAddress)
    || (identity != null && detail.currentHolderMemberId === identity.memberId)
  const isCreator = viewerAddresses.includes(detail.creatorAddress)
    || (identity != null && detail.creatorMemberId === identity.memberId)

  // Aggregate stats: soul floor + soul holders
  const [floorResult, holdersResult] = await Promise.all([
    prisma.soulAsset.aggregate({
      where: { collectionOnChainId: detail.onChainId, listingStatus: 'listed' },
      _min: { listedPriceAtomic: true },
    }),
    prisma.soulAsset.groupBy({
      by: ['currentOwnerAddress'],
      where: { collectionOnChainId: detail.onChainId },
    }),
  ])

  const stats = {
    soulFloorAtomic: floorResult._min.listedPriceAtomic?.toString() ?? null,
    soulHolders: holdersResult.length,
    soulVolume: null as string | null,
  }

  const quote = collection.listingStatus === 'listed' && collection.listedPriceAtomic != null
    ? quoteCollectionPurchase(
        await getCachedMarketConfig(
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'),
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
        ),
        { priceAtomic: BigInt(collection.listedPriceAtomic.toString()) },
      )
    : null

  return NextResponse.json({
    ...detail,
    quote,
    isHolder,
    isCreator,
    stats,
  })
}
