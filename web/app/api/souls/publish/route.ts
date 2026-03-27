import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { prisma } from '@web/lib/prisma'
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
import { parseOptionalObjectId, parseRequiredObjectId, parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { assertWalrusBlobId, normalizeWalrusBlobId } from '@web/lib/services/walrus'
import { createSealClient, getSealRuntimeConfig } from '@web/lib/services/seal'
import { createSealEnvelopeSidecar, type SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'
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
  const requestBody = body as Record<string, unknown>

  const txDigest = parseRequiredTxDigest(requestBody.txDigest)
  const soulOnChainId = parseRequiredObjectId(requestBody.soulOnChainId)
  const hasContentBlobObjectId = Object.hasOwn(requestBody, 'contentBlobObjectId')
  const contentBlobObjectId = parseOptionalObjectId(requestBody.contentBlobObjectId)
  const hasContentBlobId = Object.hasOwn(requestBody, 'contentBlobId')
  const contentBlobId = normalizeWalrusBlobId(requestBody.contentBlobId)
  const hasCategory = Object.hasOwn(requestBody, 'category')
  const category = parseOptionalString(requestBody.category)
  const hasTags = Object.hasOwn(requestBody, 'tags')
  const tags = parseStringArray(requestBody.tags, 'tags')
  const hasPreviewImages = Object.hasOwn(requestBody, 'previewImages')
  const previewImages = parseStringArray(requestBody.previewImages, 'previewImages')
  const readme = parseOptionalString(requestBody.readme)
  const hasSealDekEnvelope = Object.hasOwn(requestBody, 'sealDekEnvelope')
  const sealDekEnvelope = parseOptionalString(requestBody.sealDekEnvelope)

  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }
  if (!soulOnChainId) {
    return NextResponse.json({ error: 'soulOnChainId must be a valid object id' }, { status: 400 })
  }
  if (hasContentBlobObjectId && !contentBlobObjectId) {
    return NextResponse.json({ error: 'contentBlobObjectId must be a valid object id' }, { status: 400 })
  }
  if (hasContentBlobId && !contentBlobId) {
    return NextResponse.json({ error: 'contentBlobId must be a valid Walrus blob id' }, { status: 400 })
  }
  if (hasCategory && !category) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 })
  }
  if (hasTags && !tags) {
    return NextResponse.json({ error: 'tags must be a string array' }, { status: 400 })
  }
  if (hasPreviewImages && (!previewImages || !previewImages.every((value) => normalizeWalrusBlobId(value)))) {
    return NextResponse.json({ error: 'previewImages must be Walrus blob ids' }, { status: 400 })
  }
  if (hasSealDekEnvelope && !sealDekEnvelope) {
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

  const existingSoul = await prisma.soulAsset.findUnique({
    where: { onChainId: soulOnChainId },
    select: {
      creatorMemberId: true,
      creatorAddress: true,
      category: true,
      tags: true,
      previewImages: true,
      readme: true,
      sealSidecar: true,
    },
  })
  const isInitialSync = !existingSoul

  if (isInitialSync && identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only human accounts can mirror the initial Soul publish' }, { status: 403 })
  }

  if (isInitialSync && !contentBlobObjectId) {
    return NextResponse.json({ error: 'contentBlobObjectId is required' }, { status: 400 })
  }
  if (isInitialSync && !contentBlobId) {
    return NextResponse.json({ error: 'contentBlobId is required' }, { status: 400 })
  }
  if (isInitialSync && !category) {
    return NextResponse.json({ error: 'category is required' }, { status: 400 })
  }
  if (isInitialSync && !tags) {
    return NextResponse.json({ error: 'tags must be a string array' }, { status: 400 })
  }
  if (isInitialSync && !previewImages) {
    return NextResponse.json({ error: 'previewImages must be Walrus blob ids' }, { status: 400 })
  }
  if (isInitialSync && !sealDekEnvelope) {
    return NextResponse.json({ error: 'sealDekEnvelope is required' }, { status: 400 })
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
    let listingEvent: ReturnType<typeof extractSoulListingEvent>
    let listingSource: 'adapter' | 'core'
    try {
      listingEvent = extractSoulListingEvent(transaction, marketPackageId)
      listingSource = 'adapter'
    } catch {
      listingEvent = extractSoulListingEvent(transaction, soulPackageId)
      listingSource = 'core'
    }
    if (!sameSuiValue(listingEvent.soulObjectId, soulOnChainId)) {
      return NextResponse.json({ error: 'Transaction did not list the submitted Soul' }, { status: 422 })
    }
    if (!walletAddresses.some((address) => sameSuiValue(address, listingEvent.sellerAddress))) {
      return NextResponse.json({ error: 'Soul listing seller does not match the authenticated wallet' }, { status: 422 })
    }

    const soulState = await getVerifiedSoulState(soulOnChainId, soulPackageId)
    if (soulState.ownerKind !== 'object' || !sameSuiValue(soulState.ownerObjectId, listingEvent.sellerKioskId)) {
      return NextResponse.json(
        { error: 'Soul ownership has changed since this listing transaction' },
        { status: 409 },
      )
    }
    if (existingSoul && !sameSuiValue(existingSoul.creatorAddress, soulState.creatorAddress)) {
      return NextResponse.json({ error: 'Stored Soul creator does not match the on-chain Soul creator' }, { status: 422 })
    }
    if (contentBlobObjectId && !sameSuiValue(soulState.contentBlobObjectId, contentBlobObjectId)) {
      return NextResponse.json({ error: 'Submitted content blob object id does not match the on-chain Soul' }, { status: 422 })
    }
    if (!soulState.contentBlobId) {
      return NextResponse.json({ error: 'On-chain Soul content blob id is missing' }, { status: 422 })
    }

    const verifiedContentBlobId = assertWalrusBlobId(soulState.contentBlobId, 'on-chain Soul content blob id')
    if (contentBlobId && verifiedContentBlobId !== contentBlobId) {
      return NextResponse.json({ error: 'Submitted content blob id does not match the on-chain Soul' }, { status: 422 })
    }

    const isCreatorWallet = walletAddresses.some((address) => sameSuiValue(address, soulState.creatorAddress))
    if (!existingSoul && !isCreatorWallet) {
      return NextResponse.json({ error: 'Only the Soul creator can mirror the initial listing' }, { status: 422 })
    }
    const creatorMemberId = existingSoul?.creatorMemberId ?? (isCreatorWallet ? identity.memberId : null)

    let sidecar: SealEnvelopeSidecar | null
    let syncedCategory: string
    let syncedTags: string[]
    let syncedPreviewImages: string[]
    let syncedReadme: string | null

    if (existingSoul) {
      sidecar = (existingSoul.sealSidecar ?? null) as SealEnvelopeSidecar | null
      if (!sidecar) {
        return NextResponse.json({ error: 'Stored Soul seal sidecar is missing' }, { status: 409 })
      }
      syncedCategory = existingSoul.category
      syncedTags = existingSoul.tags
      syncedPreviewImages = existingSoul.previewImages.map((value) => assertWalrusBlobId(value, 'stored preview image'))
      syncedReadme = existingSoul.readme ?? null
    } else {
      const runtimeConfig = getSealRuntimeConfig()
      if (runtimeConfig.threshold <= 0 || runtimeConfig.serverConfigs.length === 0) {
        return NextResponse.json({ error: 'Seal is not configured for Soul publishing' }, { status: 503 })
      }

      const unsealedEnvelope = unsealDekEnvelope(sealDekEnvelope!)
      sidecar = await createSealEnvelopeSidecar({
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
      syncedCategory = category!
      syncedTags = tags!
      syncedPreviewImages = previewImages!.map((value) => assertWalrusBlobId(value, 'preview image'))
      syncedReadme = readme
    }

    await dbUpsertSoulAsset({
      soulOnChainId,
      creatorAddress: soulState.creatorAddress,
      creatorMemberId,
      currentOwnerAddress: listingEvent.sellerAddress,
      currentOwnerMemberId: identity.memberId,
      sellerKioskId: listingEvent.sellerKioskId,
      listedPriceSui: listingEvent.priceSui,
      listingStatus: 'listed',
      listingSource,
      name: soulState.name,
      description: soulState.description,
      imageUrl: soulState.imageUrl,
      metadataRef: soulState.metadataRef,
      contentBlobId: verifiedContentBlobId,
      contentBlobObjectId: soulState.contentBlobObjectId,
      sealSidecar: sidecar,
      category: syncedCategory,
      tags: syncedTags,
      previewImages: syncedPreviewImages,
      readme: syncedReadme,
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
