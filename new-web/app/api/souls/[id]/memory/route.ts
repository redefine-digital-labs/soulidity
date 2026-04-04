import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { extractMemoryEntryAppendedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { upsertMemoryEntryProjection } from '@/lib/soulidity/mirror/upsert-memory'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import type { SoulWriterKind } from '@/lib/soulidity/types'

export const dynamic = 'force-dynamic'

const SOUL_MEMORY_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

function writerKindToString(kind: number): SoulWriterKind {
  if (kind === 0) return 'founder'
  if (kind === 2) return 'granted-agent'
  return 'owner'
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`soul-memory:${auth.identity.memberId}`, SOUL_MEMORY_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity memory requests, try again later' },
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

  // Memory appends are naturally idempotent — the upsert uses the on-chain
  // entry ID as unique key, so we skip tx-sync idempotency checks.

  try {
    await waitForTransactionBestEffort(txDigest)
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderError = assertTransactionSender(readTransactionSender(transaction), auth.walletAddresses)
    if (senderError) {
      return senderError
    }

    const appended = extractMemoryEntryAppendedEvent(transaction, packageId)
    if (appended.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction appended a memory entry for a different Soul' }, { status: 422 })
    }

    await upsertMemoryEntryProjection({
      entry: {
        objectId: appended.entryId,
        packageId,
        soulId: appended.soulId,
        index: appended.index,
        writerAddress: appended.writerAddress,
        writerKind: writerKindToString(appended.writerKind),
        createdAtMs: appended.createdAtMs,
        blobObjectId: appended.blobObjectId,
        blobId: null,
        previousEntryId: null,
      },
      memoryOnChainId: appended.memoryId,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: appended.soulId,
      memoryEntryOnChainId: appended.entryId,
      entryIndex: appended.index,
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-memory] Failed to mirror Soulidity memory append transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity memory transaction' }, { status: 500 })
  }
}
