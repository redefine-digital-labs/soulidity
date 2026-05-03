import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeBestEffortRateLimitToken } from '@/lib/rate-limit'
import {
  extractAllSoulMintedToKioskEvents,
  extractAllSoulAddedToCollectionEvents,
  extractAllMemoryEntryAppendedEvents,
  extractAllSkillVersionAppendedEvents,
  extractAllAssetVersionAppendedEvents,
  extractAllContentAccessListCreatedEvents,
} from '@/lib/soulidity/events'
import { normalizeSuiValue } from '@/lib/soulidity/queries'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import { upsertMemoryEntryProjection } from '@/lib/soulidity/mirror/upsert-memory'
import { upsertSkillVersionProjection } from '@/lib/soulidity/mirror/upsert-skill'
import { syncSoulProjectionFromChain, syncCollectionProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { SealSidecarRequestError, parseProvidedSidecar } from '@/lib/soulidity/mirror/provided-sidecar'
import { parseRequiredTxDigest } from '@/lib/soulidity/request'
import { findSoulCollectionDetailByRouteId } from '@/lib/soulidity/repository'
import { getSuccessfulTransactionBlock, readTransactionSender, resolveWalrusBlobId, waitForTransactionBestEffort } from '@/lib/soulidity/queries'
import { assertTransactionSender, requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import { normalizeTags } from '@/lib/soulidity/tags'
import type { SoulWriterKind } from '@/lib/soulidity/types'

export const dynamic = 'force-dynamic'

const SOUL_PUBLISH_BATCH_RATE_LIMIT = {
  max: 6,
  windowMs: 5 * 60 * 1000,
} as const

type ProvidedSidecar = ReturnType<typeof parseProvidedSidecar>

type PublishSyncBody = {
  soulOnChainId: string
  tags: string[]
  previewImages: string[]
  readme: string | null
  sealSidecar: ProvidedSidecar
  memorySealSidecar: ProvidedSidecar
  skillsSealSidecar: ProvidedSidecar
  assetsSealSidecar: ProvidedSidecar
}

function writerKindToString(kind: number): SoulWriterKind {
  if (kind === 0) return 'founder'
  if (kind === 2) return 'granted-agent'
  return 'owner'
}

function parseStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function parseSyncBodies(value: unknown): PublishSyncBody[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return 'syncBodies must be a non-empty array'
  }
  const out: PublishSyncBody[] = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i] as Record<string, unknown> | null
    if (!item || typeof item !== 'object') {
      return `syncBodies[${i}] must be an object`
    }
    const rawSoulId = typeof item.soulOnChainId === 'string'
      ? normalizeSuiValue(item.soulOnChainId)
      : null
    if (!rawSoulId) {
      return `syncBodies[${i}].soulOnChainId is required and must be a Sui object id`
    }
    out.push({
      soulOnChainId: rawSoulId,
      tags: normalizeTags(parseStringArray(item.tags, 12)),
      previewImages: parseStringArray(item.previewImages, 8),
      readme: typeof item.readme === 'string' ? item.readme : null,
      sealSidecar: parseProvidedSidecar(item.sealSidecar, `syncBodies[${i}].sealSidecar`),
      memorySealSidecar: parseProvidedSidecar(item.memorySealSidecar, `syncBodies[${i}].memorySealSidecar`),
      skillsSealSidecar: parseProvidedSidecar(item.skillsSealSidecar, `syncBodies[${i}].skillsSealSidecar`),
      assetsSealSidecar: parseProvidedSidecar(item.assetsSealSidecar, `syncBodies[${i}].assetsSealSidecar`),
    })
  }
  return out
}

