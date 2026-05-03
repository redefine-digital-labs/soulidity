import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeBestEffortRateLimitToken } from '@/lib/rate-limit'
import {
  tryExtractMemoryEntryAppendedEvent,
  tryExtractSkillVersionAppendedEvent,
  tryExtractAssetVersionAppendedEvent,
  tryExtractContentAccessListCreatedEvent,
  extractSoulMintedToKioskEvent,
  extractAllSoulMintedToKioskEvents,
  extractAllMemoryEntryAppendedEvents,
  extractAllSkillVersionAppendedEvents,
} from '@/lib/soulidity/events'
import { normalizeSuiValue } from '@/lib/soulidity/queries'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import { upsertMemoryEntryProjection } from '@/lib/soulidity/mirror/upsert-memory'
import { upsertSkillVersionProjection } from '@/lib/soulidity/mirror/upsert-skill'
import { upsertAssetVersionProjection } from '@/lib/soulidity/mirror/upsert-asset'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { SealSidecarRequestError, parseProvidedSidecar } from '@/lib/soulidity/mirror/provided-sidecar'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { getSuccessfulTransactionBlock, readTransactionSender, resolveWalrusBlobId, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import { normalizeTags } from '@/lib/soulidity/tags'
import type { SoulWriterKind } from '@/lib/soulidity/types'

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

function writerKindToString(kind: number): SoulWriterKind {
  if (kind === 0) return 'founder'
  if (kind === 2) return 'granted-agent'
  return 'owner'
}

export async function POST(request: Request) {
  const auth = await requireSoulCreateWalletIdentity(request, { mutation: true })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeBestEffortRateLimitToken(`soul-publish:${auth.identity.memberId}`, SOUL_PUBLISH_RATE_LIMIT)
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

  // Optional `soulOnChainId` disambiguates which `SoulMintedToKiosk` event in
  // the TX to mirror. Required when the TX bundles multiple mints
  // (collection batch publish), optional otherwise (single-soul publish).
  // When provided, it is also the dedup resource key so each soul in the
  // same TX gets its own cache slot.
  const requestedSoulOnChainIdRaw = typeof body?.soulOnChainId === 'string'
    ? normalizeSuiValue(body.soulOnChainId)
    : null
  if (typeof body?.soulOnChainId === 'string' && !requestedSoulOnChainIdRaw) {
    return NextResponse.json({ error: 'soulOnChainId is malformed' }, { status: 400 })
  }
  const requestedSoulOnChainId = requestedSoulOnChainIdRaw ?? null

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'publish',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: requestedSoulOnChainId,
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

    let minted
    let foundingMemory
    let initialSkill
    if (requestedSoulOnChainId) {
      const allMinted = extractAllSoulMintedToKioskEvents(transaction, packageId)
      const match = allMinted.find((event) => event.soulId === requestedSoulOnChainId)
      if (!match) {
        return NextResponse.json(
          { error: `Transaction ${txDigest} does not include a SoulMintedToKiosk event for ${requestedSoulOnChainId}` },
          { status: 404 },
        )
      }
      minted = match
      foundingMemory = extractAllMemoryEntryAppendedEvents(transaction, packageId)
        .find((event) => event.soulId === requestedSoulOnChainId) ?? null
      initialSkill = extractAllSkillVersionAppendedEvents(transaction, packageId)
        .find((event) => event.soulId === requestedSoulOnChainId) ?? null
    } else {
      minted = extractSoulMintedToKioskEvent(transaction, packageId)
      foundingMemory = tryExtractMemoryEntryAppendedEvent(transaction, packageId)
      initialSkill = tryExtractSkillVersionAppendedEvent(transaction, packageId)
    }
    const initialAsset = tryExtractAssetVersionAppendedEvent(transaction, packageId)
    const contentAccessList = tryExtractContentAccessListCreatedEvent(transaction, packageId)

    if (initialAsset?.assetType === 'audio') {
      return NextResponse.json(
        { error: 'Mint-time voice assets are disabled; add voice assets after mint' },
        { status: 422 },
      )
    }

    const providedSoulSidecar = parseProvidedSidecar(body?.sealSidecar, 'sealSidecar')
    const providedMemorySidecar = parseProvidedSidecar(body?.memorySealSidecar, 'memorySealSidecar')
    const providedSkillsSidecar = parseProvidedSidecar(body?.skillsSealSidecar, 'skillsSealSidecar')
    const providedAssetsSidecar = parseProvidedSidecar(body?.assetsSealSidecar, 'assetsSealSidecar')

    // Fail-closed contract gates, mirroring `/api/souls/publish/batch`.
    // The single-Soul publish flow (`web/app/create/gas/page.tsx` →
    // `web/lib/hooks/use-publish.ts`) ALWAYS uploads the Soul character
    // file as `uploadType: 'encrypted'` and the founding-memory file the
    // same way; private skills carry a Seal envelope whenever an initial
    // skill version is appended at mint. Without this gate a misconfigured
    // caller (smoke template, third-party integration) could mirror the
    // mint with `sealSidecar`/`memorySealSidecar` left null and the app
    // would silently persist Souls / founding memories the Seal access
    // path can never decrypt. The asset sidecar requirement is event-
    // visibility driven below (initial assets can legitimately be public)
    // and is checked after `buildSyncSealSidecars`.
    if (!providedSoulSidecar) {
      return NextResponse.json(
        { error: `sealSidecar is required for ${minted.soulId} (single-Soul publish always encrypts Soul content)` },
        { status: 422 },
      )
    }
    if (foundingMemory && !providedMemorySidecar) {
      return NextResponse.json(
        { error: `memorySealSidecar is required for ${minted.soulId} (founding memory blob is encrypted)` },
        { status: 422 },
      )
    }
    if (initialSkill?.visibility === 'private' && !providedSkillsSidecar) {
      return NextResponse.json(
        { error: `skillsSealSidecar is required for ${minted.soulId} (private initial skill version)` },
        { status: 422 },
      )
    }

    let soulSidecar = null
    let memorySidecar = null
    let skillsSidecar = null
    let assetsSidecar = null
    try {
      const builtSidecars = await buildSyncSealSidecars({
        packageId,
        soulObjectId: minted.soulId,
        stateObjectId: minted.stateId,
        soulSidecar: providedSoulSidecar,
        memorySidecar: providedMemorySidecar,
        memoryBinding: foundingMemory ? {
          memoryObjectId: foundingMemory.memoryId,
          timestampKey: foundingMemory.timestampKey,
        } : null,
        skillsSidecar: providedSkillsSidecar,
        skillBinding: initialSkill ? {
          skillsObjectId: initialSkill.skillsId,
          skillName: initialSkill.skillName,
          versionIndex: initialSkill.versionIndex,
        } : null,
        assetsSidecar: providedAssetsSidecar,
        assetBinding: initialAsset ? {
          assetsObjectId: initialAsset.assetsId,
          assetName: initialAsset.assetName,
          versionIndex: initialAsset.versionIndex,
        } : null,
      })
      soulSidecar = builtSidecars.soulSidecar
      memorySidecar = builtSidecars.memorySidecar
      skillsSidecar = builtSidecars.skillsSidecar
      assetsSidecar = builtSidecars.assetsSidecar
    } catch (error) {
      if (error instanceof SealSidecarSyncConfigError) {
        return NextResponse.json({ error: error.message }, { status: 503 })
      }
      throw error
    }
    if (initialAsset?.visibility === 'private' && !assetsSidecar) {
      return NextResponse.json(
        { error: 'assetsSealSidecar is required for private initial asset versions' },
        { status: 422 },
      )
    }

    const mirrored = await syncSoulProjectionFromChain({
      packageId,
      soulObjectId: minted.soulId,
      stateObjectId: minted.stateId,
      memoryObjectId: minted.memoryId,
      tags: normalizeTags(parseStringArray(body?.tags, 12)),
      previewImages: parseStringArray(body?.previewImages, 8),
      readme: typeof body?.readme === 'string' ? body.readme : null,
      sealSidecar: soulSidecar,
      creatorMemberId: auth.identity.memberId,
      currentOwnerMemberId: auth.identity.memberId,
    })
    // Patch: if event found skills but chain query missed it (RPC indexing lag)
    if (initialSkill?.skillsId && !mirrored.skillsOnChainId) {
      await prisma.soulAsset.update({
        where: { onChainId: mirrored.onChainId },
        data: { skillsOnChainId: initialSkill.skillsId },
      })
      mirrored.skillsOnChainId = initialSkill.skillsId
    }
    if (initialAsset?.assetsId && !mirrored.assetsOnChainId) {
      await prisma.soulAsset.update({
        where: { onChainId: mirrored.onChainId },
        data: { assetsOnChainId: initialAsset.assetsId },
      })
      mirrored.assetsOnChainId = initialAsset.assetsId
    }
    if (contentAccessList?.accessListId && !mirrored.accessListOnChainId) {
      await prisma.soulAsset.update({
        where: { onChainId: mirrored.onChainId },
        data: { accessListOnChainId: contentAccessList.accessListId },
      })
      mirrored.accessListOnChainId = contentAccessList.accessListId
    }
    if (minted.metadataId && !mirrored.metadataOnChainId) {
      await prisma.soulAsset.update({
        where: { onChainId: mirrored.onChainId },
        data: { metadataOnChainId: minted.metadataId },
      })
      mirrored.metadataOnChainId = minted.metadataId
    }

    if (foundingMemory) {
      const memoryBlobId = await resolveWalrusBlobId(foundingMemory.blobObjectId)
      await upsertMemoryEntryProjection({
        entry: {
          packageId,
          memoryId: foundingMemory.memoryId,
          soulId: foundingMemory.soulId,
          timestampKey: foundingMemory.timestampKey,
          writerAddress: foundingMemory.writerAddress,
          writerKind: writerKindToString(foundingMemory.writerKind),
          createdAtMs: foundingMemory.createdAtMs,
          blobObjectId: foundingMemory.blobObjectId,
          blobId: memoryBlobId,
        },
        sealSidecar: memorySidecar,
      })
    }
    if (initialSkill) {
      const skillBlobId = await resolveWalrusBlobId(initialSkill.blobObjectId)
      await upsertSkillVersionProjection({
        version: {
          packageId,
          soulId: initialSkill.soulId,
          skillsId: initialSkill.skillsId,
          skillName: initialSkill.skillName,
          versionIndex: initialSkill.versionIndex,
          visibility: initialSkill.visibility,
          deleted: false,
          createdAtMs: initialSkill.createdAtMs,
          blobObjectId: initialSkill.blobObjectId,
          blobId: skillBlobId,
        },
        soulOnChainId: initialSkill.soulId,
        skillsOnChainId: initialSkill.skillsId,
        sealSidecar: skillsSidecar,
      })
    }
    if (initialAsset) {
      const assetBlobId = await resolveWalrusBlobId(initialAsset.blobObjectId)
      await upsertAssetVersionProjection({
        version: {
          soulId: initialAsset.soulId,
          assetsId: initialAsset.assetsId,
          assetName: initialAsset.assetName,
          versionIndex: initialAsset.versionIndex,
          visibility: initialAsset.visibility,
          assetType: initialAsset.assetType,
          blobObjectId: initialAsset.blobObjectId,
          blobId: assetBlobId,
          createdAtMs: initialAsset.createdAtMs,
        },
        soulOnChainId: initialAsset.soulId,
        assetsOnChainId: initialAsset.assetsId,
        sealSidecar: assetsSidecar,
      })
    }

    const responseBody = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      stateOnChainId: mirrored.stateOnChainId,
      memoryOnChainId: mirrored.memoryOnChainId,
      metadataOnChainId: mirrored.metadataOnChainId ?? minted.metadataId,
      foundingMemoryTimestampKey: foundingMemory?.timestampKey ?? null,
      skillsOnChainId: initialSkill?.skillsId ?? null,
      initialSkillName: initialSkill?.skillName ?? null,
      initialSkillVersionIndex: initialSkill?.versionIndex ?? null,
      assetsOnChainId: initialAsset?.assetsId ?? null,
      accessListOnChainId: contentAccessList?.accessListId ?? null,
      initialAssetName: initialAsset?.assetName ?? null,
      initialAssetVersionIndex: initialAsset?.versionIndex ?? null,
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
    if (error instanceof SealSidecarRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[soul-publish] Failed to mirror Soulidity mint', {
      memberId: auth.identity.memberId,
      txDigest,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity publish transaction' }, { status: 500 })
  }
}
