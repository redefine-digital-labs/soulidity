import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractAllSoulAddedToCollectionEvents, extractSoulAddedToCollectionEvent } from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { getCollectionAbortInfo } from '@soulidity/sdk'
import { syncCollectionProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@soulidity/sdk'
import { findSoulCollectionDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, normalizeSuiValue, OnChainVerificationError, readTransactionSender, waitForTransactionBestEffort } from '@soulidity/sdk'
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
  const auth = await requireHumanWalletIdentity({ mutation: request })
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

  // Optional `soulOnChainId` disambiguates which `SoulAddedToCollection`
  // event in the TX to mirror. Required when the TX bundles multiple
  // add_soul calls (collection batch bind), optional otherwise. When
  // provided, the dedup resource key includes it so each soul in the same
  // TX gets its own cache slot.
  const requestedSoulOnChainIdRaw = typeof body?.soulOnChainId === 'string'
    ? normalizeSuiValue(body.soulOnChainId)
    : null
  if (typeof body?.soulOnChainId === 'string' && !requestedSoulOnChainIdRaw) {
    return NextResponse.json({ error: 'soulOnChainId is malformed' }, { status: 400 })
  }
  const requestedSoulOnChainId = requestedSoulOnChainIdRaw ?? null
  const dedupResourceKey = requestedSoulOnChainId
    ? `${collection.onChainId}:${requestedSoulOnChainId}`
    : collection.onChainId

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'collection:add-soul',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: dedupResourceKey,
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

    let added
    if (requestedSoulOnChainId) {
      const all = extractAllSoulAddedToCollectionEvents(transaction, packageId)
      const match = all.find((event) => event.soulId === requestedSoulOnChainId)
      if (!match) {
        return NextResponse.json(
          { error: `Transaction ${txDigest} does not include a SoulAddedToCollection event for ${requestedSoulOnChainId}` },
          { status: 404 },
        )
      }
      added = match
    } else {
      added = extractSoulAddedToCollectionEvent(transaction, packageId)
    }
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

    // Re-read the shared SoulCollection object instead of trusting this
    // transaction's event snapshot. Concurrent add-soul mirror calls can land
    // out of order; the live object read keeps the DB projection monotonic.
    const mirrored = await syncCollectionProjectionFromChain({
      packageId,
      collectionObjectId: collection.onChainId,
      creatorMemberId: collection.creatorMemberId,
      currentHolderMemberId: collection.currentHolderMemberId,
      listingObjectOnChainId: collection.listingObjectOnChainId,
      listedPriceAtomic: collection.listedPriceAtomic == null ? null : BigInt(collection.listedPriceAtomic.toString()),
      listingStatus: collection.listingStatus === 'listed' ? 'listed' : 'held',
      floorPriceAtomic: collection.floorPriceAtomic == null ? null : BigInt(collection.floorPriceAtomic.toString()),
    })
    const soulCount = mirrored.soulCount
    const maxSoulSupply = mirrored.maxSoulSupply == null ? null : mirrored.maxSoulSupply.toString()

    const responseBody = {
      txDigest,
      collectionOnChainId: collection.onChainId,
      soulOnChainId: added.soulId,
      soulCount,
      currentSoulSupply: soulCount,
      maxSoulSupply,
    }

    // Best-effort cache — a failure here should not mask a successful mirror sync.
    try {
      await storeSoulidityTxSync({
        routeKey: 'collection:add-soul',
        txDigest,
        actorKey: auth.identity.memberId,
        resourceKey: dedupResourceKey,
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
    // Map collection-module aborts to specific HTTP codes so the UI can render
    // localized copy. This catches the defensive case where a failed-tx digest
    // is replayed against the route — wallet pre-flight would normally have
    // caught the abort, but the API still answers correctly if it slips
    // through.
    const collectionAbort = getCollectionAbortInfo(error)
    if (collectionAbort) {
      return NextResponse.json(
        {
          code: collectionAbort.entry.name,
          error: collectionAbort.entry.summary,
        },
        { status: collectionAbort.entry.httpStatus },
      )
    }

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
