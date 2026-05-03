import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { extractAllSkillVersionAppendedEvents } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import { SealSidecarRequestError, parseProvidedSidecar } from '@/lib/soulidity/mirror/provided-sidecar'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { upsertSkillVersionProjection } from '@/lib/soulidity/mirror/upsert-skill'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulAssetDetailByRouteId, findSoulSkillVersionsPageByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, resolveWalrusBlobId, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import { clampSkillVersionPageSize } from '@/lib/soulidity/skill-version-pagination'

export const dynamic = 'force-dynamic'

const SOUL_SKILLS_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const page = await findSoulSkillVersionsPageByRouteId({
    id,
    limit: clampSkillVersionPageSize(url.searchParams.get('limit')),
    cursor: url.searchParams.get('cursor'),
  })
  if (!page) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  return NextResponse.json(page)
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

    const appendedEvents = extractAllSkillVersionAppendedEvents(transaction, packageId)
    if (appendedEvents.length === 0) {
      return NextResponse.json({ error: 'SkillVersionAppended event is missing from the transaction' }, { status: 422 })
    }
    if (appendedEvents.some((appended) => appended.soulId !== soul.onChainId)) {
      return NextResponse.json({ error: 'Transaction appended a skill version for a different Soul' }, { status: 422 })
    }

    const providedSkillsSidecar = parseProvidedSidecar(body?.skillsSealSidecar ?? body?.sealSidecar, 'skillsSealSidecar')
    const providedSkillsSidecars = Array.isArray(body?.skillsSealSidecars)
      ? body.skillsSealSidecars.map((value, index) => parseProvidedSidecar(value, `skillsSealSidecars[${index}]`))
      : null

    // Per-event sidecar resolution. The legacy single `skillsSealSidecar` is
    // ONLY valid for a single-event request — multi-event requests must use
    // `skillsSealSidecars` so each appended version carries its own envelope.
    // Without this, two private appended events plus a 1-element array would
    // mirror the second version with a null sidecar that downloaders cannot
    // satisfy. Mirrors the asset route's per-event guard.
    const sidecarForIndex = (i: number) =>
      providedSkillsSidecars?.[i]
      ?? (i === 0 && appendedEvents.length === 1 ? providedSkillsSidecar : null)

    for (let i = 0; i < appendedEvents.length; i++) {
      if (appendedEvents[i].visibility !== 'private') continue
      if (!sidecarForIndex(i)) {
        return NextResponse.json(
          {
            error: appendedEvents.length === 1
              ? 'skillsSealSidecar is required for private skill versions'
              : `skillsSealSidecars[${i}] is required for private skill version at index ${i}`,
          },
          { status: 422 },
        )
      }
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
    const mirroredVersions = []
    for (let i = 0; i < appendedEvents.length; i++) {
      const appended = appendedEvents[i]
      const sidecarForEvent = sidecarForIndex(i)
      let skillSidecar = null
      try {
        const builtSidecars = await buildSyncSealSidecars({
          packageId,
          soulObjectId: soul.onChainId,
          stateObjectId: soul.stateOnChainId,
          skillsSidecar: sidecarForEvent,
          skillBinding: {
            skillsObjectId: appended.skillsId,
            skillName: appended.skillName,
            versionIndex: appended.versionIndex,
          },
        })
        skillSidecar = builtSidecars.skillsSidecar
      } catch (error) {
        if (error instanceof SealSidecarSyncConfigError) {
          return NextResponse.json({ error: error.message }, { status: 503 })
        }
        throw error
      }
      const skillBlobId = await resolveWalrusBlobId(appended.blobObjectId)
      mirroredVersions.push(await upsertSkillVersionProjection({
        version: {
          packageId,
          soulId: appended.soulId,
          skillsId: appended.skillsId,
          skillName: appended.skillName,
          versionIndex: appended.versionIndex,
          visibility: appended.visibility,
          deleted: false,
          createdAtMs: appended.createdAtMs,
          blobObjectId: appended.blobObjectId,
          blobId: skillBlobId,
        },
        soulOnChainId: soul.onChainId,
        skillsOnChainId: appended.skillsId,
        sealSidecar: skillSidecar,
      }))
    }

    const firstAppended = appendedEvents[0]
    const firstMirroredVersion = mirroredVersions[0]

    const responseBody = {
      txDigest,
      soulOnChainId: mirroredSoul.onChainId,
      skillsOnChainId: firstAppended.skillsId,
      skillName: firstMirroredVersion.skillName,
      versionIndex: firstMirroredVersion.versionIndex,
      ...(mirroredVersions.length > 1
        ? {
            versions: mirroredVersions.map((version) => ({
              skillName: version.skillName,
              versionIndex: version.versionIndex,
            })),
          }
        : {}),
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
    if (error instanceof SealSidecarRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[soul-skills] Failed to mirror Soulidity skills append transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity skills transaction' }, { status: 500 })
  }
}
