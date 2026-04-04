import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { getMarketConfig, quoteSoulPurchase } from '@/lib/soulidity/queries'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_DETAIL_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-detail:${auth.agent.agentMemberId}`,
    AGENT_DETAIL_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent detail requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  let quote = null
  if (soul.listingStatus === 'listed' && soul.listedPriceAtomic) {
    try {
      const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      const configId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
      const config = await getMarketConfig(configId, packageId)
      quote = quoteSoulPurchase(config, {
        priceAtomic: BigInt(soul.listedPriceAtomic.toString()),
        creatorRoyaltyBps: soul.creatorRoyaltyBps,
        collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
      })
    } catch {
      // quote is optional
    }
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: auth.agent.agentMemberId,
    viewerAddresses: auth.walletAddresses,
    quote,
  })

  return NextResponse.json(detail)
}
