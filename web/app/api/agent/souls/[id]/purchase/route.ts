import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { CoinPaginationExhaustedError, selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'
import { createPreparedSoulPurchase } from '@web/lib/souls/prepared-purchase'
import { resolveOwnedPersonalKiosk, SoulPersonalKioskInvariantError } from '@web/lib/souls/personal-kiosk'
import { getSoulPurchaseQuote } from '@web/lib/souls/purchase-quote'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { buildBuySoulTx } from '@web/lib/souls/tx-builder'
import { suiClient } from '@web/lib/sui'

export const dynamic = 'force-dynamic'

const PURCHASE_GAS_BUDGET_BUFFER_MIST = 50_000_000n // 0.05 SUI

const AGENT_PURCHASE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

function getPaymentCoinSymbol(coinType: string) {
  const parts = coinType.split('::')
  return parts.at(-1) ?? 'payment coin'
}

function getMissingPaymentCoinMessage(coinType: string) {
  return `No ${getPaymentCoinSymbol(coinType)} found in the agent wallet. You may need to acquire some first.`
}

function getCoinPaginationExhaustedMessage(coinType: string) {
  return `Too many ${getPaymentCoinSymbol(coinType)} coin objects to prepare this purchase automatically. Consolidate them and try again.`
}

function assertAgentPurchaseBuildConfig() {
  getRequiredPublicEnv('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID')
  return getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE')
}

async function assertListingStillActive(params: {
  tx: ReturnType<typeof buildBuySoulTx>
  buyerAddress: string
}) {
  const inspection = await suiClient.devInspectTransactionBlock({
    sender: params.buyerAddress,
    transactionBlock: params.tx,
  })

  if (inspection.error || (inspection.effects?.status?.status && inspection.effects.status.status !== 'success')) {
    throw new OnChainVerificationError('Soul listing is no longer active on chain')
  }
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
  if (!soul || soul.listingStatus !== 'listed' || soul.listedPriceAtomic == null || !soul.listingObjectOnChainId) {
    return NextResponse.json({ error: 'Soul is not currently listed for sale' }, { status: 404 })
  }
  if (!soul.currentKioskId) {
    return NextResponse.json({ error: 'Soul listing missing kiosk' }, { status: 409 })
  }

  let agentAddress: string | null
  try {
    agentAddress = await getMemberPrimarySuiWalletAddress(agent.agentMemberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  let paymentCoinType: string
  try {
    paymentCoinType = assertAgentPurchaseBuildConfig()
  } catch (configError) {
    return NextResponse.json(
      { error: configError instanceof Error ? configError.message : 'Service temporarily unavailable' },
      { status: 503 },
    )
  }

  try {
    const [resolvedBuyerKiosk, quote, gasBalance] = await Promise.all([
      resolveOwnedPersonalKiosk({ ownerAddresses: [agentAddress] }),
      getSoulPurchaseQuote({ listingObjectId: soul.listingObjectOnChainId }),
      suiClient.getBalance({ owner: agentAddress }),
    ])
    const paymentCoinSymbol = getPaymentCoinSymbol(paymentCoinType)
    const paymentCoinObjectIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
      owner: agentAddress,
      coinType: paymentCoinType,
      requiredAmount: quote.totalAtomic,
    })
    if (paymentCoinObjectIds === null) {
      const paymentBalance = await suiClient.getBalance({ owner: agentAddress, coinType: paymentCoinType })
      return NextResponse.json(
        {
          error: `Insufficient ${paymentCoinSymbol} balance for purchase. Required: ${quote.totalAtomic.toString()} atomic units, available: ${paymentBalance.totalBalance}.`,
        },
        { status: 402 },
      )
    }
    if (paymentCoinObjectIds.length === 0) {
      return NextResponse.json(
        { error: getMissingPaymentCoinMessage(paymentCoinType) },
        { status: 402 },
      )
    }

    if (BigInt(gasBalance.totalBalance) < PURCHASE_GAS_BUDGET_BUFFER_MIST) {
      return NextResponse.json(
        {
          error: `Insufficient SUI gas balance for purchase. Required reserve: ${PURCHASE_GAS_BUDGET_BUFFER_MIST} MIST, available: ${gasBalance.totalBalance} MIST.`,
        },
        { status: 402 },
      )
    }

    const txParams = {
      listingObjectId: soul.listingObjectOnChainId,
      sellerKioskId: soul.currentKioskId,
      totalAtomic: quote.totalAtomic,
      paymentCoinObjectIds,
      ...(resolvedBuyerKiosk.status === 'ready'
        ? {
            buyerKioskId: resolvedBuyerKiosk.kiosk.currentKioskId,
            buyerKioskCapOnChainId: resolvedBuyerKiosk.kiosk.currentKioskCapOnChainId,
          }
        : {}),
    }
    const tx = buildBuySoulTx(txParams)
    tx.setSender(agentAddress)
    await assertListingStillActive({
      tx,
      buyerAddress: agentAddress,
    })

    const txBytes = await tx.build({ client: suiClient })
    const txBytesBase64 = Buffer.from(txBytes).toString('base64')
    const preparedPurchase = await createPreparedSoulPurchase({
      agentMemberId: agent.agentMemberId,
      soulOnChainId: soul.onChainId,
      listingObjectId: soul.listingObjectOnChainId,
      sellerKioskId: soul.currentKioskId,
      agentAddress,
      priceAtomic: quote.priceAtomic,
      platformFeeAtomic: quote.platformFeeAtomic,
      creatorRoyaltyAtomic: quote.creatorRoyaltyAtomic,
      totalAtomic: quote.totalAtomic,
      txBytesBase64,
    })

    return NextResponse.json({
      preparedPurchaseId: preparedPurchase.id,
      txBytes: txBytesBase64,
      context: {
        soulOnChainId: soul.onChainId,
        listingObjectId: soul.listingObjectOnChainId,
        sellerKioskId: soul.currentKioskId,
        priceAtomic: quote.priceAtomic.toString(),
        platformFeeAtomic: quote.platformFeeAtomic.toString(),
        creatorRoyaltyAtomic: quote.creatorRoyaltyAtomic.toString(),
        totalAtomic: quote.totalAtomic.toString(),
        paymentCoinType,
        agentAddress,
        expiresAt: preparedPurchase.expiresAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof SoulPersonalKioskInvariantError && error.kind === 'conflict') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof CoinPaginationExhaustedError) {
      return NextResponse.json(
        { error: getCoinPaginationExhaustedMessage(paymentCoinType) },
        { status: 409 },
      )
    }
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
