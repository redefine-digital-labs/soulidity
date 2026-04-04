import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { extractSkillVersionAppendedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  syncSkillVersionProjectionFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_SKILLS_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  return NextResponse.json({
    soulOnChainId: soul.onChainId,
    skillsOnChainId: soul.skillsOnChainId,
    latestSkillVersionOnChainId: soul.latestSkillVersionOnChainId,
    items: soul.skillVersions.map((version) => ({
      ...version,
      soulOnChainId: version.soulOnChainId,
    })),
  })
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

  const rateLimit = await takeRateLimitToken(`soul-skills:${auth.identity.memberId}`, SOUL_SKILLS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity skills requests, try again later' },
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
    routeKey: 'skills:append',
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

    const appended = extractSkillVersionAppendedEvent(transaction, packageId)
    if (appended.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction appended a skill version for a different Soul' }, { status: 422 })
    }

    const mirroredSoul = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: soul.onChainId,
      stateObjectId: soul.stateOnChainId,
      memoryObjectId: soul.memoryOnChainId,
      category: soul.category,
      tags: soul.tags,
      previewImages: soul.previewImages,
      readme: soul.readme,
      sealSidecar: soul.sealSidecar as never,
      creatorMemberId: soul.creatorMemberId,
      currentOwnerMemberId: soul.currentOwnerMemberId,
      listingObjectOnChainId: soul.listingObjectOnChainId,
      listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
      listingStatus: soul.listingStatus === 'listed' ? 'listed' : 'held',
    })
    const mirroredVersion = await syncSkillVersionProjectionFromChain({
      packageId,
      versionObjectId: appended.versionId,
      soulOnChainId: soul.onChainId,
      skillsOnChainId: appended.skillsId,
      sealSidecar: body?.sealSidecar && typeof body.sealSidecar === 'object' ? body.sealSidecar as never : null,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirroredSoul.onChainId,
      skillsOnChainId: appended.skillsId,
      versionOnChainId: mirroredVersion.versionOnChainId,
      latestSkillVersionOnChainId: mirroredSoul.latestSkillVersionOnChainId,
    }

    await storeSoulidityTxSync({
      routeKey: 'skills:append',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-skills] Failed to mirror Soulidity skills append transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity skills transaction' }, { status: 500 })
  }
}
