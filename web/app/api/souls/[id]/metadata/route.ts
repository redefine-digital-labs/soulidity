import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractSoulMetadataMutationEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_METADATA_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`soul-metadata:${auth.identity.memberId}`, SOUL_METADATA_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity metadata requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'metadata:update',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (stored) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

  try {
    await waitForTransactionBestEffort(txDigest)
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderError = assertTransactionSender(readTransactionSender(transaction), auth.walletAddresses)
    if (senderError) {
      return senderError
    }

    const updated = extractSoulMetadataMutationEvent(transaction, packageId)
    if (updated.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction updated metadata for a different Soul' }, { status: 422 })
    }

    const mirroredSoul = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: soul.onChainId,
      stateObjectId: soul.stateOnChainId,
      memoryObjectId: soul.memoryOnChainId,
      tags: soul.tags,
      previewImages: soul.previewImages,
      readme: soul.readme,
      sealSidecar: soul.sealSidecar as never,
      creatorMemberId: soul.creatorMemberId,
      currentOwnerMemberId: soul.currentOwnerMemberId,
      listingObjectOnChainId: soul.listingObjectOnChainId,
      listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
      listingStatus: soul.listingStatus as 'held' | 'listed' | 'floor-violation',
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirroredSoul.onChainId,
      metadataOnChainId: mirroredSoul.metadataOnChainId,
      activeSpriteAssetName: mirroredSoul.activeSpriteAssetName,
      activeSpriteVersionIndex: mirroredSoul.activeSpriteVersionIndex,
      activeSpriteDownloadPolicy: mirroredSoul.activeSpriteDownloadPolicy,
      activeVoiceAssetName: mirroredSoul.activeVoiceAssetName,
      activeVoiceVersionIndex: mirroredSoul.activeVoiceVersionIndex,
      activeVoiceDownloadPolicy: mirroredSoul.activeVoiceDownloadPolicy,
      spriteConfigJson: mirroredSoul.spriteConfigJson,
      spriteMoodMapJson: mirroredSoul.spriteMoodMapJson,
      voiceConfigJson: mirroredSoul.voiceConfigJson,
    }

    await storeSoulidityTxSync({
      routeKey: 'metadata:update',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-metadata] Failed to mirror Soulidity metadata transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity metadata transaction' }, { status: 500 })
  }
}
