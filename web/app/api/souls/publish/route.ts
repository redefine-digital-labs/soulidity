import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { dbCreateSeries, dbCreateRelease, dbUpdatePricingPlan } from '@web/lib/souls/post-tx-db'
import { createAndStoreReleaseSealSidecar } from '@web/lib/souls/release-seal-sidecar'
import {
  parseOptionalObjectId,
  parseOptionalTxDigest,
  parseRequiredObjectId,
  parseRequiredTxDigest,
} from '@web/lib/souls/request-validation'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'
import {
  assertCreatedObjectChange,
  getVerifiedPricingPlanState,
  getSuccessfulTransaction,
  getVerifiedReleaseState,
  getVerifiedSeriesState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'

const SOUL_PUBLISH_MIRROR_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

/**
 * POST /api/souls/publish — Record a fully-published Soul (series + release + pricing).
 *
 * Called by the frontend after all on-chain TXs succeed.
 * Accepts on-chain object IDs and derives mirror fields from chain state.
 */
export async function POST(request: NextRequest) {
  const { identity, error } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can publish' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(
    `soul-publish-mirror:${identity.memberId}`,
    SOUL_PUBLISH_MIRROR_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many publish sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const txDigest = parseRequiredTxDigest(body.txDigest)
  const seriesOnChainId = parseRequiredObjectId(body.seriesOnChainId)
  const releaseOnChainId = parseOptionalObjectId(body.releaseOnChainId)
  const releaseTxDigest = parseOptionalTxDigest(body.releaseTxDigest)
  const oneTimePlanOnChainId = parseOptionalObjectId(body.oneTimePlanOnChainId)
  const oneTimePlanTxDigest = parseOptionalTxDigest(body.oneTimePlanTxDigest)
  const subPlanOnChainId = parseOptionalObjectId(body.subPlanOnChainId)
  const subPlanTxDigest = parseOptionalTxDigest(body.subPlanTxDigest)
  const readme = body.readme
  const sealDekEnvelope = typeof body.sealDekEnvelope === 'string' ? body.sealDekEnvelope : null

  if (!seriesOnChainId) {
    return NextResponse.json({ error: 'seriesOnChainId must be a valid on-chain object id' }, { status: 400 })
  }
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }
  if (readme != null && typeof readme !== 'string') {
    return NextResponse.json({ error: 'readme must be a string' }, { status: 400 })
  }
  if (typeof readme === 'string' && readme.length > 50_000) {
    return NextResponse.json({ error: 'readme must be 50,000 characters or fewer' }, { status: 400 })
  }
  if (oneTimePlanOnChainId && !oneTimePlanTxDigest) {
    return NextResponse.json({ error: 'oneTimePlanTxDigest is required when oneTimePlanOnChainId is provided' }, { status: 400 })
  }
  if (!oneTimePlanOnChainId && oneTimePlanTxDigest) {
    return NextResponse.json({ error: 'oneTimePlanOnChainId is required when oneTimePlanTxDigest is provided' }, { status: 400 })
  }
  if (subPlanOnChainId && !subPlanTxDigest) {
    return NextResponse.json({ error: 'subPlanTxDigest is required when subPlanOnChainId is provided' }, { status: 400 })
  }
  if (!subPlanOnChainId && subPlanTxDigest) {
    return NextResponse.json({ error: 'subPlanOnChainId is required when subPlanTxDigest is provided' }, { status: 400 })
  }
  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'publish',
    actorKey: identity.memberId,
    resourceKey: seriesOnChainId,
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

  if (!oneTimePlanOnChainId && !subPlanOnChainId) {
    return NextResponse.json({ error: 'At least one pricing plan must be provided' }, { status: 400 })
  }

  // Resolve author wallet address
  const member = await prisma.member.findUnique({
    where: { id: identity.memberId },
  })
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  const authorAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)
  if (!authorAddress) {
    return NextResponse.json({ error: 'No Sui wallet bound to account' }, { status: 400 })
  }

  try {
    const seriesTransaction = await getSuccessfulTransaction(txDigest)
    assertCreatedObjectChange(seriesTransaction, {
      objectOnChainId: seriesOnChainId,
      errorMessage: 'Transaction did not create the submitted Soul series',
      expectedType: 'series::SoulSeries',
      expectedPackageId: soulPackageId,
      expectedSender: authorAddress,
    })

    const seriesState = await getVerifiedSeriesState(seriesOnChainId, soulPackageId)
    if (!sameSuiValue(seriesState.authorAddress, authorAddress)) {
      return NextResponse.json({ error: 'On-chain series author does not match the authenticated wallet' }, { status: 403 })
    }

    if (oneTimePlanOnChainId && oneTimePlanTxDigest) {
      const oneTimePlanTransaction = await getSuccessfulTransaction(oneTimePlanTxDigest)
      assertCreatedObjectChange(oneTimePlanTransaction, {
        objectOnChainId: oneTimePlanOnChainId,
        errorMessage: 'Transaction did not create the submitted one-time pricing plan',
        expectedType: 'purchase::PricingPlan',
        expectedPackageId: soulPackageId,
        expectedSender: authorAddress,
      })
    }

    if (subPlanOnChainId && subPlanTxDigest) {
      const subscriptionPlanTransaction = await getSuccessfulTransaction(subPlanTxDigest)
      assertCreatedObjectChange(subscriptionPlanTransaction, {
        objectOnChainId: subPlanOnChainId,
        errorMessage: 'Transaction did not create the submitted subscription pricing plan',
        expectedType: 'purchase::PricingPlan',
        expectedPackageId: soulPackageId,
        expectedSender: authorAddress,
      })
    }

    if (releaseOnChainId) {
      // Release may have been created in the same TX as the series or in a
      // separate TX. Use releaseTxDigest when provided; fall back to the
      // series TX for backward compatibility with single-TX publish flows.
      const releaseTransaction = releaseTxDigest
        ? await getSuccessfulTransaction(releaseTxDigest)
        : seriesTransaction
      assertCreatedObjectChange(releaseTransaction, {
        objectOnChainId: releaseOnChainId,
        errorMessage: 'Transaction did not create the submitted Soul release',
        expectedType: 'series::SoulRelease',
        expectedPackageId: soulPackageId,
        expectedSender: authorAddress,
      })
    }

    const releaseState = releaseOnChainId
      ? await getVerifiedReleaseState(releaseOnChainId, soulPackageId)
      : null
    if (releaseState && !sameSuiValue(releaseState.seriesId, seriesState.objectId)) {
      return NextResponse.json({ error: 'On-chain release does not belong to the submitted Soul' }, { status: 422 })
    }

    const oneTimePlanState = oneTimePlanOnChainId
      ? await getVerifiedPricingPlanState(oneTimePlanOnChainId, soulPackageId)
      : null
    if (oneTimePlanState) {
      if (!sameSuiValue(oneTimePlanState.seriesId, seriesState.objectId)) {
        return NextResponse.json({ error: 'On-chain pricing plan does not belong to the submitted Soul' }, { status: 422 })
      }
      if (oneTimePlanState.planType !== 'onetime') {
        return NextResponse.json({ error: 'Submitted one-time plan is not an on-chain one-time pricing plan' }, { status: 422 })
      }
      if (!oneTimePlanState.active) {
        return NextResponse.json({ error: 'Submitted one-time pricing plan is not active on chain' }, { status: 422 })
      }
    }

    const subscriptionPlanState = subPlanOnChainId
      ? await getVerifiedPricingPlanState(subPlanOnChainId, soulPackageId)
      : null
    if (subscriptionPlanState) {
      if (!sameSuiValue(subscriptionPlanState.seriesId, seriesState.objectId)) {
        return NextResponse.json({ error: 'On-chain pricing plan does not belong to the submitted Soul' }, { status: 422 })
      }
      if (subscriptionPlanState.planType !== 'subscription') {
        return NextResponse.json({ error: 'Submitted subscription plan is not an on-chain subscription pricing plan' }, { status: 422 })
      }
      if (!subscriptionPlanState.active) {
        return NextResponse.json({ error: 'Submitted subscription pricing plan is not active on chain' }, { status: 422 })
      }
    }

    const responseBody = await prisma.$transaction(async (tx) => {
      const series = await dbCreateSeries({
        db: tx,
        seriesOnChainId: seriesState.objectId,
        authorAddress: seriesState.authorAddress,
        authorMemberId: member.id,
        name: seriesState.name,
        description: seriesState.description,
        category: seriesState.category,
        tags: seriesState.tags,
        previewImages: seriesState.previewImages,
        readme: readme ?? undefined,
      })

      let release = null
      if (releaseState) {
        release = await dbCreateRelease({
          db: tx,
          releaseOnChainId: releaseState.objectId,
          seriesDbId: series.id,
          seriesLatestReleaseOnChainId: seriesState.latestReleaseId,
          version: releaseState.version,
          walrusBlobRef: releaseState.walrusBlobRef,
          publicMetadataRef: releaseState.publicMetadataRef,
          contentHash: releaseState.contentHash,
        })
      }

      if (oneTimePlanState) {
        await dbUpdatePricingPlan({
          db: tx,
          seriesOnChainId: seriesState.objectId,
          planType: oneTimePlanState.planType,
          planOnChainId: oneTimePlanState.objectId,
          priceUsdc: oneTimePlanState.priceUsdc,
        })
      }

      if (subscriptionPlanState) {
        await dbUpdatePricingPlan({
          db: tx,
          seriesOnChainId: seriesState.objectId,
          planType: subscriptionPlanState.planType,
          planOnChainId: subscriptionPlanState.objectId,
          priceUsdc: subscriptionPlanState.priceUsdc,
          periodMs: subscriptionPlanState.periodMs,
        })
      }

      const responseBody = {
        id: series.id,
        name: series.name,
        onChainId: series.onChainId,
        releaseId: release?.id ?? null,
      }

      return responseBody
    }, { timeout: 30_000 })

    // Seal-encrypt the DEK and store as sidecar on the release after the
    // mirror rows exist. Success is only cached after the sidecar is ready,
    // so the same txDigest can be retried if Seal is temporarily unavailable.
    if (sealDekEnvelope && releaseState) {
      try {
        await createAndStoreReleaseSealSidecar({
          sealDekEnvelope,
          seriesOnChainId: seriesState.objectId,
          releaseOnChainId: releaseState.objectId,
          releaseContentHash: releaseState.contentHash,
          soulPackageId,
        })
      } catch (sealError) {
        console.error('[soul-publish-mirror] Seal sidecar creation failed', {
          memberId: identity.memberId,
          seriesOnChainId,
          releaseOnChainId: releaseState.objectId,
          error: toSafeErrorDetails(sealError),
        })
        return NextResponse.json(
          { error: 'Release mirrored locally, but Seal sidecar generation failed. Retry publish sync.' },
          { status: 503 },
        )
      }
    }

    await prisma.$transaction(async (tx) => {
      await storeSoulTxSync({
        db: tx,
        txDigest,
        routeKey: 'publish',
        actorKey: identity.memberId,
        resourceKey: seriesState.objectId,
        statusCode: 201,
        body: responseBody,
      })
    })

    return NextResponse.json(responseBody, { status: 201 })
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(error) },
        { status: error.status },
      )
    }
    console.error('[soul-publish-mirror] Sync failed', {
      memberId: identity.memberId,
      seriesOnChainId,
      txDigest,
      error: toSafeErrorDetails(error),
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
