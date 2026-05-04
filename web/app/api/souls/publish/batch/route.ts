import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeBestEffortRateLimitToken } from '@/lib/rate-limit'
import {
  extractAllContentVersionAppendedEvents,
  extractAllSoulMintedToKioskEvents,
  extractAllSoulAddedToCollectionEvents,
  extractAllSoulPaidAccessListCreatedEvents,
} from '@soulidity/sdk'
import { normalizeSuiValue } from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import {
  syncCollectionProjectionFromChain,
  syncContentVersionProjectionFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { SealSidecarRequestError } from '@/lib/soulidity/mirror/provided-sidecar'
import { parseRequiredTxDigest } from '@soulidity/sdk'
import { findSoulCollectionDetailByRouteId } from '@/lib/soulidity/repository'
import {
  getSuccessfulTransactionBlock,
  readTransactionSender,
  resolveWalrusBlobId,
  waitForTransactionBestEffort,
} from '@soulidity/sdk'
import { assertTransactionSender, requireSoulCreateWalletIdentity } from '@/lib/soulidity/server'
import { normalizeTags } from '@soulidity/sdk'
import {
  parseContentSidecars,
  type ContentSidecarMap,
} from '@/lib/soulidity/mirror/parse-content-sidecars'

export const dynamic = 'force-dynamic'

const SOUL_PUBLISH_BATCH_RATE_LIMIT = {
  max: 6,
  windowMs: 5 * 60 * 1000,
} as const

type PublishSyncBody = {
  soulOnChainId: string
  tags: string[]
  previewImages: string[]
  readme: string | null
  currentKioskCapOnChainId: string | null
  contentSidecars: ContentSidecarMap
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
    let contentSidecars: ContentSidecarMap
    try {
      contentSidecars = parseContentSidecars(item.contentSidecars, `syncBodies[${i}].contentSidecars`)
    } catch (error) {
      if (error instanceof SealSidecarRequestError) {
        return error.message
      }
      throw error
    }
    out.push({
      soulOnChainId: rawSoulId,
      tags: normalizeTags(parseStringArray(item.tags, 12)),
      previewImages: parseStringArray(item.previewImages, 8),
      readme: typeof item.readme === 'string' ? item.readme : null,
      currentKioskCapOnChainId: typeof item.currentKioskCapOnChainId === 'string'
        ? item.currentKioskCapOnChainId
        : null,
      contentSidecars,
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
    const contentVersionEvents = extractAllContentVersionAppendedEvents(transaction, packageId)
    const paidAccessListEvents = extractAllSoulPaidAccessListCreatedEvents(transaction, packageId)

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

    // Per-soul event maps so the sidecar-vs-event contract can be enforced
    // before any mirror write.
    const mintByEventSoulId = new Map(mintedEvents.map((event) => [event.soulId.toLowerCase(), event]))
    const bindByEventSoulId = new Map(bindEvents.map((event) => [event.soulId.toLowerCase(), event]))
    const versionsBySoulId = (() => {
      const out = new Map<string, typeof contentVersionEvents>()
      for (const event of contentVersionEvents) {
        const key = event.soulId.toLowerCase()
        const list = out.get(key) ?? []
        list.push(event)
        out.set(key, list)
      }
      return out
    })()
    const paidAccessByEventSoulId = new Map(
      paidAccessListEvents.map((event) => [event.soulId.toLowerCase(), event]),
    )

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
      const versionsForSoul = versionsBySoulId.get(lower) ?? []
      if (versionsForSoul.length === 0) {
        return NextResponse.json(
          { error: `syncBodies[${sb.soulOnChainId}] has no ContentVersionAppended events in this TX` },
          { status: 422 },
        )
      }
    }

    const syncs: Array<{
      soulOnChainId: string
      stateOnChainId: string
      contentOnChainId: string | null
      paidAccessListOnChainId: string | null
      contentVersionCount: number
    }> = []

    // Build sidecars and mirror each soul. We do not wrap this in
    // `prisma.$transaction` because each step needs RPC reads (Walrus blob id
    // lookups, Sui object reads inside the helpers); the sync helpers are
    // idempotent under retry.
    for (const sb of syncBodies) {
      const minted = mintByEventSoulId.get(sb.soulOnChainId.toLowerCase())!
      const versionsForSoul = versionsBySoulId.get(sb.soulOnChainId.toLowerCase()) ?? []
      const paidAccessListEvent = paidAccessByEventSoulId.get(sb.soulOnChainId.toLowerCase()) ?? null

      const sidecarInputs = versionsForSoul.map((version) => ({
        kind: version.kind,
        name: version.name,
        versionIndex: version.versionIndex,
        sealEncrypted: version.sealEncrypted,
        sidecar: sb.contentSidecars.get(`${version.kind}::${version.name}::${version.versionIndex}`) ?? null,
      }))

      let validatedEntries
      try {
        const built = buildSyncSealSidecars({
          contentObjectId: minted.contentId,
          entries: sidecarInputs,
        })
        validatedEntries = built.validatedEntries
      } catch (error) {
        if (error instanceof SealSidecarSyncConfigError) {
          return NextResponse.json({ error: error.message }, { status: 422 })
        }
        throw error
      }

      const mirrored = await syncSoulProjectionFromChain({
        packageId,
        soulObjectId: minted.soulId,
        stateObjectId: minted.stateId,
        tags: sb.tags,
        previewImages: sb.previewImages,
        readme: sb.readme,
        currentKioskCapOnChainId: sb.currentKioskCapOnChainId,
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

      // Mirror each ContentVersionAppended row.
      for (let i = 0; i < versionsForSoul.length; i++) {
        const version = versionsForSoul[i]
        const validated = validatedEntries[i]
        const blobId = await resolveWalrusBlobId(version.blobObjectId)
        await syncContentVersionProjectionFromChain({
          soulOnChainId: version.soulId,
          contentOnChainId: version.contentId,
          kind: version.kind,
          kindName: version.kindName,
          name: version.name,
          versionIndex: version.versionIndex,
          blobObjectId: version.blobObjectId,
          blobId,
          readModeMask: version.readModeMask,
          opMask: version.opMask,
          grantScopeMask: version.grantScopeMask,
          isPublic: version.isPublic,
          sealEncrypted: version.sealEncrypted,
          downloadPolicy: version.downloadPolicy,
          sealSidecar: validated.validatedSidecar,
          createdAtMs: version.createdAtMs,
        })
      }

      syncs.push({
        soulOnChainId: mirrored.onChainId,
        stateOnChainId: mirrored.stateOnChainId,
        contentOnChainId: mirrored.contentOnChainId ?? minted.contentId,
        paidAccessListOnChainId: mirrored.paidAccessListOnChainId
          ?? paidAccessListEvent?.paidAccessListId
          ?? null,
        contentVersionCount: versionsForSoul.length,
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
