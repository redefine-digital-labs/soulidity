import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  extractSoulListingCancelledEvent,
  getTrustedPackageIds,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { dbCancelSoulListing, SoulMirrorOwnershipConflictError } from '@web/lib/souls/post-tx-db'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { readTransactionSender } from '@web/lib/souls/transaction-metadata'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'

export const dynamic = 'force-dynamic'

const SOUL_DELIST_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'This delist route only supports human sessions' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`soul-delist:${identity.memberId}`, SOUL_DELIST_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many delist sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }
  if (soul.listingStatus !== 'listed') {
    return NextResponse.json({ error: 'Soul is not currently listed' }, { status: 409 })
  }
  if (soul.currentOwnerMemberId !== identity.memberId) {
    return NextResponse.json({ error: 'Only the current owner can cancel the listing' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'delist',
    actorKey: identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch (configError) {
    return NextResponse.json({ error: configError instanceof Error ? configError.message : 'Missing Soul config' }, { status: 503 })
  }

  try {
    const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
    if (walletAddresses.length === 0) {
      return NextResponse.json({ error: 'Bind a Sui wallet before cancelling a listing' }, { status: 403 })
    }

    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const txSender = readTransactionSender(transaction)
    if (!txSender || !walletAddresses.some((address) => sameSuiValue(address, txSender))) {
      return NextResponse.json({ error: 'Transaction sender does not match the authenticated wallet' }, { status: 422 })
    }
    const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId, {
      expectedKioskId: soul.currentKioskId,
    })
    const cancelledEvent = extractSoulListingCancelledEvent(
      transaction,
      soulPackageId,
      getTrustedPackageIds(soulPackageId, soulState.packageId),
    )
    if (!sameSuiValue(cancelledEvent.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction did not cancel the listing for this Soul' }, { status: 422 })
    }
    if (!walletAddresses.some((address) => sameSuiValue(address, cancelledEvent.sellerAddress))) {
      return NextResponse.json({ error: 'Listing seller does not match the authenticated wallet' }, { status: 422 })
    }
    if (soul.listingObjectOnChainId && !sameSuiValue(cancelledEvent.listingObjectId, soul.listingObjectOnChainId)) {
      return NextResponse.json({ error: 'Transaction cancelled a different listing than the mirrored Soul state' }, { status: 422 })
    }

    const soulKioskId = soulState.kioskParentId ?? soulState.ownerObjectId
    if (soulState.ownerKind !== 'object' || !soulKioskId || !sameSuiValue(soulKioskId, cancelledEvent.kioskId)) {
      return NextResponse.json(
        { error: 'Soul ownership has changed since this cancel transaction' },
        { status: 409 },
      )
    }

    await dbCancelSoulListing({
      soulOnChainId: soul.onChainId,
      expectedCurrentOwnerAddress: soul.currentOwnerAddress,
      expectedCurrentKioskId: soul.currentKioskId,
      expectedListingStatus: 'listed',
    })

    const responseBody = {
      soulOnChainId: soul.onChainId,
      listingObjectOnChainId: null,
      listedPriceAtomic: null,
      listingStatus: 'held' as const,
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'delist',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (delistError) {
    if (isMultipleSuiWalletBindingsError(delistError)) {
      return NextResponse.json({ error: delistError.message }, { status: 409 })
    }
    if (delistError instanceof SoulMirrorOwnershipConflictError) {
      return NextResponse.json(
        { error: 'Soul ownership changed before the listing could be cancelled' },
        { status: 409 },
      )
    }
    if (delistError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(delistError) },
        { status: delistError.status },
      )
    }

    console.error('[soul-delist-mirror] Delist sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(delistError),
    })

    return NextResponse.json({ error: 'Failed to mirror Soul delist' }, { status: 500 })
  }
}
