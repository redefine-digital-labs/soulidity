import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  extractSoulPurchasedEvent,
  tryExtractAnimacraftV8SoulPurchasedEvent,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import {
  endActiveSoulGrantProjectionsFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@soulidity/sdk'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@soulidity/sdk'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import { NativeReceiveError } from '@/lib/animacraft/native-receive'
import { verifyNativePurchase } from '@/lib/animacraft/native-purchase-verifier'

export const dynamic = 'force-dynamic'

const SOUL_PURCHASE_RATE_LIMIT = {
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

  const rateLimit = await takeRateLimitToken(`soul-purchase:${auth.identity.memberId}`, SOUL_PURCHASE_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity purchase requests, try again later' },
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
    routeKey: 'buy',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (stored && soul.provenanceKind !== 'animacraft') {
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

    const nativePurchased = tryExtractAnimacraftV8SoulPurchasedEvent(transaction, packageId)
    if (soul.provenanceKind === 'animacraft' && !nativePurchased) {
      return NextResponse.json({ code: 'NATIVE_PURCHASE_RECEIPT_REQUIRED' }, { status: 422 })
    }
    const ordinaryPurchased = nativePurchased ? null : extractSoulPurchasedEvent(transaction, packageId)
    const purchasedSoulId = nativePurchased?.soulId ?? ordinaryPurchased!.soulId
    if (purchasedSoulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction purchased a different Soulidity object' }, { status: 422 })
    }

    // A successful cancel/relist can precede its mirror update. Authenticate the
    // actual receipt and live native custody, not a potentially stale DB listing.
    if (nativePurchased && (transaction.digest !== txDigest
      || nativePurchased.buyerAddress !== readTransactionSender(transaction))) {
      return NextResponse.json({ error: 'Native purchase transaction or buyer does not match' }, { status: 422 })
    }
    const expectedNativeHeldState = nativePurchased ? await verifyNativePurchase(soul.onChainId,
      soul.stateOnChainId, nativePurchased, packageId,
      AbortSignal.any([request.signal, AbortSignal.timeout(25000)])) : undefined

    // A saved 200 proves the old sync succeeded, not that its buyer still owns
    // the Soul. Recheck native custody on replay before reporting held again.
    if (stored) {
      await expectedNativeHeldState?.verifyReadSet()
      return NextResponse.json(stored.responseBody, { status: stored.statusCode })
    }

    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: soul.onChainId,
      stateObjectId: soul.stateOnChainId,
      tags: soul.tags,
      previewImages: soul.previewImages,
      readme: soul.readme,
      creatorMemberId: soul.creatorMemberId,
      currentOwnerMemberId: auth.identity.memberId,
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
      expectedNativeHeldState,
    })

    await endActiveSoulGrantProjectionsFromChain({
      soulOnChainId: mirrored.onChainId,
      status: 'invalidated',
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      currentOwnerAddress: mirrored.currentOwnerAddress,
      listingStatus: mirrored.listingStatus,
      paidAtomic: (nativePurchased?.priceAtomic ?? ordinaryPurchased!.priceAtomic).toString(),
      totalAtomic: nativePurchased
        ? nativePurchased.priceAtomic.toString()
        : (
            ordinaryPurchased!.priceAtomic
            + ordinaryPurchased!.platformFeeAtomic
            + ordinaryPurchased!.creatorRoyaltyAtomic
            + ordinaryPurchased!.collectionRoyaltyAtomic
          ).toString(),
    }

    await storeSoulidityTxSync({
      routeKey: 'buy',
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
    console.error('[soul-purchase] Failed to mirror Soulidity purchase', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity purchase transaction' }, { status: 500 })
  }
}
