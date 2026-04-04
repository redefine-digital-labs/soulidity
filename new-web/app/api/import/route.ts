import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { extractSoulMintedToKioskEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const IMPORT_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

function parseStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

export async function POST(request: Request) {
  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const { limited, retryAfterSeconds } = await takeRateLimitToken(`soul-import:${auth.identity.memberId}`, IMPORT_RATE_LIMIT)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity import requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'import',
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

    const minted = extractSoulMintedToKioskEvent(transaction, packageId)
    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: minted.soulId,
      stateObjectId: minted.stateId,
      memoryObjectId: minted.memoryId,
      category: typeof body?.category === 'string' ? body.category.trim() || 'imported' : 'imported',
      tags: parseStringArray(body?.tags, 12),
      previewImages: parseStringArray(body?.previewImages, 8),
      readme: typeof body?.readme === 'string' ? body.readme : null,
      sealSidecar: body?.sealSidecar && typeof body.sealSidecar === 'object' ? body.sealSidecar as never : null,
      latestSkillVersionSealSidecar:
        body?.skillsSealSidecar && typeof body.skillsSealSidecar === 'object'
          ? body.skillsSealSidecar as never
          : null,
      creatorMemberId: auth.identity.memberId,
      currentOwnerMemberId: auth.identity.memberId,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      provenanceKind: mirrored.provenanceKind,
      originRef: mirrored.originRef,
    }

    await storeSoulidityTxSync({
      routeKey: 'import',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-import] Failed to mirror Soulidity import', {
      memberId: auth.identity.memberId,
      txDigest,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity import transaction' }, { status: 500 })
  }
}
