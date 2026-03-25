import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { isUuid } from '@web/lib/is-uuid'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { suiClient } from '@web/lib/sui'
import { selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  getVerifiedPricingPlanState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { createPreparedSoulPurchase } from '@web/lib/souls/prepared-purchase'
import { parseRequiredObjectId } from '@web/lib/souls/request-validation'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { buildRenewSubscriptionTx } from '@web/lib/souls/tx-builder'

export const dynamic = 'force-dynamic'

const AGENT_RENEW_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

/**
 * POST /api/agent/souls/[id]/renew — Prepare a subscription renewal TX for agent signing.
 *
 * Request: { passOnChainId: string }
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

  const rl = await takeRateLimitToken(`agent-renew:${agent.agentMemberId}`, AGENT_RENEW_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many renew requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const passOnChainId = parseRequiredObjectId(body.passOnChainId)
  if (!passOnChainId) {
    return NextResponse.json({ error: 'passOnChainId is required and must be a valid Sui object ID' }, { status: 400 })
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
      { error: error instanceof Error ? error.message : 'Renew env config is missing' },
      { status: 503 },
    )
  }

  // Resolve series
  const { id } = await params
  const series = await prisma.soulSeries.findFirst({
    where: isUuid(id) ? { id } : { onChainId: id },
  })

  if (!series || series.status !== 'active') {
    return NextResponse.json({ error: 'Series not found or inactive' }, { status: 404 })
  }

  // Look up the pass
  const pass = await prisma.soulPassSnapshot.findFirst({
    where: {
      onChainId: passOnChainId,
      seriesId: series.id,
      passType: 'subscription',
      status: 'active',
    },
  })

  if (!pass) {
    return NextResponse.json({ error: 'Active subscription pass not found for this series' }, { status: 404 })
  }

  // Verify agent has access to this pass (owner or grant)
  const agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  const hasAccess = sameSuiValue(pass.ownerAddress, agentAddress)
    || (pass.agentGrant && sameSuiValue(pass.agentGrant, agentAddress))
  if (!hasAccess) {
    return NextResponse.json({ error: 'Agent does not have access to this pass' }, { status: 403 })
  }

  // Resolve pricing plan (always subscription for renew)
  const planOnChainId = series.subPlanOnChainId
  if (!planOnChainId) {
    return NextResponse.json({ error: 'No subscription pricing plan for this series' }, { status: 404 })
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
  if (pricingPlan.planType !== 'subscription') {
    return NextResponse.json({ error: 'Pricing plan is not a subscription plan' }, { status: 422 })
  }
  if (!pricingPlan.active) {
    return NextResponse.json({ error: 'Pricing plan is not active on chain' }, { status: 422 })
  }

  // Select payment coins
  const amountAtomic = pricingPlan.priceUsdc
  let paymentCoinIds: string[] | null
  try {
    paymentCoinIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
      owner: agentAddress,
      coinType: usdcCoinType,
      requiredAmount: amountAtomic,
    })
  } catch (error) {
    console.error('[agent-renew] Failed to load agent coin balances', {
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
      { error: 'Agent does not have enough USDC to cover this renewal.' },
      { status: 402 },
    )
  }

  // Build TX
  const tx = buildRenewSubscriptionTx({
    platformConfigId,
    planId: planOnChainId,
    seriesId: series.onChainId,
    passId: passOnChainId,
    paymentCoinIds,
    amount: amountAtomic,
  })

  // Set sender for proper TX serialization
  tx.setSender(agentAddress)

  const txBytes = await tx.build({ client: suiClient })
  const txBytesBase64 = Buffer.from(txBytes).toString('base64')

  const preparedPurchase = await createPreparedSoulPurchase({
    agentMemberId: agent.agentMemberId,
    agentAddress,
    amountUsdc: amountAtomic,
    txBytesBase64,
    planOnChainId,
    planType: 'subscription',
    releaseOnChainId: null,
    passOnChainId,
    seriesOnChainId: series.onChainId,
  })

  return NextResponse.json({
    preparedPurchaseId: preparedPurchase.id,
    txBytes: txBytesBase64,
    context: {
      planOnChainId,
      planType: 'subscription',
      seriesOnChainId: series.onChainId,
      releaseOnChainId: null,
      passOnChainId,
      amount: amountAtomic.toString(),
      agentAddress,
      expiresAt: preparedPurchase.expiresAt.toISOString(),
    },
  })
}
