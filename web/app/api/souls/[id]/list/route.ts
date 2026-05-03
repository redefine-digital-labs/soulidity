import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractAllSoulListedEvents } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_LIST_RATE_LIMIT = {
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

  const { limited, retryAfterSeconds } = await takeRateLimitToken(`soul-list:${auth.identity.memberId}`, SOUL_LIST_RATE_LIMIT)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity listing requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
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
    routeKey: 'list',
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

    // The TX may contain multiple SoulListed events (e.g. mint + bind +
    // list bundled, or chunked batches). Select the event whose soul_id
    // matches the route Soul, not the first one in the digest.
    const listedEvents = extractAllSoulListedEvents(transaction, packageId)
    const listed = listedEvents.find((e) => e.soulId === soul.onChainId)
    if (!listed) {
      return NextResponse.json({ error: 'Transaction did not list this Soulidity object' }, { status: 422 })
    }

    // Always mirror the committed chain state first — on-chain is source of truth.
    // Floor price is an app-level constraint checked after sync to avoid stale projections.
    const mirrored = await syncSoulProjectionFromChain({
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
      listingObjectOnChainId: listed.listingId,
      listedPriceAtomic: listed.priceAtomic,
      listingStatus: 'listed',
    })

    let responseBody: Record<string, unknown> = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      listingObjectOnChainId: mirrored.listingObjectOnChainId,
      listedPriceAtomic: mirrored.listedPriceAtomic,
      listingStatus: mirrored.listingStatus,
    }

    // Collection floor price is an app-level policy enforced after mirroring on-chain state.
    // Below-floor listings are valid on-chain but suppressed from marketplace reads via
    // a distinct listing status so they don't appear alongside policy-compliant listings.
    const floorViolation = (() => {
      if (!soul.collection?.floorPriceAtomic) return false
      const floorAtomic = BigInt(soul.collection.floorPriceAtomic.toString())
      return listed.priceAtomic < floorAtomic
    })()

    if (floorViolation) {
      await prisma.soulAsset.updateMany({
        where: { onChainId: soul.onChainId },
        data: { listingStatus: 'floor-violation' },
      })
      responseBody = {
        ...responseBody,
        listingStatus: 'floor-violation',
        floorWarning: 'Listing price is below the collection floor price',
      }
    }

    await storeSoulidityTxSync({
      routeKey: 'list',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-list] Failed to mirror Soulidity listing transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity listing transaction' }, { status: 500 })
  }
}
