import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractMemoryEntryAppendedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import { upsertMemoryEntryProjection } from '@/lib/soulidity/mirror/upsert-memory'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, resolveWalrusBlobId, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
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
  const auth = await requireHumanWalletIdentity({ mutation: request })
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

  const rawMemoryEnvelope = typeof body?.rawMemoryEnvelope === 'string' ? body.rawMemoryEnvelope : null

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

    let memorySidecar = null
    try {
      const builtSidecars = await buildSyncSealSidecars({
        packageId,
        soulObjectId: soul.onChainId,
        stateObjectId: soul.stateOnChainId,
        rawMemoryEnvelope,
        memoryBinding: {
          memoryObjectId: appended.memoryId,
          timestampKey: appended.timestampKey,
        },
      })
      memorySidecar = builtSidecars.memorySidecar
    } catch (error) {
      if (error instanceof SealSidecarSyncConfigError) {
        return NextResponse.json({ error: error.message }, { status: 503 })
      }
      throw error
    }

    const memoryBlobId = await resolveWalrusBlobId(appended.blobObjectId)
    await upsertMemoryEntryProjection({
      entry: {
        packageId,
        memoryId: appended.memoryId,
        soulId: appended.soulId,
        timestampKey: appended.timestampKey,
        writerAddress: appended.writerAddress,
        writerKind: writerKindToString(appended.writerKind),
        createdAtMs: appended.createdAtMs,
        blobObjectId: appended.blobObjectId,
        blobId: memoryBlobId,
      },
      sealSidecar: memorySidecar,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: appended.soulId,
      memoryOnChainId: appended.memoryId,
      timestampKey: appended.timestampKey,
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
