import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import {
  extractSoulPurchasedEvent,
  getTrustedPackageIds,
  getVerifiedPersonalKioskCapState,
  getVerifiedSoulState,
  OnChainVerificationError,
  sameSuiValue,
} from '@web/lib/souls/on-chain-verification'
import {
  buildPurchaseOwnershipConflictBody,
  buildPurchaseOwnershipChangedBody,
  purchaseSyncBodiesEqual,
  readRecoverableStoredPurchaseSync,
} from '@web/lib/souls/purchase-sync-state'
import {
  dbSetSoulOwnership,
  narrowListingStatus,
  SoulMirrorOwnershipConflictError,
} from '@web/lib/souls/post-tx-db'
import { findSoulAssetDetailByRouteId } from '@web/lib/souls/repository'
import { parseRequiredTxDigest } from '@web/lib/souls/request-validation'
import { getClientSafeOnChainVerificationErrorMessage, toSafeErrorDetails } from '@web/lib/souls/route-safety'
import { readTransactionSender } from '@web/lib/souls/transaction-metadata'
import { getSuccessfulTransactionBlock } from '@web/lib/souls/transaction'
import { getStoredSoulTxSync, storeSoulTxSync } from '@web/lib/souls/tx-sync'

export const dynamic = 'force-dynamic'

const SOUL_PURCHASE_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

function buildPendingPurchaseSyncBody(params: {
  digest: string
  soulOnChainId: string
  txSender?: string | null
  currentOwnerAddress?: string | null
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
}) {
  const hasRecoverableOwnershipState =
    typeof params.currentOwnerAddress === 'string'
    && typeof params.currentKioskId === 'string'
    && typeof params.currentKioskCapOnChainId === 'string'

  return {
    digest: params.digest,
    soulOnChainId: params.soulOnChainId,
    txSender: params.txSender ?? undefined,
    currentOwnerAddress: hasRecoverableOwnershipState ? params.currentOwnerAddress : undefined,
    currentKioskId: hasRecoverableOwnershipState ? params.currentKioskId : undefined,
    currentKioskCapOnChainId: hasRecoverableOwnershipState ? params.currentKioskCapOnChainId : undefined,
    listingStatus: hasRecoverableOwnershipState ? 'held' as const : undefined,
    onChainSuccess: true,
    dbSynced: false,
    error: 'Purchase sync pending',
  }
}

