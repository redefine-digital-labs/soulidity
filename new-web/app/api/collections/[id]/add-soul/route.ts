import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { extractSoulAddedToCollectionEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulCollectionDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, OnChainVerificationError, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const ADD_SOUL_RATE_LIMIT = {
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

  const { limited, retryAfterSeconds } = await takeRateLimitToken(`collection-add-soul:${auth.identity.memberId}`, ADD_SOUL_RATE_LIMIT)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many add-soul requests, try again later' },
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
    routeKey: 'collection:add-soul',
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

    const added = extractSoulAddedToCollectionEvent(transaction, packageId)
    if (added.collectionId.toLowerCase() !== collection.onChainId.toLowerCase()) {
      return NextResponse.json({ error: 'Transaction targeted a different collection' }, { status: 422 })
    }

    // Update the soul's collectionOnChainId
    await prisma.soulAsset.updateMany({
      where: { onChainId: added.soulId },
      data: { collectionOnChainId: added.collectionId },
    })

    // Reconcile floor-price policy: if the soul is already listed below the
    // collection floor, mark it as floor-violation so it's hidden from the marketplace.
    if (collection.floorPriceAtomic) {
      const floorAtomic = BigInt(collection.floorPriceAtomic.toString())
      const soul = await prisma.soulAsset.findFirst({
        where: { onChainId: added.soulId },
        select: { listingStatus: true, listedPriceAtomic: true },
      })
      if (soul?.listingStatus === 'listed' && soul.listedPriceAtomic != null) {
        const priceAtomic = BigInt(soul.listedPriceAtomic.toString())
        if (priceAtomic < floorAtomic) {
          await prisma.soulAsset.updateMany({
            where: { onChainId: added.soulId },
            data: { listingStatus: 'floor-violation' },
          })
        }
      }
    }

    // Recount souls in this collection
    const soulCount = await prisma.soulAsset.count({
      where: { collectionOnChainId: collection.onChainId },
    })
    await prisma.soulCollectionAsset.updateMany({
      where: { onChainId: collection.onChainId },
      data: { soulCount },
    })

    const responseBody = {
      txDigest,
      collectionOnChainId: collection.onChainId,
      soulOnChainId: added.soulId,
      soulCount,
    }

    // Best-effort cache — a failure here should not mask a successful mirror sync.
    try {
      await storeSoulidityTxSync({
        routeKey: 'collection:add-soul',
        txDigest,
        actorKey: auth.identity.memberId,
        resourceKey: collection.onChainId,
        statusCode: 200,
        responseBody,
      })
    } catch (syncErr) {
      console.warn('[collection-add-soul] storeSoulidityTxSync failed (non-fatal)', {
        txDigest,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      })
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const isVerification = error instanceof OnChainVerificationError
    console.error('[collection-add-soul] Mirror failed', {
      memberId: auth.identity.memberId,
      txDigest,
      collectionId: collection.onChainId,
      errorType: isVerification ? 'verification' : 'unknown',
      errorMsg,
    })
    return NextResponse.json(
      { error: isVerification ? `Event verification failed: ${errorMsg}` : 'Failed to mirror add-soul transaction' },
      { status: isVerification ? 422 : 500 },
    )
  }
}
