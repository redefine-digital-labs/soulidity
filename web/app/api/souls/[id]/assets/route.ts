import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildSoulRouteWhere } from '@/lib/soulidity/repository'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractAssetVersionAppendedEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { upsertAssetVersionProjection } from '@/lib/soulidity/mirror/upsert-asset'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, resolveWalrusBlobId, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_ASSETS_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const where = buildSoulRouteWhere(id)
  if (!where) return NextResponse.json({ error: 'Invalid soul ID' }, { status: 400 })

  const soul = await prisma.soulAsset.findFirst({ where, select: { onChainId: true } })
  if (!soul) return NextResponse.json({ error: 'Soul not found' }, { status: 404 })

  const [versions, versionIndexes] = await Promise.all([
    prisma.soulAssetVersionRecord.findMany({
      where: { soulOnChainId: soul.onChainId, deletedAt: null },
      orderBy: [{ assetName: 'asc' }, { versionIndex: 'desc' }],
    }),
    prisma.soulAssetVersionRecord.findMany({
      where: { soulOnChainId: soul.onChainId },
      select: { assetName: true, versionIndex: true },
    }),
  ])

  const nextVersionIndexes = versionIndexes.reduce<Record<string, number>>((acc, row) => {
    acc[row.assetName] = Math.max(acc[row.assetName] ?? 0, row.versionIndex + 1)
    return acc
  }, {})

  return NextResponse.json({
    assets: versions.map((v) => ({ ...v, createdAtMs: Number(v.createdAtMs) })),
    nextVersionIndexes,
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

  const rateLimit = await takeRateLimitToken(`soul-assets:${auth.identity.memberId}`, SOUL_ASSETS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity assets requests, try again later' },
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
    routeKey: 'assets:append',
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

    const appended = extractAssetVersionAppendedEvent(transaction, packageId)
    if (appended.soulId !== soul.onChainId) {
      return NextResponse.json({ error: 'Transaction appended an asset version for a different Soul' }, { status: 422 })
    }

    const rawAssetsEnvelope = typeof body?.rawAssetsEnvelope === 'string' ? body.rawAssetsEnvelope : null

    if (appended.visibility === 'private' && !rawAssetsEnvelope) {
      return NextResponse.json(
        { error: 'rawAssetsEnvelope is required for private asset versions' },
        { status: 422 },
      )
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
    let assetsSidecar = null
    try {
      const builtSidecars = await buildSyncSealSidecars({
        packageId,
        soulObjectId: soul.onChainId,
        stateObjectId: soul.stateOnChainId,
        rawAssetsEnvelope,
        assetBinding: {
          assetsObjectId: appended.assetsId,
          assetName: appended.assetName,
          versionIndex: appended.versionIndex,
        },
      })
      assetsSidecar = builtSidecars.assetsSidecar
    } catch (error) {
      if (error instanceof SealSidecarSyncConfigError) {
        return NextResponse.json({ error: error.message }, { status: 503 })
      }
      throw error
    }
    const assetBlobId = await resolveWalrusBlobId(appended.blobObjectId)
    const mirroredVersion = await upsertAssetVersionProjection({
      version: {
        soulId: appended.soulId,
        assetsId: appended.assetsId,
        assetName: appended.assetName,
        versionIndex: appended.versionIndex,
        visibility: appended.visibility,
        assetType: appended.assetType,
        blobObjectId: appended.blobObjectId,
        blobId: assetBlobId,
        createdAtMs: appended.createdAtMs,
      },
      soulOnChainId: soul.onChainId,
      assetsOnChainId: appended.assetsId,
      sealSidecar: assetsSidecar,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirroredSoul.onChainId,
      assetsOnChainId: appended.assetsId,
      assetName: mirroredVersion.assetName,
      versionIndex: mirroredVersion.versionIndex,
    }

    await storeSoulidityTxSync({
      routeKey: 'assets:append',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: soul.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-assets] Failed to mirror Soulidity assets append transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity assets transaction' }, { status: 500 })
  }
}