export async function POST(request: Request) {
  const auth = await requireSoulCreateWalletIdentity(request, { mutation: true })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeBestEffortRateLimitToken(`soul-publish-batch:${auth.identity.memberId}`, SOUL_PUBLISH_BATCH_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity batch publish requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const collectionOnChainIdRaw = typeof body?.collectionOnChainId === 'string'
    ? normalizeSuiValue(body.collectionOnChainId)
    : null
  if (!collectionOnChainIdRaw) {
    return NextResponse.json({ error: 'collectionOnChainId is required and must be a Sui object id' }, { status: 400 })
  }

  const expectedSoulCount = Number(body?.expectedSoulCount)
  const expectedBindCount = Number(body?.expectedBindCount)
  if (!Number.isInteger(expectedSoulCount) || expectedSoulCount <= 0) {
    return NextResponse.json({ error: 'expectedSoulCount must be a positive integer' }, { status: 400 })
  }
  if (!Number.isInteger(expectedBindCount) || expectedBindCount < 0) {
    return NextResponse.json({ error: 'expectedBindCount must be a non-negative integer' }, { status: 400 })
  }
  const supportsExpectedBindCount = expectedBindCount === 0 || expectedBindCount === expectedSoulCount
  if (!supportsExpectedBindCount) {
    return NextResponse.json(
      { error: 'expectedBindCount must be 0 for mint-only chunks or equal expectedSoulCount for the fast-path bundle' },
      { status: 400 },
    )
  }
  const shouldMirrorCollectionBind = expectedBindCount > 0

  let syncBodies: PublishSyncBody[]
  try {
    const parsed = parseSyncBodies(body?.syncBodies)
    if (typeof parsed === 'string') {
      return NextResponse.json({ error: parsed }, { status: 400 })
    }
    syncBodies = parsed
  } catch (error) {
    if (error instanceof SealSidecarRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
  if (syncBodies.length !== expectedSoulCount) {
    return NextResponse.json(
      { error: `syncBodies length (${syncBodies.length}) does not match expectedSoulCount (${expectedSoulCount})` },
      { status: 400 },
    )
  }

  const collection = await findSoulCollectionDetailByRouteId(collectionOnChainIdRaw)
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  }

  const dedupResourceKey = `${collection.onChainId}:batch:${expectedSoulCount}:bind:${expectedBindCount}`
  const stored = await getStoredSoulidityTxSync({
    routeKey: 'publish:batch',
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: dedupResourceKey,
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

    const mintedEvents = extractAllSoulMintedToKioskEvents(transaction, packageId)
    const bindEvents = extractAllSoulAddedToCollectionEvents(transaction, packageId)
    const memoryEvents = extractAllMemoryEntryAppendedEvents(transaction, packageId)
    const skillEvents = extractAllSkillVersionAppendedEvents(transaction, packageId)
    // Asset and content_access events are emitted at most once per minted
    // soul. Batched mints can emit N copies, so build per-soul maps and look
    // up by `soulId` rather than picking the first event in the digest.
    const assetEvents = extractAllAssetVersionAppendedEvents(transaction, packageId)
    const contentAccessEvents = extractAllContentAccessListCreatedEvents(transaction, packageId)
    const assetByEventSoulId = new Map(assetEvents.map((event) => [event.soulId.toLowerCase(), event]))
    const contentAccessByEventSoulId = new Map(
      contentAccessEvents.map((event) => [event.soulId.toLowerCase(), event]),
    )

    if (mintedEvents.length !== expectedSoulCount) {
      return NextResponse.json(
        { error: `TX has ${mintedEvents.length} SoulMintedToKiosk events but expectedSoulCount is ${expectedSoulCount}` },
        { status: 422 },
      )
    }
    if (bindEvents.length !== expectedBindCount) {
      return NextResponse.json(
        { error: `TX has ${bindEvents.length} SoulAddedToCollection events but expectedBindCount is ${expectedBindCount}` },
        { status: 422 },
      )
    }
    if (shouldMirrorCollectionBind) {
      for (const bind of bindEvents) {
        if (bind.collectionId.toLowerCase() !== collection.onChainId.toLowerCase()) {
          return NextResponse.json(
            { error: `SoulAddedToCollection event targets collection ${bind.collectionId} but expected ${collection.onChainId}` },
            { status: 422 },
          )
        }
      }
    }

    // For each requested soul, find the matching mint event + per-soul auxiliary
    // events. Reject up front if any sync body's soulOnChainId is not in the TX.
    const mintByEventSoulId = new Map(mintedEvents.map((event) => [event.soulId.toLowerCase(), event]))
    const bindByEventSoulId = new Map(bindEvents.map((event) => [event.soulId.toLowerCase(), event]))
    // Per-soul auxiliary event maps so the sidecar-vs-event contract can be
    // enforced before any mirror write. The collection batch publish flow
    // (web/lib/hooks/use-collection-publish.ts) always uploads the Soul's
    // character file and founding memory file as `uploadType: 'encrypted'`, so
    // every minted Soul in this route MUST ship a content `sealSidecar`, and
    // every founding-memory event MUST ship a `memorySealSidecar`. Private
    // initial skill versions emitted at mint MUST ship a `skillsSealSidecar`
    // for the same reason — without it the projection would persist a private
    // skill blob the app can never decrypt. Mirrors the single-Soul guard in
    // `/api/souls/publish`.
    const memoryByEventSoulId = new Map(memoryEvents.map((event) => [event.soulId.toLowerCase(), event]))
    const skillByEventSoulId = new Map(skillEvents.map((event) => [event.soulId.toLowerCase(), event]))
    for (const sb of syncBodies) {
      const lower = sb.soulOnChainId.toLowerCase()
      if (!mintByEventSoulId.has(lower)) {
        return NextResponse.json(
          { error: `syncBodies[${sb.soulOnChainId}] has no matching SoulMintedToKiosk event in this TX` },
          { status: 422 },
        )
      }
      if (shouldMirrorCollectionBind && !bindByEventSoulId.has(lower)) {
        return NextResponse.json(
          { error: `syncBodies[${sb.soulOnChainId}] has no matching SoulAddedToCollection event in this TX` },
          { status: 422 },
        )
      }
      if (!sb.sealSidecar) {
        return NextResponse.json(
          { error: `sealSidecar is required for ${sb.soulOnChainId} (batch publish always encrypts Soul content)` },
          { status: 422 },
        )
      }
      if (memoryByEventSoulId.has(lower) && !sb.memorySealSidecar) {
        return NextResponse.json(
          { error: `memorySealSidecar is required for ${sb.soulOnChainId} (founding memory blob is encrypted)` },
          { status: 422 },
        )
      }
      const initialSkillForSoul = skillByEventSoulId.get(lower) ?? null
      if (initialSkillForSoul?.visibility === 'private' && !sb.skillsSealSidecar) {
        return NextResponse.json(
          { error: `skillsSealSidecar is required for ${sb.soulOnChainId} (private initial skill version)` },
          { status: 422 },
        )
      }
    }

    const syncs: Array<{
      soulOnChainId: string
      stateOnChainId: string
      memoryOnChainId: string | null
      metadataOnChainId: string | null
      skillsOnChainId: string | null
      assetsOnChainId: string | null
      accessListOnChainId: string | null
      foundingMemoryTimestampKey: number | bigint | null
      initialSkillName: string | null
      initialSkillVersionIndex: number | null
      initialAssetName: string | null
      initialAssetVersionIndex: number | null
    }> = []

    // Build sidecars and mirror each soul. We do not wrap this in
    // `prisma.$transaction` because each step needs RPC reads (Walrus blob id
    // lookups, Sui object reads inside the helpers); the sync helpers are
    // idempotent under retry.
    for (const sb of syncBodies) {
      const minted = mintByEventSoulId.get(sb.soulOnChainId.toLowerCase())!
      const foundingMemory = memoryEvents.find((e) => e.soulId === minted.soulId) ?? null
      const initialSkill = skillEvents.find((e) => e.soulId === minted.soulId) ?? null
      const initialAsset = assetByEventSoulId.get(minted.soulId.toLowerCase()) ?? null
      const contentAccessList = contentAccessByEventSoulId.get(minted.soulId.toLowerCase()) ?? null

      if (initialAsset?.assetType === 'audio') {
        return NextResponse.json(
          { error: `Mint-time voice assets are disabled for ${minted.soulId}; add voice assets after mint` },
          { status: 422 },
        )
      }

      let soulSidecar = null
      let memorySidecar = null
      let skillsSidecar = null
      let assetsSidecar = null
      try {
        const built = await buildSyncSealSidecars({
          packageId,
          soulObjectId: minted.soulId,
          stateObjectId: minted.stateId,
          soulSidecar: sb.sealSidecar,
          memorySidecar: sb.memorySealSidecar,
          memoryBinding: foundingMemory ? {
            memoryObjectId: foundingMemory.memoryId,
            timestampKey: foundingMemory.timestampKey,
          } : null,
          skillsSidecar: sb.skillsSealSidecar,
          skillBinding: initialSkill ? {
            skillsObjectId: initialSkill.skillsId,
            skillName: initialSkill.skillName,
            versionIndex: initialSkill.versionIndex,
          } : null,
          assetsSidecar: sb.assetsSealSidecar,
          assetBinding: initialAsset ? {
            assetsObjectId: initialAsset.assetsId,
            assetName: initialAsset.assetName,
            versionIndex: initialAsset.versionIndex,
          } : null,
        })
        soulSidecar = built.soulSidecar
        memorySidecar = built.memorySidecar
        skillsSidecar = built.skillsSidecar
        assetsSidecar = built.assetsSidecar
      } catch (error) {
        if (error instanceof SealSidecarSyncConfigError) {
          return NextResponse.json({ error: error.message }, { status: 503 })
        }
        throw error
      }
      if (initialAsset?.visibility === 'private' && !assetsSidecar) {
        return NextResponse.json(
          { error: `assetsSealSidecar is required for ${minted.soulId} (private initial asset)` },
          { status: 422 },
        )
      }

      const mirrored = await syncSoulProjectionFromChain({
        packageId,
        soulObjectId: minted.soulId,
        stateObjectId: minted.stateId,
        memoryObjectId: minted.memoryId,
        tags: sb.tags,
        previewImages: sb.previewImages,
        readme: sb.readme,
        sealSidecar: soulSidecar,
        creatorMemberId: auth.identity.memberId,
        currentOwnerMemberId: auth.identity.memberId,
      })
      if (shouldMirrorCollectionBind) {
        // The bind event already landed in the same TX; mirror collectionOnChainId
        // directly so the soul appears as bound regardless of indexer lag.
        await prisma.soulAsset.updateMany({
          where: { onChainId: mirrored.onChainId },
          data: { collectionOnChainId: collection.onChainId },
        })
      }
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

      syncs.push({
        soulOnChainId: mirrored.onChainId,
        stateOnChainId: mirrored.stateOnChainId,
        memoryOnChainId: mirrored.memoryOnChainId,
        metadataOnChainId: mirrored.metadataOnChainId ?? minted.metadataId,
        skillsOnChainId: initialSkill?.skillsId ?? null,
        assetsOnChainId: initialAsset?.assetsId ?? null,
        accessListOnChainId: contentAccessList?.accessListId ?? null,
        foundingMemoryTimestampKey: foundingMemory?.timestampKey ?? null,
        initialSkillName: initialSkill?.skillName ?? null,
        initialSkillVersionIndex: initialSkill?.versionIndex ?? null,
        initialAssetName: initialAsset?.assetName ?? null,
        initialAssetVersionIndex: initialAsset?.versionIndex ?? null,
      })
    }

    // Reconcile collection supply from on-chain truth so soulCount matches
    // the new current_supply after all binds in this TX.
    const collectionMirror = shouldMirrorCollectionBind
      ? await syncCollectionProjectionFromChain({
          packageId,
          collectionObjectId: collection.onChainId,
          creatorMemberId: collection.creatorMemberId,
          currentHolderMemberId: collection.currentHolderMemberId,
          listingObjectOnChainId: collection.listingObjectOnChainId,
          listedPriceAtomic: collection.listedPriceAtomic == null ? null : BigInt(collection.listedPriceAtomic.toString()),
          listingStatus: collection.listingStatus === 'listed' ? 'listed' : 'held',
          floorPriceAtomic: collection.floorPriceAtomic == null ? null : BigInt(collection.floorPriceAtomic.toString()),
        })
      : collection

    const responseBody = {
      txDigest,
      collectionOnChainId: collection.onChainId,
      collectionSoulCount: collectionMirror.soulCount,
      maxSoulSupply: collectionMirror.maxSoulSupply == null ? null : collectionMirror.maxSoulSupply.toString(),
      syncs,
    }

    try {
      await storeSoulidityTxSync({
        routeKey: 'publish:batch',
        txDigest,
        actorKey: auth.identity.memberId,
        resourceKey: dedupResourceKey,
        statusCode: 200,
        responseBody,
      })
    } catch (syncErr) {
      console.warn('[soul-publish-batch] storeSoulidityTxSync failed (non-fatal)', {
        txDigest,
        error: syncErr instanceof Error ? syncErr.message : String(syncErr),
      })
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SealSidecarRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[soul-publish-batch] Failed to mirror Soulidity batch publish', {
      memberId: auth.identity.memberId,
      txDigest,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity batch publish transaction' }, { status: 500 })
  }
}
