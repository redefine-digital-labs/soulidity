import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { extractCollectionListedEvent, extractCollectionListingCancelledEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { syncCollectionProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulCollectionDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const COLLECTION_LIST_RATE_LIMIT = {
  max: 10,
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

  const { limited, retryAfterSeconds } = await takeRateLimitToken(`collection-list:${auth.identity.memberId}`, COLLECTION_LIST_RATE_LIMIT)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many collection listing requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const collection = await findSoulCollectionDetailByRouteId(id)
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action === 'delist' ? 'delist' : 'list'
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const routeKey = action === 'delist' ? 'collection:delist' : 'collection:list'
  const stored = await getStoredSoulidityTxSync({
    routeKey,
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

    const mirrored = action === 'delist'
      ? await (async () => {
          const cancelled = extractCollectionListingCancelledEvent(transaction, packageId)
          if (cancelled.collectionId !== collection.onChainId) {
            return null
          }
          return syncCollectionProjectionFromChain({
            packageId,
            collectionObjectId: collection.onChainId,
            creatorMemberId: collection.creatorMemberId,
            currentHolderMemberId: collection.currentHolderMemberId,
            listingObjectOnChainId: null,
            listedPriceAtomic: null,
            listingStatus: 'held',
          })
        })()
      : await (async () => {
          const listed = extractCollectionListedEvent(transaction, packageId)
          if (listed.collectionId !== collection.onChainId) {
            return null
          }
          return syncCollectionProjectionFromChain({
            packageId,
            collectionObjectId: collection.onChainId,
            creatorMemberId: collection.creatorMemberId,
            currentHolderMemberId: collection.currentHolderMemberId,
            listingObjectOnChainId: listed.listingId,
            listedPriceAtomic: listed.priceAtomic,
            listingStatus: 'listed',
          })
        })()

    if (!mirrored) {
      return NextResponse.json({ error: 'Transaction targeted a different Soulidity collection' }, { status: 422 })
    }

    const responseBody = {
      txDigest,
      collectionOnChainId: mirrored.onChainId,
      listingStatus: mirrored.listingStatus,
      listingObjectOnChainId: mirrored.listingObjectOnChainId,
      listedPriceAtomic: mirrored.listedPriceAtomic,
    }

    await storeSoulidityTxSync({
      routeKey,
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[collection-list] Failed to mirror Soulidity collection listing transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      collectionId: collection.onChainId,
      action,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity collection listing transaction' }, { status: 500 })
  }
}
