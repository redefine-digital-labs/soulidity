import { NextResponse } from 'next/server'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  findSoulCollectionDetailByRouteId,
  toSoulCollectionDetail,
} from '@/lib/soulidity/repository'
import { getMarketConfig, quoteCollectionPurchase } from '@/lib/soulidity/queries'

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
  const collection = await findSoulCollectionDetailByRouteId(id)
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  }

  const detail = toSoulCollectionDetail(collection)
  const quote = collection.listingStatus === 'listed' && collection.listedPriceAtomic != null
    ? quoteCollectionPurchase(
        await getMarketConfig(
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'),
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
        ),
        { priceAtomic: BigInt(collection.listedPriceAtomic.toString()) },
      )
    : null

  return NextResponse.json({
    ...detail,
    quote,
  })
}
