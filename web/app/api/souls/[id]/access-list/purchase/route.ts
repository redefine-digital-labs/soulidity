import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { extractMatchedContentAccessGrantedEvent, extractContentAccessPurchasedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const CONTENT_ACCESS_PURCHASE_RATE_LIMIT = {
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

  const rateLimit = await takeRateLimitToken(`content-access-purchase:${auth.identity.memberId}`, CONTENT_ACCESS_PURCHASE_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many content access purchase requests, try again later' },
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
  if (!soul.accessListOnChainId) {
    return NextResponse.json({ error: 'Soul does not have a content access list' }, { status: 409 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'content-access:purchase',
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

    // Require market::ContentAccessPurchased as proof of paid purchase (not just content_access::ContentAccessGranted which manual add_access also emits)
    const purchaseEvent = extractContentAccessPurchasedEvent(transaction, packageId)
    if (purchaseEvent.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction purchased access to a different Soul' }, { status: 422 })
    }

    // Cross-check the paired ContentAccessGranted event for scope details
    // Match by access_list_id + grantee to avoid picking up unrelated grant events in multi-call PTBs
    const grantEvent = extractMatchedContentAccessGrantedEvent(
      transaction,
      packageId,
      purchaseEvent.accessListId,
      purchaseEvent.buyer,
    )

    const expiresAtMsValue = grantEvent.expiresAtMs != null ? BigInt(grantEvent.expiresAtMs) : null
    await prisma.contentAccessRecord.upsert({
      where: {
        accessListOnChainId_granteeAddress: {
          accessListOnChainId: soul.accessListOnChainId,
          granteeAddress: purchaseEvent.buyer,
        },
      },
      update: {
        scopeMask: grantEvent.scopeMask,
        pricePaidAtomic: purchaseEvent.priceAtomic,
        grantedAtMs: BigInt(Date.now()),
        expiresAtMs: expiresAtMsValue,
        ownershipEpochSnapshot: grantEvent.ownershipEpochSnapshot,
        revokedAt: null,
      },
      create: {
        soulOnChainId: soul.onChainId,
        accessListOnChainId: soul.accessListOnChainId,
        granteeAddress: purchaseEvent.buyer,
        scopeMask: grantEvent.scopeMask,
        pricePaidAtomic: purchaseEvent.priceAtomic,
        grantedAtMs: BigInt(Date.now()),
        expiresAtMs: expiresAtMsValue,
        ownershipEpochSnapshot: grantEvent.ownershipEpochSnapshot,
      },
    })

    const responseBody = {
      txDigest,
      soulOnChainId: soul.onChainId,
      grantee: purchaseEvent.buyer,
      scopeMask: grantEvent.scopeMask,
      pricePaidAtomic: purchaseEvent.priceAtomic.toString(),
    }

    await storeSoulidityTxSync({
      routeKey: 'content-access:purchase',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[content-access-purchase] Failed to mirror content access purchase', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror content access purchase transaction' }, { status: 500 })
  }
}
