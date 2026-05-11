import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractSoulPaidAccessRevokedEvent, getRequiredSoulidityEnv } from '@soulidity/sdk'
import { parseRequiredAddress, parseRequiredTxDigest } from '@soulidity/sdk'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@soulidity/sdk'
import { markPaidAccessEntryRevokedFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const PAID_ACCESS_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

function parseKind(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    return null
  }
  return value
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`soul-paid-access:${auth.identity.memberId}`, PAID_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity paid-access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action
  if (action !== 'revoke') {
    return NextResponse.json({ error: 'Unsupported paid-access action' }, { status: 400 })
  }

  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }
  const buyerAddress = parseRequiredAddress(body?.buyerAddress)
  if (!buyerAddress) {
    return NextResponse.json({ error: 'buyerAddress must be a valid Sui address' }, { status: 400 })
  }
  const kind = parseKind(body?.kind)
  if (kind == null) {
    return NextResponse.json({ error: 'kind must be a non-negative u32 integer' }, { status: 400 })
  }

  const routeKey = 'paid-access:revoke' as const
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

    const revoked = extractSoulPaidAccessRevokedEvent(transaction, packageId)
    if (revoked.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction revoked paid access on a different Soul' }, { status: 422 })
    }
    if (revoked.granteeAddress !== buyerAddress) {
      return NextResponse.json({ error: 'Transaction revoked a different buyer entry' }, { status: 422 })
    }
    if (revoked.kind !== kind) {
      return NextResponse.json({ error: 'Transaction revoked a different kind entry' }, { status: 422 })
    }

    await markPaidAccessEntryRevokedFromChain({
      paidAccessListOnChainId: revoked.paidAccessListId,
      buyerAddress: revoked.granteeAddress,
      kind: revoked.kind,
    })

    const responseBody: Record<string, string | number> = {
      txDigest,
      soulOnChainId: soul.onChainId,
      paidAccessListOnChainId: revoked.paidAccessListId,
      buyerAddress: revoked.granteeAddress,
      kind: revoked.kind,
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
    console.error('[soul-paid-access] Failed to mirror paid-access revoke', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      buyerAddress,
      kind,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror paid-access revoke transaction' }, { status: 500 })
  }
}
