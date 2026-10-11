import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  extractSoulListingCancelledEvent,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@soulidity/sdk'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@soulidity/sdk'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import { verifyNativeMarketCancellation } from '@/lib/animacraft/native-market-cancellation'
import { createNativeReceiveClient, readNativeReceiveTarget, NativeReceiveError } from '@/lib/animacraft/native-receive'

export const dynamic = 'force-dynamic'

const SOUL_DELIST_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`soul-delist:${auth.identity.memberId}`, SOUL_DELIST_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity delist requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'delist',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (stored) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

  try {
    await waitForTransactionBestEffort(txDigest)
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderError = assertTransactionSender(readTransactionSender(transaction), auth.walletAddresses)
    if (senderError) {
      return senderError
    }

    let expectedNativeHeldState
    if (soul.provenanceKind === 'animacraft') {
      const target = readNativeReceiveTarget()
      if (target.soulidityOriginalPackageId !== packageId) {
        throw new NativeReceiveError('NATIVE_CANCELLATION_TARGET_MISMATCH', 'Cancellation package differs from native target', 503)
      }
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)])
      expectedNativeHeldState = await verifyNativeMarketCancellation(createNativeReceiveClient(signal), target, {
        soulId: soul.onChainId, stateId: soul.stateOnChainId, txDigest,
        sender: readTransactionSender(transaction)!, transaction,
      }, signal)
    } else {
      const cancelled = extractSoulListingCancelledEvent(transaction, packageId)
      if (cancelled.soulId !== soul.onChainId) {
        return NextResponse.json({ error: 'Transaction delisted a different Soulidity object' }, { status: 422 })
      }
      if (soul.listingObjectOnChainId && cancelled.listingId !== soul.listingObjectOnChainId) {
        return NextResponse.json({ error: 'Transaction cancelled a different Soulidity listing' }, { status: 422 })
      }
    }

    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: soul.onChainId,
      stateObjectId: soul.stateOnChainId,
      tags: soul.tags,
      previewImages: soul.previewImages,
      readme: soul.readme,
      creatorMemberId: soul.creatorMemberId,
      currentOwnerMemberId: expectedNativeHeldState ? auth.identity.memberId : soul.currentOwnerMemberId,
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
      expectedNativeHeldState,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      listingStatus: mirrored.listingStatus,
    }

    await storeSoulidityTxSync({
      routeKey: 'delist',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof NativeReceiveError) {
      return NextResponse.json({ code: error.code }, { status: error.status })
    }
    console.error('[soul-delist] Failed to mirror Soulidity delist', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity delist transaction' }, { status: 500 })
  }
}
