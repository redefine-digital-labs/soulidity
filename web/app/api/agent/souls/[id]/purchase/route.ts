import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { suiClient } from '@web/lib/sui'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { createPreparedSoulPurchase } from '@web/lib/souls/prepared-purchase'
import { getSoulPurchaseQuote, getSoulSecondaryPurchaseQuote } from '@web/lib/souls/purchase-quote'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { buildBuySoulTx, buildBuySecondarySoulTx } from '@web/lib/souls/tx-builder'

export const dynamic = 'force-dynamic'

const PURCHASE_GAS_BUDGET_BUFFER_MIST = 50_000_000n // 0.05 SUI

const AGENT_PURCHASE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

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
    const isSecondary = soul.listingSource === 'core'
    const quote = isSecondary
      ? await getSoulSecondaryPurchaseQuote({ priceSui: BigInt(soul.listedPriceSui!.toString()) })
      : await getSoulPurchaseQuote({ sellerKioskId: soul.sellerKioskId!, soulObjectId: soul.onChainId })
    const feeAmountSui = quote.totalSui - quote.priceSui

    const balance = await suiClient.getBalance({ owner: agentAddress })
    const requiredBalance = quote.totalSui + PURCHASE_GAS_BUDGET_BUFFER_MIST
    if (BigInt(balance.totalBalance) < requiredBalance) {
      return NextResponse.json(
        { error: `Insufficient SUI balance for purchase. Required: ${requiredBalance} MIST (includes gas reserve), available: ${balance.totalBalance} MIST.` },
        { status: 402 },
      )
    }

    const txParams = {
      soulObjectId: soul.onChainId,
      sellerKioskId: soul.sellerKioskId!,
      buyerAddress: agentAddress,
      priceSui: quote.priceSui,
      feeAmountSui,
    }
    const tx = isSecondary ? buildBuySecondarySoulTx(txParams) : buildBuySoulTx(txParams)
    tx.setSender(agentAddress)

    const txBytes = await tx.build({ client: suiClient })
    const txBytesBase64 = Buffer.from(txBytes).toString('base64')
    const preparedPurchase = await createPreparedSoulPurchase({
      agentMemberId: agent.agentMemberId,
        soulOnChainId: soul.onChainId,
        sellerKioskId: soul.sellerKioskId,
        agentAddress,
        priceSui: quote.priceSui,
        txBytesBase64,
      })

    return NextResponse.json({
      preparedPurchaseId: preparedPurchase.id,
      txBytes: txBytesBase64,
      context: {
        soulOnChainId: soul.onChainId,
        sellerKioskId: soul.sellerKioskId,
        priceSui: quote.priceSui.toString(),
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