function tryExtractSoulPurchasedEventWithCurrentPackage(
  transaction: Parameters<typeof extractSoulPurchasedEvent>[0],
  packageId: string,
) {
  try {
    return extractSoulPurchasedEvent(transaction, packageId)
  } catch (error) {
    if (error instanceof OnChainVerificationError) {
      return null
    }
    throw error
  }
}

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

  const storedSync = await getStoredSoulTxSync({
    txDigest,
    routeKey: 'purchase',
    actorKey: identity.memberId,
    resourceKey: soul.onChainId,
  })
  const recoverableStoredSync = readRecoverableStoredPurchaseSync(storedSync)
  if (storedSync && !recoverableStoredSync) {
    return NextResponse.json(storedSync.body, { status: storedSync.statusCode })
  }

  const canRetryHeldPurchaseMirror =
    soul.listingStatus === 'held'
    && soul.currentOwnerMemberId === identity.memberId
  if (!canRetryHeldPurchaseMirror && (soul.listingStatus !== 'listed' || soul.listedPriceAtomic == null || !soul.listingObjectOnChainId)) {
    return NextResponse.json({ error: 'Soul is not currently listed for sale' }, { status: 409 })
  }
  if (!canRetryHeldPurchaseMirror && !soul.currentKioskId) {
    return NextResponse.json({ error: 'Soul listing missing kiosk' }, { status: 409 })
  }

  let soulPackageId: string
  try {
    soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  } catch (configError) {
    return NextResponse.json({ error: configError instanceof Error ? configError.message : 'Missing Soul config' }, { status: 503 })
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(identity.memberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }
  if (walletAddresses.length === 0) {
    return NextResponse.json({ error: 'Bind a Sui wallet before purchasing' }, { status: 403 })
  }

  try {
    if (recoverableStoredSync) {
      const recoverableTxSender = recoverableStoredSync.txSender
        ?? readTransactionSender(await getSuccessfulTransactionBlock(recoverableStoredSync.digest))
      if (!recoverableTxSender || !walletAddresses.some((address) => sameSuiValue(address, recoverableTxSender))) {
        return NextResponse.json(
          {
            error: 'Stored purchase transaction sender does not match the authenticated wallet',
            onChainSuccess: true,
            dbSynced: false,
          },
          { status: 422 },
        )
      }
      const soulState = await getVerifiedSoulState(soul.onChainId, soulPackageId, {
        expectedKioskId: recoverableStoredSync.currentKioskId,
      })
      const soulKioskId = soulState.kioskParentId ?? soulState.ownerObjectId
      if (
        soulState.ownerKind !== 'object'
        || !soulKioskId
        || !sameSuiValue(soulKioskId, recoverableStoredSync.currentKioskId)
      ) {
        const ownershipChangedBody = buildPurchaseOwnershipChangedBody({
          digest: recoverableStoredSync.digest,
          soulOnChainId: soul.onChainId,
        })
        await storeSoulTxSync({
          txDigest,
          routeKey: 'purchase',
          actorKey: identity.memberId,
          resourceKey: soul.onChainId,
          statusCode: 410,
          body: ownershipChangedBody,
        })
        return NextResponse.json(ownershipChangedBody, { status: 410 })
      }

      if (
        soulState.ownerKind === 'object'
        && soulKioskId && sameSuiValue(soulKioskId, recoverableStoredSync.currentKioskId)
      ) {
        const buyerKioskCapState = await getVerifiedPersonalKioskCapState(recoverableStoredSync.currentKioskCapOnChainId)
        if (
          sameSuiValue(buyerKioskCapState.kioskId, recoverableStoredSync.currentKioskId)
          && walletAddresses.some((address) => sameSuiValue(address, buyerKioskCapState.ownerAddress))
          && walletAddresses.some((address) => sameSuiValue(address, recoverableStoredSync.currentOwnerAddress))
        ) {
          try {
            await dbSetSoulOwnership({
              soulOnChainId: soul.onChainId,
              currentOwnerAddress: recoverableStoredSync.currentOwnerAddress,
              currentOwnerMemberId: identity.memberId,
              currentKioskId: recoverableStoredSync.currentKioskId,
              currentKioskCapOnChainId: recoverableStoredSync.currentKioskCapOnChainId,
              listingObjectOnChainId: null,
              listingStatus: 'held',
              listedPriceAtomic: null,
              allowlistVersion: soulState.allowlistVersion,
              expectedCurrentOwnerAddress: soul.currentOwnerAddress,
              expectedCurrentKioskId: soul.currentKioskId,
              expectedListingStatus: narrowListingStatus(soul.listingStatus),
            })
            const syncedBody = {
              digest: recoverableStoredSync.digest,
              soulOnChainId: soul.onChainId,
              currentOwnerAddress: recoverableStoredSync.currentOwnerAddress,
              currentKioskId: recoverableStoredSync.currentKioskId,
              currentKioskCapOnChainId: recoverableStoredSync.currentKioskCapOnChainId,
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
              body: syncedBody,
            })
            return NextResponse.json(syncedBody)
          } catch (syncError) {
            if (syncError instanceof SoulMirrorOwnershipConflictError) {
              const conflictBody = buildPurchaseOwnershipConflictBody({
                digest: recoverableStoredSync.digest,
                soulOnChainId: soul.onChainId,
                currentOwnerAddress: recoverableStoredSync.currentOwnerAddress,
                currentKioskId: recoverableStoredSync.currentKioskId,
                currentKioskCapOnChainId: recoverableStoredSync.currentKioskCapOnChainId,
                ownerLabel: 'buyer',
              })
              await storeSoulTxSync({
                txDigest,
                routeKey: 'purchase',
                actorKey: identity.memberId,
                resourceKey: soul.onChainId,
                statusCode: 409,
                body: conflictBody,
              })
              return NextResponse.json(conflictBody, { status: 409 })
            }
            console.warn('[soul-purchase-mirror] Retry sync failed for cached partial result', {
              memberId: identity.memberId,
              txDigest,
              soulOnChainId: soul.onChainId,
              error: toSafeErrorDetails(syncError),
            })
          }
        }
      }

      const pendingBody = buildPendingPurchaseSyncBody({
        digest: recoverableStoredSync.digest,
        soulOnChainId: soul.onChainId,
        txSender: recoverableTxSender,
        currentOwnerAddress: recoverableStoredSync.currentOwnerAddress,
        currentKioskId: recoverableStoredSync.currentKioskId,
        currentKioskCapOnChainId: recoverableStoredSync.currentKioskCapOnChainId,
      })
      const existingStoredSync = storedSync
      if (existingStoredSync && purchaseSyncBodiesEqual(existingStoredSync.body, pendingBody)) {
        return NextResponse.json(existingStoredSync.body, { status: existingStoredSync.statusCode })
      }
      await storeSoulTxSync({
        txDigest,
        routeKey: 'purchase',
        actorKey: identity.memberId,
        resourceKey: soul.onChainId,
        statusCode: 207,
        body: pendingBody,
      })
      return NextResponse.json(pendingBody, { status: 207 })
    }

    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const txSender = readTransactionSender(transaction)
    if (!txSender || !walletAddresses.some((address) => sameSuiValue(address, txSender))) {
      return NextResponse.json({ error: 'Transaction sender does not match the authenticated wallet' }, { status: 422 })
    }
    const directPurchaseEvent = tryExtractSoulPurchasedEventWithCurrentPackage(transaction, soulPackageId)
    const buyerKioskCapStatePromise = directPurchaseEvent
      ? getVerifiedPersonalKioskCapState(directPurchaseEvent.buyerKioskCapOnChainId)
      : null
    const soulState = await getVerifiedSoulState(
      soul.onChainId,
      soulPackageId,
      directPurchaseEvent ? { expectedKioskId: directPurchaseEvent.buyerKioskId } : undefined,
    )
    const purchaseEvent = directPurchaseEvent ?? extractSoulPurchasedEvent(
      transaction,
      soulPackageId,
      getTrustedPackageIds(soulPackageId, soulState.packageId),
    )
    if (!sameSuiValue(purchaseEvent.soulObjectId, soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction did not purchase the requested Soul' }, { status: 422 })
    }
    if (!canRetryHeldPurchaseMirror && !sameSuiValue(purchaseEvent.sellerKioskId, soul.currentKioskId)) {
      return NextResponse.json({ error: 'Transaction seller kiosk does not match the active listing' }, { status: 422 })
    }
    if (!walletAddresses.some((address) => sameSuiValue(address, purchaseEvent.buyerAddress))) {
      return NextResponse.json({ error: 'Purchased Soul owner does not match the authenticated wallet' }, { status: 422 })
    }

    const soulKioskId2 = soulState.kioskParentId ?? soulState.ownerObjectId
    if (soulState.ownerKind !== 'object' || !soulKioskId2 || !sameSuiValue(soulKioskId2, purchaseEvent.buyerKioskId)) {
      return NextResponse.json({ error: 'Purchased Soul was not moved into the buyer kiosk' }, { status: 422 })
    }
    const buyerKioskCapState = buyerKioskCapStatePromise
      ? await buyerKioskCapStatePromise
      : await getVerifiedPersonalKioskCapState(purchaseEvent.buyerKioskCapOnChainId)
    if (!sameSuiValue(buyerKioskCapState.kioskId, purchaseEvent.buyerKioskId)) {
      return NextResponse.json({ error: 'Purchased Soul kiosk cap does not match the buyer kiosk' }, { status: 422 })
    }
    if (!sameSuiValue(buyerKioskCapState.ownerAddress, purchaseEvent.buyerAddress)) {
      return NextResponse.json({ error: 'Purchased Soul kiosk cap does not belong to the authenticated buyer' }, { status: 422 })
    }

    let statusCode = 200
    let responseBody: Record<string, unknown>
    try {
      await dbSetSoulOwnership({
        soulOnChainId: soul.onChainId,
        currentOwnerAddress: purchaseEvent.buyerAddress,
        currentOwnerMemberId: identity.memberId,
        currentKioskId: purchaseEvent.buyerKioskId,
        currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
        listingObjectOnChainId: null,
        listingStatus: 'held',
        listedPriceAtomic: null,
        allowlistVersion: soulState.allowlistVersion,
        expectedCurrentOwnerAddress: soul.currentOwnerAddress,
        expectedCurrentKioskId: soul.currentKioskId,
        expectedListingStatus: narrowListingStatus(soul.listingStatus),
      })
      responseBody = {
        digest: txDigest,
        soulOnChainId: soul.onChainId,
        currentOwnerAddress: purchaseEvent.buyerAddress,
        currentKioskId: purchaseEvent.buyerKioskId,
        currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
        listingStatus: 'held' as const,
        onChainSuccess: true,
        dbSynced: true,
        txSender,
      }
    } catch (syncError) {
      if (syncError instanceof SoulMirrorOwnershipConflictError) {
        statusCode = 409
        responseBody = buildPurchaseOwnershipConflictBody({
          digest: txDigest,
          soulOnChainId: soul.onChainId,
          currentOwnerAddress: purchaseEvent.buyerAddress,
          currentKioskId: purchaseEvent.buyerKioskId,
          currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
          ownerLabel: 'buyer',
        })
      } else {
        statusCode = 207
        console.error('[soul-purchase-mirror] Local Soul sync failed after confirmed purchase', {
          memberId: identity.memberId,
          txDigest,
          soulOnChainId: soul.onChainId,
          error: toSafeErrorDetails(syncError),
        })
        responseBody = {
          digest: txDigest,
          soulOnChainId: soul.onChainId,
          currentOwnerAddress: purchaseEvent.buyerAddress,
          currentKioskId: purchaseEvent.buyerKioskId,
          currentKioskCapOnChainId: purchaseEvent.buyerKioskCapOnChainId,
          listingStatus: 'held' as const,
          onChainSuccess: true,
          dbSynced: false,
          txSender,
          error: 'Transaction succeeded on chain, but local Soul sync failed.',
        }
      }
    }

    await storeSoulTxSync({
      txDigest,
      routeKey: 'purchase',
      actorKey: identity.memberId,
      resourceKey: soul.onChainId,
      statusCode,
      body: responseBody,
    })

    if (statusCode !== 200) {
      return NextResponse.json(responseBody, { status: statusCode })
    }

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
