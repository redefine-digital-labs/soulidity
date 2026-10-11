import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  getMarketConfigV2,
  getRequiredSoulidityEnv,
  quoteSoulPurchase,
} from '@soulidity/sdk'
import { readNativeMarketSnapshot } from '@/lib/animacraft/native-market'
import { createNativeReceiveClient, readNativeReceiveTarget } from '@/lib/animacraft/native-receive'
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
  let currentOwnershipEpoch: number | null = null
  try {
    if (soul.provenanceKind === 'animacraft') {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)])
      const snapshot = await readNativeMarketSnapshot(createNativeReceiveClient(signal), readNativeReceiveTarget(), {
        soulId: soul.onChainId, stateId: soul.stateOnChainId,
        marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
        listingId: soul.listingObjectOnChainId,
      }, signal)
      platformFeeBps = snapshot.nativeFeePolicyValid ? snapshot.protocolFeeBps : null
      quote = snapshot.purchaseAvailable ? snapshot.listing!.quote : null
      const epoch = Number(snapshot.ownershipEpoch)
      currentOwnershipEpoch = Number.isSafeInteger(epoch) ? epoch : null
    } else {
      const listedPrice = soul.listedPriceAtomic != null ? BigInt(soul.listedPriceAtomic.toString()) : null
      if (soul.listingStatus === 'listed' && listedPrice != null && listedPrice > 0n) {
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
    // Detail remains available without a quote; native evidence failure never
    // falls back to cached prices or superseded provenance/royalty paths.
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: auth.agent.agentMemberId,
    viewerAddresses: auth.walletAddresses,
    quote,
    platformFeeBps,
    currentOwnershipEpoch,
  })

  return NextResponse.json(detail)
}
