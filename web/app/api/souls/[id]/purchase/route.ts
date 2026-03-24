import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { isUuid } from '@web/lib/is-uuid'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { dbCreatePass } from '@web/lib/souls/post-tx-db'
import { parseRequiredObjectId, parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'
import {
  assertPassChange,
  getVerifiedPricingPlanState,
  getSuccessfulTransaction,
  getVerifiedPassState,
  getVerifiedSoulPurchaseIntents,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'

const SOUL_PURCHASE_MIRROR_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const
const MAX_SOUL_ROUTE_ID_LENGTH = 128

/**
 * POST /api/souls/[id]/purchase — Record a purchase after on-chain TX.
 *
 * Body: { passOnChainId, txDigest }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { identity, error } = await requireIdentity()
  if (error) return error
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Use the agent purchase API' }, { status: 403 })
  }

  const rateLimit = takeRateLimitToken(
    `soul-purchase-mirror:${identity.memberId}`,
    SOUL_PURCHASE_MIRROR_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many purchase sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (id.length > MAX_SOUL_ROUTE_ID_LENGTH) {
    return NextResponse.json({ error: 'Soul id is too long' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const passOnChainId = parseRequiredObjectId(body.passOnChainId)
  const txDigest = parseRequiredTxDigest(body.txDigest)

  if (!passOnChainId) {
    return NextResponse.json({ error: 'passOnChainId must be a valid on-chain object id' }, { status: 400 })
  }
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'purchase',
    actorKey: identity.memberId,
    resourceKey: passOnChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Soul package config is missing' },
      { status: 503 },
    )
  }

  // Resolve series by DB UUID or onChainId
  const series = await prisma.soulSeries.findFirst({
    where: isUuid(id) ? { id } : { onChainId: id },
    select: {
      onChainId: true,
    },
  })
  if (!series) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const ownerAddresses = await getMemberSuiWalletAddresses(identity.memberId)
  if (ownerAddresses.length === 0) {
    return NextResponse.json({ error: 'No Sui wallet bound to account' }, { status: 400 })
  }

  try {
    const transaction = await getSuccessfulTransaction(txDigest)
    assertPassChange(transaction, {
      passOnChainId,
      changeTypes: ['created'],
      errorMessage: 'Transaction did not create the submitted pass',
      expectedSender: ownerAddresses,
      expectedPackageId: soulPackageId,
    })

    const passState = await getVerifiedPassState(passOnChainId, soulPackageId)
    if (!sameSuiValue(passState.seriesId, series.onChainId)) {
      return NextResponse.json({ error: 'Created pass does not belong to the requested Soul' }, { status: 422 })
    }
    if (!ownerAddresses.some((address) => sameSuiValue(passState.ownerAddress, address))) {
      return NextResponse.json({ error: 'Created pass owner does not match the authenticated wallet' }, { status: 422 })
    }

    const matchingPurchaseIntent = getVerifiedSoulPurchaseIntents(transaction, soulPackageId).find((intent) => (
      sameSuiValue(intent.seriesId, series.onChainId)
      && (
        (
          passState.passType === 'perpetual'
          && intent.planType === 'onetime'
          && sameSuiValue(intent.releaseId, passState.lockedReleaseId)
        )
        || (
          passState.passType === 'subscription'
          && intent.planType === 'subscription'
        )
      )
    ))
    if (!matchingPurchaseIntent) {
      return NextResponse.json({ error: 'Transaction does not contain a matching Soul purchase for the verified pass' }, { status: 422 })
    }

    const pricingPlanState = await getVerifiedPricingPlanState(matchingPurchaseIntent.planId, soulPackageId)
    const planMatchesVerifiedPass =
      sameSuiValue(pricingPlanState.seriesId, series.onChainId)
      && (
        (passState.passType === 'perpetual' && pricingPlanState.planType === 'onetime')
        || (passState.passType === 'subscription' && pricingPlanState.planType === 'subscription')
      )
    if (!planMatchesVerifiedPass) {
      return NextResponse.json({ error: 'Verified pass does not match the purchase pricing plan recorded on chain' }, { status: 422 })
    }

    const responseBody = await prisma.$transaction(async (tx) => {
      const pass = await dbCreatePass({
        db: tx,
        passOnChainId: passState.objectId,
        seriesOnChainId: series.onChainId,
        ownerAddress: passState.ownerAddress,
        ownerMemberId: identity.memberId,
        passType: passState.passType,
        lockedReleaseId: passState.lockedReleaseId,
        mintTxDigest: transaction.digest ?? txDigest,
        ...(passState.expiresAt ? { expiresAt: passState.expiresAt } : {}),
      })

      const nextResponseBody = {
        id: pass.id,
        onChainId: pass.onChainId,
        passType: pass.passType,
      }

      await storeSoulTxSync({
        db: tx,
        txDigest,
        routeKey: 'purchase',
        actorKey: identity.memberId,
        resourceKey: passOnChainId,
        statusCode: 201,
        body: nextResponseBody,
      })

      return nextResponseBody
    }, { timeout: 30_000 })

    return NextResponse.json(responseBody, { status: 201 })
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(error) },
        { status: error.status },
      )
    }
    console.error('[soul-purchase-mirror] Sync failed', {
      memberId: identity.memberId,
      seriesId: id,
      passOnChainId,
      txDigest,
      error: toSafeErrorDetails(error),
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
