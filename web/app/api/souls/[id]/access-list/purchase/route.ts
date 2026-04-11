import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { prisma } from '@web/lib/prisma'
import { extractContentAccessGrantedEvent } from '@/lib/soulidity/events'
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
  const auth = await requireHumanWalletIdentity()
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

    const event = extractContentAccessGrantedEvent(transaction, packageId)
    if (event.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction granted access to a different Soul' }, { status: 422 })
    }

    await prisma.contentAccessRecord.upsert({
      where: {
        accessListOnChainId_granteeAddress: {
          accessListOnChainId: soul.accessListOnChainId,
          granteeAddress: event.grantee,
        },
      },
      update: {
        scopeMask: event.scopeMask,
        pricePaidAtomic: BigInt(event.pricePaidAtomic),
        grantedAtMs: BigInt(Date.now()),
        revokedAt: null,
      },
      create: {
        soulOnChainId: soul.onChainId,
        accessListOnChainId: soul.accessListOnChainId,
        granteeAddress: event.grantee,
        scopeMask: event.scopeMask,
        pricePaidAtomic: BigInt(event.pricePaidAtomic),
        grantedAtMs: BigInt(Date.now()),
      },
    })

    const responseBody = {
      txDigest,
      soulOnChainId: soul.onChainId,
      grantee: event.grantee,
      scopeMask: event.scopeMask,
      pricePaidAtomic: event.pricePaidAtomic.toString(),
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
