import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { selectCoinObjectIdsForAmountAcrossPages } from '@/lib/soulidity/coin-selection'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getMarketConfig, quoteSoulPurchase } from '@/lib/soulidity/queries'
import { resolveOwnedPersonalKiosk } from '@/lib/soulidity/personal-kiosk'
import { buildBuySoulTx } from '@/lib/soulidity/tx/buy'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_PURCHASE_RATE_LIMIT = { max: 10, windowMs: 5 * 60 * 1000 } as const
const PREPARED_PURCHASE_TTL_MS = 10 * 60 * 1000
const PAYMENT_COIN_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-purchase:${auth.agent.agentMemberId}`,
    AGENT_PURCHASE_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent purchase requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }
  if (soul.listingStatus !== 'listed' || !soul.listingObjectOnChainId || !soul.listedPriceAtomic) {
    return NextResponse.json({ error: 'Soul is not listed for sale' }, { status: 409 })
  }

  const agentAddress = auth.walletAddresses[0]!
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const configId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')

  try {
    const config = await getMarketConfig(configId, packageId)
    const quote = quoteSoulPurchase(config, {
      priceAtomic: BigInt(soul.listedPriceAtomic.toString()),
      creatorRoyaltyBps: soul.creatorRoyaltyBps,
      collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
    })

    const kioskResult = await resolveOwnedPersonalKiosk({ ownerAddresses: auth.walletAddresses })
    const buyerKioskId = kioskResult.status === 'ready' ? kioskResult.kiosk.currentKioskId : null
    const buyerKioskCapOnChainId = kioskResult.status === 'ready' ? kioskResult.kiosk.currentKioskCapOnChainId : null

    const coinIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
      owner: agentAddress,
      coinType: PAYMENT_COIN_TYPE,
      requiredAmount: BigInt(quote.totalAtomic),
    })
    if (!coinIds || coinIds.length === 0) {
      return NextResponse.json({ error: 'Insufficient USDC balance for purchase' }, { status: 402 })
    }

    const tx = buildBuySoulTx({
      sellerKioskId: soul.currentKioskId,
      stateObjectId: soul.stateOnChainId,
      listingObjectId: soul.listingObjectOnChainId,
      totalAtomic: BigInt(quote.totalAtomic),
      paymentCoinObjectIds: coinIds,
      collectionObjectId: soul.collectionOnChainId ?? null,
      buyerKioskId,
      buyerKioskCapOnChainId,
    })
    tx.setSender(agentAddress)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-package @mysten/sui type mismatch (web/ vs new-web/)
    const txBytes = await tx.build({ client: suiClient as any })
    const txBytesBase64 = Buffer.from(txBytes).toString('base64')
    const txBytesHash = createHash('sha256').update(txBytes).digest('hex')
    const expiresAt = new Date(Date.now() + PREPARED_PURCHASE_TTL_MS)

    const prepared = await prisma.soulPreparedPurchase.create({
      data: {
        agentMemberId: auth.agent.agentMemberId,
        soulOnChainId: soul.onChainId,
        listingObjectId: soul.listingObjectOnChainId,
        sellerKioskId: soul.currentKioskId,
        agentAddress,
        priceAtomic: soul.listedPriceAtomic,
        platformFeeAtomic: quote.platformFeeAtomic,
        creatorRoyaltyAtomic: quote.creatorRoyaltyAtomic,
        totalAtomic: quote.totalAtomic,
        txBytesBase64,
        txBytesHash,
        expiresAt,
      },
    })

    return NextResponse.json({
      preparedPurchaseId: prepared.id,
      txBytes: txBytesBase64,
      context: {
        soulOnChainId: soul.onChainId,
        listingObjectId: soul.listingObjectOnChainId,
        sellerKioskId: soul.currentKioskId,
        priceAtomic: soul.listedPriceAtomic.toString(),
        platformFeeAtomic: quote.platformFeeAtomic.toString(),
        creatorRoyaltyAtomic: quote.creatorRoyaltyAtomic.toString(),
        totalAtomic: quote.totalAtomic.toString(),
        agentAddress,
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[agent-purchase-prepare] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to prepare purchase transaction' }, { status: 500 })
  }
}
