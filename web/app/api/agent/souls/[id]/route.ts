import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  getMarketConfigV2,
  getAnimacraftProvenanceForState,
  getRequiredSoulidityEnv,
  quoteAnimacraftSoulPurchase,
  quoteSoulPurchase,
} from '@soulidity/sdk'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
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
  let platformFeeBps: number | null = null
  let animacraftProvenance = null
  const listedPrice = soul.listedPriceAtomic != null ? BigInt(soul.listedPriceAtomic.toString()) : null
  try {
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    if (soul.provenanceKind === 'animacraft') {
      animacraftProvenance = await getAnimacraftProvenanceForState(
        soul.stateOnChainId,
        getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID'),
      )
    }
    if (soul.listingStatus === 'listed' && listedPrice != null && listedPrice > 0n) {
      if (soul.provenanceKind === 'animacraft') {
        if (!animacraftProvenance) throw new Error('Animacraft provenance is unavailable')
        const config = await getMarketConfigV2(
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'),
        )
        platformFeeBps = config.platformFeeBps
        const makerQuote = quoteAnimacraftSoulPurchase(config, {
          priceAtomic: listedPrice,
          makerRoyaltyBps: animacraftProvenance.makerRoyaltyBps,
          collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
        })
        quote = {
          ...makerQuote,
          creatorRoyaltyAtomic: makerQuote.makerRoyaltyAtomic,
          makerRoyaltyBps: animacraftProvenance.makerRoyaltyBps,
          royaltySource: 'animacraft-maker' as const,
        }
      } else {
        const config = await getMarketConfigV2(
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'),
        )
        platformFeeBps = config.platformFeeBps
        quote = {
          ...quoteSoulPurchase(config, {
            priceAtomic: listedPrice,
            creatorRoyaltyBps: soul.creatorRoyaltyBps,
            collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
          }),
          royaltySource: 'soul-creator' as const,
        }
      }
    }
  } catch {
    // A quote is optional, but an Animacraft purchase remains fail-closed
    // because the purchase endpoint independently requires provenance.
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: auth.agent.agentMemberId,
    viewerAddresses: auth.walletAddresses,
    quote,
    platformFeeBps,
    animacraftProvenance,
  })

  return NextResponse.json(detail)
}
