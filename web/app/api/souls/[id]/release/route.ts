import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberPrimarySuiWalletAddress } from '@web/lib/auth/sui-wallet'
import { isUuid } from '@web/lib/is-uuid'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { dbCreateRelease } from '@web/lib/souls/post-tx-db'
import { createAndStoreReleaseSealSidecar } from '@web/lib/souls/release-seal-sidecar'
import { parseRequiredObjectId, parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import {
  getClientSafeOnChainVerificationErrorMessage,
  toSafeErrorDetails,
} from '@web/lib/souls/route-safety'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'
import {
  assertCreatedObjectChange,
  getSuccessfulTransaction,
  getVerifiedReleaseState,
  getVerifiedSeriesState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'

const SOUL_RELEASE_MIRROR_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

/**
 * POST /api/souls/[id]/release — Mirror a new release to the database.
 *
 * Called by the frontend after the on-chain publish_release TX succeeds.
 * Verifies the TX created the release and the sender is the series author.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { identity, error } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can publish releases' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(
    `soul-release-mirror:${identity.memberId}`,
    SOUL_RELEASE_MIRROR_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many release sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id: seriesIdParam } = await params
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const txDigest = parseRequiredTxDigest(body.txDigest)
  const releaseOnChainId = parseRequiredObjectId(body.releaseOnChainId)
  const sealDekEnvelope = typeof body.sealDekEnvelope === 'string' ? body.sealDekEnvelope : null

  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }
  if (!releaseOnChainId) {
    return NextResponse.json({ error: 'releaseOnChainId must be a valid on-chain object id' }, { status: 400 })
  }

  // Resolve series by DB UUID or on-chain ID
  const series = await prisma.soulSeries.findFirst({
    where: {
      OR: [
        ...(seriesIdParam.startsWith('0x') ? [{ onChainId: seriesIdParam }] : []),
        ...(isUuid(seriesIdParam) ? [{ id: seriesIdParam }] : []),
      ],
    },
  })
  if (!series) {
    return NextResponse.json({ error: 'Soul series not found' }, { status: 404 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'release',
    actorKey: identity.memberId,
    resourceKey: releaseOnChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Soul package config is missing' },
      { status: 503 },
    )
  }

  const authorAddress = await getMemberPrimarySuiWalletAddress(identity.memberId)
  if (!authorAddress) {
    return NextResponse.json({ error: 'No Sui wallet bound to account' }, { status: 400 })
  }

  try {
    // Verify the TX created the release object
    const transaction = await getSuccessfulTransaction(txDigest)
    assertCreatedObjectChange(transaction, {
      objectOnChainId: releaseOnChainId,
      errorMessage: 'Transaction did not create the submitted Soul release',
      expectedType: 'series::SoulRelease',
      expectedPackageId: soulPackageId,
      expectedSender: authorAddress,
    })

    // Verify release state on chain
    const releaseState = await getVerifiedReleaseState(releaseOnChainId, soulPackageId)
    if (!sameSuiValue(releaseState.seriesId, series.onChainId)) {
      return NextResponse.json({ error: 'On-chain release does not belong to this Soul series' }, { status: 422 })
    }

    // Verify sender is the series author
    const seriesState = await getVerifiedSeriesState(series.onChainId, soulPackageId)
    if (!sameSuiValue(seriesState.authorAddress, authorAddress)) {
      return NextResponse.json({ error: 'Only the series author can publish releases' }, { status: 403 })
    }

    // Sequential writes instead of interactive transaction to avoid
    // connection pool timeout after long on-chain RPC verification.
    // Both writes are idempotent (upsert) and TX-sync prevents double-processing.
    const release = await dbCreateRelease({
      releaseOnChainId: releaseState.objectId,
      seriesDbId: series.id,
      seriesLatestReleaseOnChainId: seriesState.latestReleaseId,
      version: releaseState.version,
      walrusBlobRef: releaseState.walrusBlobRef,
      publicMetadataRef: releaseState.publicMetadataRef,
      contentHash: releaseState.contentHash,
    })

    if (sealDekEnvelope) {
      try {
        await createAndStoreReleaseSealSidecar({
          sealDekEnvelope,
          seriesOnChainId: seriesState.objectId,
          releaseOnChainId: releaseState.objectId,
          releaseContentHash: releaseState.contentHash,
          soulPackageId,
        })
      } catch (sealError) {
        console.error('[soul-release-mirror] Seal sidecar creation failed', {
          memberId: identity.memberId,
          seriesId: series.id,
          releaseOnChainId,
          txDigest,
          error: toSafeErrorDetails(sealError),
        })
        return NextResponse.json(
          { error: 'Release mirrored locally, but Seal sidecar generation failed. Retry release sync.' },
          { status: 503 },
        )
      }
    }

    const responseBody = {
      id: release.id,
      onChainId: release.onChainId,
      version: release.version,
      seriesId: series.id,
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'release',
      actorKey: identity.memberId,
      resourceKey: releaseOnChainId,
      statusCode: 201,
      body: responseBody,
    })

    return NextResponse.json(responseBody, { status: 201 })
  } catch (err) {
    if (err instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(err) },
        { status: err.status },
      )
    }
    console.error('[soul-release-mirror] Sync failed', {
      memberId: identity.memberId,
      seriesId: series.id,
      releaseOnChainId,
      txDigest,
      error: toSafeErrorDetails(err),
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
