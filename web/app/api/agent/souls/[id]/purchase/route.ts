import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { isUuid } from '@web/lib/is-uuid'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { suiClient } from '@web/lib/sui'
import { selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { getVerifiedPricingPlanState, OnChainVerificationError, sameSuiValue } from '@web/lib/souls/on-chain-verification'
import { createPreparedSoulPurchase } from '@web/lib/souls/prepared-purchase'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { buildBuyPerpetualTx, buildBuySubscriptionTx } from '@web/lib/souls/tx-builder'

export const dynamic = 'force-dynamic'

const AGENT_PURCHASE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

/**
 * POST /api/agent/souls/[id]/purchase — Prepare a purchase TX for agent signing.
 *
 * Request: { planType: 'onetime' | 'subscription' }
 * Response: { preparedPurchaseId, txBytes, context }
 *
 * The agent signs txBytes locally and submits the resulting signature plus
 * preparedPurchaseId via POST .../purchase/execute.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response: authError } = await requireAgentApiKey(request)
  if (authError) return authError

  const rl = takeRateLimitToken(`agent-purchase:${agent.agentMemberId}`, AGENT_PURCHASE_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many purchase requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { planType } = body
  if (planType !== 'onetime' && planType !== 'subscription') {
    return NextResponse.json({ error: 'planType must be "onetime" or "subscription"' }, { status: 400 })
  }

  let platformConfigId: string
  let soulPackageId: string
  let usdcCoinType: string
  try {
    platformConfigId = getRequiredPublicEnv('NEXT_PUBLIC_PLATFORM_CONFIG_ID')
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
    usdcCoinType = getRequiredPublicEnv('NEXT_PUBLIC_USDC_COIN_TYPE')
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Purchase env config is missing' },
      { status: 503 },
    )
  }

  // Resolve series
  const { id } = await params
  const series = await prisma.soulSeries.findFirst({
    where: isUuid(id) ? { id } : { onChainId: id },
    include: {
      releases: { orderBy: { version: 'desc' }, take: 1 },
    },
  })

  if (!series || series.status !== 'active') {
    return NextResponse.json({ error: 'Series not found or inactive' }, { status: 404 })
  }

  // Resolve pricing plan
  const planOnChainId = planType === 'onetime'
    ? series.oneTimePlanOnChainId
    : series.subPlanOnChainId

  if (!planOnChainId) {
    return NextResponse.json({ error: `No ${planType} pricing plan for this series` }, { status: 404 })
  }

  let pricingPlan
  try {
    pricingPlan = await getVerifiedPricingPlanState(planOnChainId, soulPackageId)
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(error) },
        { status: error.status },
      )
    }
    throw error
  }

  if (!sameSuiValue(pricingPlan.seriesId, series.onChainId)) {
    return NextResponse.json({ error: 'Pricing plan does not belong to this Soul' }, { status: 422 })
  }
  if (pricingPlan.planType !== planType) {
    return NextResponse.json({ error: 'Pricing plan type does not match the requested purchase' }, { status: 422 })
  }
  if (!pricingPlan.active) {
    return NextResponse.json({ error: 'Pricing plan is not active on chain' }, { status: 422 })
  }

  // Resolve agent wallet
  const agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  const amountAtomic = pricingPlan.priceUsdc
  let paymentCoinIds: string[] | null
  try {
    paymentCoinIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
      owner: agentAddress,
      coinType: usdcCoinType,
      requiredAmount: amountAtomic,
    })
  } catch (error) {
    console.error('[agent-purchase] Failed to load agent coin balances', {
      error: toSafeErrorDetails(error),
      agentMemberId: agent.agentMemberId,
    })
    return NextResponse.json(
      { error: 'Unable to read the agent wallet balance from chain right now. Please retry.' },
      { status: 503 },
    )
  }
  if (paymentCoinIds?.length === 0) {
    return NextResponse.json({ error: 'Agent has no USDC. Fund the agent wallet first.' }, { status: 402 })
  }
  if (!paymentCoinIds) {
    return NextResponse.json(
      { error: 'Agent does not have enough USDC to cover this purchase.' },
      { status: 402 },
    )
  }

  // Build TX
  let tx
  if (planType === 'onetime') {
    const latestRelease = series.releases[0]
    if (!latestRelease?.onChainId) {
      return NextResponse.json({ error: 'No release available for purchase' }, { status: 404 })
    }
    tx = buildBuyPerpetualTx({
      platformConfigId,
      planId: planOnChainId,
      seriesId: series.onChainId,
      releaseId: latestRelease.onChainId,
      paymentCoinIds,
      amount: amountAtomic,
    })
  } else {
    tx = buildBuySubscriptionTx({
      platformConfigId,
      planId: planOnChainId,
      seriesId: series.onChainId,
      paymentCoinIds,
      amount: amountAtomic,
    })
  }

  // Set sender for proper TX serialization
  tx.setSender(agentAddress)

  const txBytes = await tx.build({ client: suiClient })
  const txBytesBase64 = Buffer.from(txBytes).toString('base64')
  const releaseOnChainId = planType === 'onetime' ? (series.releases[0]?.onChainId ?? null) : null
  const preparedPurchase = await createPreparedSoulPurchase({
    agentMemberId: agent.agentMemberId,
    agentAddress,
    amountUsdc: amountAtomic,
    txBytesBase64,
    planOnChainId: planOnChainId,
    planType,
    releaseOnChainId,
    seriesOnChainId: series.onChainId,
  })

  return NextResponse.json({
    preparedPurchaseId: preparedPurchase.id,
    txBytes: txBytesBase64,
    context: {
      planOnChainId: planOnChainId,
      planType,
      seriesOnChainId: series.onChainId,
      releaseOnChainId,
      amount: amountAtomic.toString(),
      agentAddress,
      expiresAt: preparedPurchase.expiresAt.toISOString(),
    },
  })
}
