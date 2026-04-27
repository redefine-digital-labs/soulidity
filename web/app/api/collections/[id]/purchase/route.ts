import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractCollectionPurchasedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { syncCollectionProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulCollectionDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const COLLECTION_PURCHASE_RATE_LIMIT = {
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

  const { limited, retryAfterSeconds } = await takeRateLimitToken(`collection-purchase:${auth.identity.memberId}`, COLLECTION_PURCHASE_RATE_LIMIT)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many collection purchase requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const collection = await findSoulCollectionDetailByRouteId(id)
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'collection:buy',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: collection.onChainId,
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

    const purchased = extractCollectionPurchasedEvent(transaction, packageId)
    if (purchased.collectionId !== collection.onChainId) {
      return NextResponse.json({ error: 'Transaction purchased a different Soulidity collection' }, { status: 422 })
    }

    const mirrored = await syncCollectionProjectionFromChain({
      packageId,
      collectionObjectId: collection.onChainId,
      creatorMemberId: collection.creatorMemberId,
      currentHolderMemberId: auth.identity.memberId,
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held',
    })

    const responseBody = {
      txDigest,
      collectionOnChainId: mirrored.onChainId,
      currentHolderAddress: mirrored.currentHolderAddress,
      listingStatus: mirrored.listingStatus,
      paidAtomic: purchased.priceAtomic.toString(),
      totalAtomic: (purchased.priceAtomic + purchased.platformFeeAtomic).toString(),
    }

    await storeSoulidityTxSync({
      routeKey: 'collection:buy',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[collection-purchase] Failed to mirror Soulidity collection purchase', {
      memberId: auth.identity.memberId,
      txDigest,
      collectionId: collection.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity collection purchase transaction' }, { status: 500 })
  }
}
