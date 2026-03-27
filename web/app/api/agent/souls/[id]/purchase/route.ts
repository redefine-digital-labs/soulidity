import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { suiClient } from '@web/lib/sui'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { getVerifiedMarketConfigState, OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { createPreparedSoulPurchase } from '@web/lib/souls/prepared-purchase'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { buildBuySoulTx } from '@web/lib/souls/tx-builder'

export const dynamic = 'force-dynamic'

const AGENT_PURCHASE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

function calculateFeeAmount(priceSui: bigint, bps: bigint): bigint {
  return (priceSui * bps) / 10_000n
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response: authError } = await requireAgentApiKey(request)
  if (authError) return authError

  const rl = await takeRateLimitToken(`agent-purchase:${agent.agentMemberId}`, AGENT_PURCHASE_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many purchase requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul || soul.listingStatus !== 'listed' || !soul.sellerKioskId || soul.listedPriceSui == null) {
    return NextResponse.json({ error: 'Soul is not currently listed for sale' }, { status: 404 })
  }

  let soulPackageId: string
  let marketConfigId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
    marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  } catch (configError) {
    return NextResponse.json(
      { error: configError instanceof Error ? configError.message : 'Purchase env config is missing' },
      { status: 503 },
    )
  }

  let agentAddress: string | null
  try {
    agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  } catch (walletError) {
    if (walletError instanceof Error && walletError.name === 'MultipleSuiWalletBindingsError') {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  try {
    const priceSui = BigInt(soul.listedPriceSui.toString())
    const marketConfig = await getVerifiedMarketConfigState(marketConfigId, soulPackageId)
    const feeAmountSui =
      calculateFeeAmount(priceSui, marketConfig.platformFeeBps)
      + calculateFeeAmount(priceSui, marketConfig.royaltyBps)

    const balance = await suiClient.getBalance({ owner: agentAddress })
    if (BigInt(balance.totalBalance) < priceSui + feeAmountSui) {
      return NextResponse.json({ error: 'Agent does not have enough SUI to cover this purchase.' }, { status: 402 })
    }

    const tx = buildBuySoulTx({
      soulObjectId: soul.onChainId,
      sellerKioskId: soul.sellerKioskId,
      buyerAddress: agentAddress,
      priceSui,
      feeAmountSui,
    })
    tx.setSender(agentAddress)

    const txBytes = await tx.build({ client: suiClient })
    const txBytesBase64 = Buffer.from(txBytes).toString('base64')
    const preparedPurchase = await createPreparedSoulPurchase({
      agentMemberId: agent.agentMemberId,
      soulOnChainId: soul.onChainId,
      sellerKioskId: soul.sellerKioskId,
      agentAddress,
      priceSui,
      txBytesBase64,
    })

    return NextResponse.json({
      preparedPurchaseId: preparedPurchase.id,
      txBytes: txBytesBase64,
      context: {
        soulOnChainId: soul.onChainId,
        sellerKioskId: soul.sellerKioskId,
        priceSui: soul.listedPriceSui,
        feeAmountSui: feeAmountSui.toString(),
        agentAddress,
        expiresAt: preparedPurchase.expiresAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(error) },
        { status: error.status },
      )
    }

    console.error('[agent-purchase] Failed to prepare purchase', {
      error: toSafeErrorDetails(error),
      agentMemberId: agent.agentMemberId,
      soulOnChainId: soul.onChainId,
    })
    return NextResponse.json({ error: 'Unable to prepare agent purchase right now' }, { status: 503 })
  }
}
