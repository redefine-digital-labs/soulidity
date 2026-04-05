import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { unsealDekEnvelope } from '@web/lib/services/dek-envelope'
import { createSealClient, getSealRuntimeConfig } from '@web/lib/services/seal'
import { createSealEnvelopeSidecar, createSkillVersionSealEnvelopeSidecar, type SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'
import { extractSoulMintedToKioskEvent } from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { getSuccessfulTransactionBlock, getSoulSkillsObject, getSoulStateObject, readTransactionSender, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const SOUL_PUBLISH_RATE_LIMIT = {
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

  const rateLimit = await takeRateLimitToken(`soul-publish:${auth.identity.memberId}`, SOUL_PUBLISH_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity publish sync requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'publish',
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

    // Unseal DEK envelopes into proper SealEnvelopeSidecars for downstream access
    const rawSoulEnvelope = typeof body?.sealSidecar === 'string' ? body.sealSidecar : null
    const rawSkillsEnvelope = typeof body?.skillsSealSidecar === 'string' ? body.skillsSealSidecar : null

    let soulSidecar: SealEnvelopeSidecar | null = null
    let skillsSidecar: SealEnvelopeSidecar | null = null

    // Resolve on-chain package for Seal binding — after a Sui package upgrade the env
    // package may differ from the type-defining package embedded in on-chain objects.
    // Seal ciphertext must be bound to the same package used by the access-time approval TX.
    const soulState = (rawSoulEnvelope || rawSkillsEnvelope)
      ? await getSoulStateObject(minted.stateId, packageId)
      : null
    const sealPackageId = soulState?.packageId ?? packageId

    if (rawSoulEnvelope) {
      const runtimeConfig = getSealRuntimeConfig()
      if (runtimeConfig.threshold <= 0 || runtimeConfig.serverConfigs.length === 0) {
        return NextResponse.json({ error: 'Seal is not configured for Soul publishing' }, { status: 503 })
      }
      const unsealedEnvelope = unsealDekEnvelope(rawSoulEnvelope)
      try {
        soulSidecar = await createSealEnvelopeSidecar({
          sealClient: createSealClient(),
          packageId: sealPackageId,
          soulObjectId: minted.soulId,
          threshold: runtimeConfig.threshold,
          dek: unsealedEnvelope.dek,
          iv: unsealedEnvelope.iv,
          contentHash: unsealedEnvelope.contentHash,
          mimeType: unsealedEnvelope.mimeType,
          fileName: unsealedEnvelope.fileName,
        })
      } finally {
        unsealedEnvelope.dek.fill(0)
      }
    }

    if (rawSkillsEnvelope && soulState?.skillsId) {
      const skills = await getSoulSkillsObject(soulState.skillsId, packageId)
      if (skills.latestVersionId) {
        const runtimeConfig = getSealRuntimeConfig()
        const unsealedSkillsEnvelope = unsealDekEnvelope(rawSkillsEnvelope)
        try {
          skillsSidecar = await createSkillVersionSealEnvelopeSidecar({
            sealClient: createSealClient(),
            packageId: sealPackageId,
            versionObjectId: skills.latestVersionId,
            threshold: runtimeConfig.threshold,
            dek: unsealedSkillsEnvelope.dek,
            iv: unsealedSkillsEnvelope.iv,
            contentHash: unsealedSkillsEnvelope.contentHash,
            mimeType: unsealedSkillsEnvelope.mimeType,
            fileName: unsealedSkillsEnvelope.fileName,
          })
        } finally {
          unsealedSkillsEnvelope.dek.fill(0)
        }
      }
    }

    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: minted.soulId,
      stateObjectId: minted.stateId,
      memoryObjectId: minted.memoryId,
      category: typeof body?.category === 'string' ? body.category.trim() || 'uncategorized' : 'uncategorized',
      tags: parseStringArray(body?.tags, 12),
      previewImages: parseStringArray(body?.previewImages, 8),
      readme: typeof body?.readme === 'string' ? body.readme : null,
      sealSidecar: soulSidecar,
      latestSkillVersionSealSidecar: skillsSidecar,
      creatorMemberId: auth.identity.memberId,
      currentOwnerMemberId: auth.identity.memberId,
    })

    const responseBody = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      stateOnChainId: mirrored.stateOnChainId,
      memoryOnChainId: mirrored.memoryOnChainId,
      listingStatus: mirrored.listingStatus,
    }

    await storeSoulidityTxSync({
      routeKey: 'publish',
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: mirrored.onChainId,
      statusCode: 200,
      responseBody,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[soul-publish] Failed to mirror Soulidity mint', {
      memberId: auth.identity.memberId,
      txDigest,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity publish transaction' }, { status: 500 })
  }
}
