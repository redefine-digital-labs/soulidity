import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractSkillVersionDeletedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { markSkillVersionDeletedFromChain, syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_SKILLS_DELETE_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

function parseVersionParam(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; skillName: string; versionIndex: string }> },
) {
  const { id, skillName, versionIndex } = await params
  const parsedVersionIndex = parseVersionParam(versionIndex)
  if (parsedVersionIndex == null) {
    return NextResponse.json({ error: 'versionIndex must be a non-negative integer' }, { status: 400 })
  }

  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`soul-skills-delete:${auth.identity.memberId}`, SOUL_SKILLS_DELETE_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity skill delete requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'skills:delete',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: `${soul.onChainId}:${skillName}:${parsedVersionIndex}`,
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

    const deleted = extractSkillVersionDeletedEvent(transaction, packageId)
    if (
      deleted.soulId !== soul.onChainId
      || deleted.skillName !== skillName
      || deleted.versionIndex !== parsedVersionIndex
    ) {
      return NextResponse.json({ error: 'Transaction deleted a different skill version' }, { status: 422 })
    }

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
    await markSkillVersionDeletedFromChain({
      skillsOnChainId: deleted.skillsId,
      skillName: deleted.skillName,
      versionIndex: deleted.versionIndex,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirroredSoul.onChainId,
      skillsOnChainId: deleted.skillsId,
      skillName: deleted.skillName,
      versionIndex: deleted.versionIndex,
      deletedAt: new Date().toISOString(),
    }

    await storeSoulidityTxSync({
      routeKey: 'skills:delete',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: `${soul.onChainId}:${skillName}:${parsedVersionIndex}`,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-skills-delete] Failed to mirror Soulidity skill delete transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      skillName,
      versionIndex: parsedVersionIndex,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity skill delete transaction' }, { status: 500 })
  }
}
