import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
  extractSoulListingEvent,
} from '@web/lib/souls/on-chain-verification'
import { dbUpsertSoulAsset } from '@web/lib/souls/post-tx-db'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'
import { parseRequiredObjectId, parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { assertWalrusBlobId, normalizeWalrusBlobId } from '@web/lib/services/walrus'
import { createSealClient, getSealRuntimeConfig } from '@web/lib/services/seal'
import { createSealEnvelopeSidecar } from '@web/lib/services/seal-crypto'
import { unsealDekEnvelope } from '@web/lib/services/dek-envelope'

const SOUL_PUBLISH_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

function parseStringArray(value: unknown, fieldName: string): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null
  }

  const normalized = value
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  return normalized.every((item) => item.length > 0) ? normalized : null
}

function parseOptionalString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: NextRequest) {
  const { identity, error } = await requireIdentity()
  if (error) {
    return error
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can publish Souls' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`soul-publish:${identity.memberId}`, SOUL_PUBLISH_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many publish sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const txDigest = parseRequiredTxDigest((body as Record<string, unknown>).txDigest)
  const soulOnChainId = parseRequiredObjectId((body as Record<string, unknown>).soulOnChainId)
  const contentBlobObjectId = parseRequiredObjectId((body as Record<string, unknown>).contentBlobObjectId)
  const contentBlobId = normalizeWalrusBlobId((body as Record<string, unknown>).contentBlobId)
  const category = parseOptionalString((body as Record<string, unknown>).category)
  const tags = parseStringArray((body as Record<string, unknown>).tags, 'tags')
  const previewImages = parseStringArray((body as Record<string, unknown>).previewImages, 'previewImages')
  const readme = parseOptionalString((body as Record<string, unknown>).readme)
  const sealDekEnvelope = parseOptionalString((body as Record<string, unknown>).sealDekEnvelope)

  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }
  if (!soulOnChainId) {
    return NextResponse.json({ error: 'soulOnChainId must be a valid object id' }, { status: 400 })
  }
  if (!contentBlobObjectId) {
    return NextResponse.json({ error: 'contentBlobObjectId must be a valid object id' }, { status: 400 })
  }
  if (!contentBlobId) {
    return NextResponse.json({ error: 'contentBlobId must be a valid Walrus blob id' }, { status: 400 })
  }
  if (!category) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 })
  }
  if (!tags) {
    return NextResponse.json({ error: 'tags must be a string array' }, { status: 400 })
  }
  if (!previewImages || !previewImages.every((value) => normalizeWalrusBlobId(value))) {
    return NextResponse.json({ error: 'previewImages must be Walrus blob ids' }, { status: 400 })
  }
  if (!sealDekEnvelope) {
    return NextResponse.json({ error: 'sealDekEnvelope is required' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'publish',
    actorKey: identity.memberId,
    resourceKey: soulOnChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  let marketPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
    marketPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID')
  } catch (configError) {
    return NextResponse.json({ error: configError instanceof Error ? configError.message : 'Missing Soul config' }, { status: 503 })
  }

  try {
    const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
    if (walletAddresses.length === 0) {
      return NextResponse.json({ error: 'Bind a Sui wallet before publishing' }, { status: 403 })
    }

    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const listingEvent = extractSoulListingEvent(transaction, marketPackageId)
    if (!sameSuiValue(listingEvent.soulObjectId, soulOnChainId)) {
      return NextResponse.json({ error: 'Transaction did not list the submitted Soul' }, { status: 422 })
    }
    if (!walletAddresses.some((address) => sameSuiValue(address, listingEvent.sellerAddress))) {
      return NextResponse.json({ error: 'Soul listing seller does not match the authenticated wallet' }, { status: 422 })
    }

    const soulState = await getVerifiedSoulState(soulOnChainId, soulPackageId)
    if (!walletAddresses.some((address) => sameSuiValue(address, soulState.creatorAddress))) {
      return NextResponse.json({ error: 'On-chain Soul creator does not match the authenticated wallet' }, { status: 422 })
    }
    if (!sameSuiValue(soulState.contentBlobObjectId, contentBlobObjectId)) {
      return NextResponse.json({ error: 'Submitted content blob object id does not match the on-chain Soul' }, { status: 422 })
    }

    const runtimeConfig = getSealRuntimeConfig()
    if (runtimeConfig.threshold <= 0 || runtimeConfig.serverConfigs.length === 0) {
      return NextResponse.json({ error: 'Seal is not configured for Soul publishing' }, { status: 503 })
    }

    const unsealedEnvelope = unsealDekEnvelope(sealDekEnvelope)
    const sidecar = await createSealEnvelopeSidecar({
      sealClient: createSealClient(),
      packageId: soulPackageId,
      soulObjectId: soulOnChainId,
      threshold: runtimeConfig.threshold,
      dek: unsealedEnvelope.dek,
      iv: unsealedEnvelope.iv,
      contentHash: unsealedEnvelope.contentHash,
      mimeType: unsealedEnvelope.mimeType,
      fileName: unsealedEnvelope.fileName,
    })

    await dbUpsertSoulAsset({
      soulOnChainId,
      creatorAddress: soulState.creatorAddress,
      creatorMemberId: identity.memberId,
      currentOwnerAddress: listingEvent.sellerAddress,
      currentOwnerMemberId: identity.memberId,
      sellerKioskId: listingEvent.sellerKioskId,
      listedPriceSui: listingEvent.priceSui,
      listingStatus: 'listed',
      name: soulState.name,
      description: soulState.description,
      imageUrl: soulState.imageUrl,
      metadataRef: soulState.metadataRef,
      contentBlobId: assertWalrusBlobId(contentBlobId, 'contentBlobId'),
      contentBlobObjectId: soulState.contentBlobObjectId,
      sealSidecar: sidecar,
      category,
      tags,
      previewImages: previewImages.map((value) => assertWalrusBlobId(value, 'preview image')),
      readme,
      grantVersion: soulState.grantVersion,
      agentGrantAddress: soulState.agentGrant,
      agentAccessCapOnChainId: null,
    })

    const responseBody = {
      soulOnChainId,
      sellerKioskId: listingEvent.sellerKioskId,
      listedPriceSui: listingEvent.priceSui.toString(),
      listingStatus: 'listed' as const,
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'publish',
      actorKey: identity.memberId,
      resourceKey: soulOnChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (publishError) {
    if (publishError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(publishError) },
        { status: publishError.status },
      )
    }

    console.error('[soul-publish-mirror] Sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId,
      error: toSafeErrorDetails(publishError),
    })

    return NextResponse.json({ error: 'Failed to mirror published Soul' }, { status: 500 })
  }
}
