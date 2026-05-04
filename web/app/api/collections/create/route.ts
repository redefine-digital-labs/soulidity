import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractCollectionMintedToKioskEvent } from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { syncCollectionProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@soulidity/sdk'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@soulidity/sdk'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const COLLECTION_CREATE_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

export async function POST(request: Request) {
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const { limited, retryAfterSeconds } = await takeRateLimitToken(
    `collection-create:${auth.identity.memberId}`,
    COLLECTION_CREATE_RATE_LIMIT,
  )
  if (limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity collection creation requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  // Optional off-chain floor price (set during collection creation)
  let floorPriceAtomic: bigint | null = null
  if (body?.floorPriceAtomic != null) {
    try {
      floorPriceAtomic = BigInt(String(body.floorPriceAtomic))
    } catch {
      return NextResponse.json({ error: 'floorPriceAtomic must be a valid integer string' }, { status: 400 })
    }
    if (floorPriceAtomic < 0n) {
      return NextResponse.json({ error: 'floorPriceAtomic must not be negative' }, { status: 400 })
    }
    if (floorPriceAtomic > 99_999_999_999_999_999_999n) {
      return NextResponse.json({ error: 'floorPriceAtomic exceeds maximum storable value' }, { status: 400 })
    }
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'collection:mint',
    txDigest,
    actorKey: auth.identity.memberId,
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

    const minted = extractCollectionMintedToKioskEvent(transaction, packageId)
    const mirrored = await syncCollectionProjectionFromChain({
      packageId,
      collectionObjectId: minted.collectionId,
      creatorMemberId: auth.identity.memberId,
      currentHolderMemberId: auth.identity.memberId,
      floorPriceAtomic,
    })

    const responseBody = {
      txDigest,
      collectionOnChainId: mirrored.onChainId,
      rightOnChainId: mirrored.rightOnChainId,
      listingStatus: mirrored.listingStatus,
      // soulCount/currentSoulSupply mirror the same on-chain counter; both
      // names are exposed for legacy and new clients respectively.
      soulCount: mirrored.soulCount,
      currentSoulSupply: mirrored.soulCount,
      maxSoulSupply: mirrored.maxSoulSupply == null ? null : mirrored.maxSoulSupply.toString(),
    }

    await storeSoulidityTxSync({
      routeKey: 'collection:mint',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[collection-create] Failed to mirror Soulidity collection creation transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      error: message,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity collection creation transaction' }, { status: 500 })
  }
}
