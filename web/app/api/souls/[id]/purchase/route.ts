import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  extractSoulPurchasedEvent,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import { dbSetSoulOwnership } from '@web/lib/souls/post-tx-db'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'

const SOUL_PURCHASE_RATE_LIMIT = {
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
    return NextResponse.json({ error: 'Use the agent purchase API' }, { status: 403 })
  }

  const rateLimit = await takeRateLimitToken(`soul-purchase:${identity.memberId}`, SOUL_PURCHASE_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many purchase sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid transaction digest' }, { status: 400 })
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }
  if (soul.listingStatus !== 'listed' || !soul.sellerKioskId || soul.listedPriceSui == null) {
    return NextResponse.json({ error: 'Soul is not currently listed for sale' }, { status: 409 })
  }

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'purchase',
    actorKey: identity.memberId,
    resourceKey: soul.onChainId,
  })
  if (storedSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  let soulPackageId: string
  let marketPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
    marketPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID')
  } catch (configError) {
    return NextResponse.json({ error: configError instanceof Error ? configError.message : 'Missing Soul config' }, { status: 503 })
  }

  try {
    const walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
    if (walletAddresses.length === 0) {
      return NextResponse.json({ error: 'Bind a Sui wallet before purchasing' }, { status: 403 })
    }

    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const purchaseEvent = extractSoulPurchasedEvent(transaction, marketPackageId)
    if (!sameSuiValue(purchaseEvent.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction did not purchase the requested Soul' }, { status: 422 })
    }
    if (!sameSuiValue(purchaseEvent.sellerKioskId, soul.sellerKioskId)) {
      return NextResponse.json({ error: 'Transaction seller kiosk does not match the active listing' }, { status: 422 })
    }
    if (!walletAddresses.some((address) => sameSuiValue(address, purchaseEvent.buyerAddress))) {
      return NextResponse.json({ error: 'Purchased Soul owner does not match the authenticated wallet' }, { status: 422 })
    }

    const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId)
    if (!soulState.ownerAddress || !walletAddresses.some((address) => sameSuiValue(address, soulState.ownerAddress))) {
      return NextResponse.json({ error: 'Purchased Soul was not transferred to the authenticated wallet' }, { status: 422 })
    }

    await dbSetSoulOwnership({
      soulOnChainId: soul.onChainId,
      currentOwnerAddress: soulState.ownerAddress,
      currentOwnerMemberId: identity.memberId,
      listingStatus: 'held',
      sellerKioskId: null,
      listedPriceSui: null,
      grantVersion: soulState.grantVersion,
    })

    const responseBody = {
      digest: txDigest,
      soulOnChainId: soul.onChainId,
      currentOwnerAddress: soulState.ownerAddress,
      listingStatus: 'held' as const,
      onChainSuccess: true,
      dbSynced: true,
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'purchase',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      body: responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (purchaseError) {
    if (purchaseError instanceof OnChainVerificationError) {
      return NextResponse.json(
        { error: getClientSafeOnChainVerificationErrorMessage(purchaseError) },
        { status: purchaseError.status },
      )
    }

    console.error('[soul-purchase-mirror] Sync failed', {
      memberId: identity.memberId,
      txDigest,
      soulOnChainId: soul.onChainId,
      error: toSafeErrorDetails(purchaseError),
    })

    return NextResponse.json({ error: 'Failed to mirror Soul purchase' }, { status: 500 })
  }
}
