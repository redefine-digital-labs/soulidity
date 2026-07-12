import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  getAnimacraftProvenanceForState,
  getRequiredSoulidityEnv,
  quoteAnimacraftSoulPurchase,
  quoteSoulPurchase,
} from '@soulidity/sdk'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'
import { getCachedMarketConfig } from '@soulidity/sdk'

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
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    if (soul.provenanceKind === 'animacraft') {
      animacraftProvenance = await getAnimacraftProvenanceForState(soul.stateOnChainId, packageId)
    }
    if (soul.listingStatus === 'listed' && listedPrice != null && listedPrice > 0n) {
      const configId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
      const config = await getCachedMarketConfig(configId, packageId)
      platformFeeBps = config.platformFeeBps
      if (soul.provenanceKind === 'animacraft') {
        if (!animacraftProvenance) throw new Error('Animacraft provenance is unavailable')
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
