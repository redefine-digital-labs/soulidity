import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  tryExtractMemoryEntryAppendedEvent,
  tryExtractSkillVersionAppendedEvent,
  tryExtractAssetVersionAppendedEvent,
  tryExtractContentAccessListCreatedEvent,
  extractSoulMintedToKioskEvent,
} from '@/lib/soulidity/events'
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
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import { normalizeTags } from '@/lib/soulidity/tags'
import type { SoulWriterKind } from '@/lib/soulidity/types'

export const dynamic = 'force-dynamic'

const PERSONAL_JOIN_RATE_LIMIT = {
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
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const { limited, retryAfterSeconds } = await takeRateLimitToken(`personal-join:${auth.identity.memberId}`, PERSONAL_JOIN_RATE_LIMIT)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many personal join requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }

  const stored = await getStoredSoulidityTxSync({
    routeKey: 'personal-join',
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
    const foundingMemory = tryExtractMemoryEntryAppendedEvent(transaction, packageId)
    const initialSkill = tryExtractSkillVersionAppendedEvent(transaction, packageId)
    const initialAsset = tryExtractAssetVersionAppendedEvent(transaction, packageId)
    const contentAccessList = tryExtractContentAccessListCreatedEvent(transaction, packageId)
    const providedSoulSidecar = parseProvidedSidecar(body?.sealSidecar, 'sealSidecar')
    const providedMemorySidecar = parseProvidedSidecar(body?.memorySealSidecar, 'memorySealSidecar')
    const providedSkillsSidecar = parseProvidedSidecar(body?.skillsSealSidecar, 'skillsSealSidecar')
    const providedAssetsSidecar = parseProvidedSidecar(body?.assetsSealSidecar, 'assetsSealSidecar')

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
    // Patch: if event found IDs but chain query missed them (RPC indexing lag)
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
      metadataOnChainId: mirrored.metadataOnChainId ?? minted.metadataId,
      provenanceKind: mirrored.provenanceKind,
      originRef: mirrored.originRef,
      foundingMemoryTimestampKey: foundingMemory?.timestampKey ?? null,
      skillsOnChainId: initialSkill?.skillsId ?? null,
      initialSkillName: initialSkill?.skillName ?? null,
      initialSkillVersionIndex: initialSkill?.versionIndex ?? null,
      assetsOnChainId: initialAsset?.assetsId ?? null,
      accessListOnChainId: contentAccessList?.accessListId ?? null,
      initialAssetName: initialAsset?.assetName ?? null,
      initialAssetVersionIndex: initialAsset?.versionIndex ?? null,
    }

    await storeSoulidityTxSync({
      routeKey: 'personal-join',
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
    console.error('[personal-join] Failed to mirror Soulidity personal join', {
      memberId: auth.identity.memberId,
      txDigest,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity personal join transaction' }, { status: 500 })
  }
}
