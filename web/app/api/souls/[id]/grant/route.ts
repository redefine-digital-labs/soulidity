import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  extractSoulGrantIssuedEvent,
  extractSoulGrantRevokedEvent,
  extractSoulGrantSupersededEvent,
} from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  endSoulGrantProjectionFromChain,
  syncGrantProjectionFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredAddress, parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_GRANT_RATE_LIMIT = {
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

  const rateLimit = await takeRateLimitToken(`soul-grant:${auth.identity.memberId}`, SOUL_GRANT_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity grant requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action === 'revoke' ? 'revoke' : body?.action === 'revoke-scope' ? 'revoke-scope' : 'issue'
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }
  const requestedGranteeAddress = parseRequiredAddress(body?.granteeAddress)
  if ((action === 'revoke' || action === 'revoke-scope') && !requestedGranteeAddress) {
    return NextResponse.json({ error: 'granteeAddress must be a valid Sui address' }, { status: 400 })
  }

  const routeKey = action === 'revoke' ? 'grant:revoke' : action === 'revoke-scope' ? 'grant:revoke-scope' : 'grant:issue'
  const stored = await getStoredSoulidityTxSync({
    routeKey,
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

    let responseBody: Record<string, string | null>

    if (action === 'revoke') {
      const revoked = extractSoulGrantRevokedEvent(transaction, packageId)
      if (revoked.soulId !== soul.onChainId) {
        return NextResponse.json({ error: 'Transaction revoked a different Soulidity grant' }, { status: 422 })
      }
      if (requestedGranteeAddress && revoked.granteeAddress !== requestedGranteeAddress) {
        return NextResponse.json({ error: 'Transaction revoked a different grantee grant' }, { status: 422 })
      }

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
        listingObjectOnChainId: soul.listingObjectOnChainId,
        listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
        listingStatus: soul.listingStatus as 'held' | 'listed' | 'floor-violation',
      })
      await endSoulGrantProjectionFromChain({
        grantOnChainId: revoked.grantId,
        status: 'revoked',
      })
      responseBody = {
        txDigest,
        soulOnChainId: mirrored.onChainId,
        revokedGrantOnChainId: revoked.grantId,
        activeGrantCount: String(mirrored.activeGrantCount),
      }
    } else {
      const issued = extractSoulGrantIssuedEvent(transaction, packageId)
      if (issued.soulId !== soul.onChainId) {
        return NextResponse.json({ error: 'Transaction granted access to a different Soulidity object' }, { status: 422 })
      }
      const superseded = (action === 'revoke-scope' || issued.granteeAddress === requestedGranteeAddress)
        ? (() => {
            try {
              return extractSoulGrantSupersededEvent(transaction, packageId)
            } catch {
              return null
            }
          })()
        : null

      const mirroredSoul = await syncSoulProjectionFromChain({
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
        listingObjectOnChainId: soul.listingObjectOnChainId,
        listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
        listingStatus: soul.listingStatus as 'held' | 'listed' | 'floor-violation',
      })
      if (superseded?.oldGrantId) {
        await endSoulGrantProjectionFromChain({
          grantOnChainId: superseded.oldGrantId,
          status: 'superseded',
          replacedByGrantOnChainId: issued.grantId,
        })
      }
      const mirroredGrant = await syncGrantProjectionFromChain({
        packageId,
        grantObjectId: issued.grantId,
        soulOnChainId: soul.onChainId,
        issuedByMemberId: auth.identity.memberId,
      })
      responseBody = {
        txDigest,
        soulOnChainId: mirroredSoul.onChainId,
        activeGrantCount: String(mirroredSoul.activeGrantCount),
        grantOnChainId: mirroredGrant.onChainId,
      }
    }

    await storeSoulidityTxSync({
      routeKey,
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-grant] Failed to mirror Soulidity grant transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      action,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity grant transaction' }, { status: 500 })
  }
}
