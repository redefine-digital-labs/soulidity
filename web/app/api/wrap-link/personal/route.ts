import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  extractAllContentVersionAppendedEvents,
  extractSoulMintedToKioskEvent,
  tryExtractSoulPaidAccessListCreatedEvent,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import {
  syncContentVersionProjectionFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { SealSidecarRequestError } from '@/lib/soulidity/mirror/provided-sidecar'
import { parseRequiredTxDigest } from '@soulidity/sdk'
import {
  getSuccessfulTransactionBlock,
  readTransactionSender,
  resolveWalrusBlobId,
  waitForTransactionBestEffort,
} from '@soulidity/sdk'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import { normalizeTags } from '@soulidity/sdk'
import { parseContentSidecars } from '@/lib/soulidity/mirror/parse-content-sidecars'

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

  let contentSidecars: ReturnType<typeof parseContentSidecars>
  try {
    contentSidecars = parseContentSidecars(body?.contentSidecars, 'contentSidecars')
  } catch (error) {
    if (error instanceof SealSidecarRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  try {
    await waitForTransactionBestEffort(txDigest)
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderError = assertTransactionSender(readTransactionSender(transaction), auth.walletAddresses)
    if (senderError) {
      return senderError
    }

    const minted = extractSoulMintedToKioskEvent(transaction, packageId)
    const allContentVersions = extractAllContentVersionAppendedEvents(transaction, packageId)
    const versionsForSoul = allContentVersions.filter((event) => event.soulId === minted.soulId)
    if (versionsForSoul.length === 0) {
      return NextResponse.json(
        { error: `Transaction ${txDigest} does not include any ContentVersionAppended events for ${minted.soulId}` },
        { status: 422 },
      )
    }

    const paidAccessListEvent = (() => {
      const all = tryExtractSoulPaidAccessListCreatedEvent(transaction, packageId)
      if (!all) return null
      return all.soulId === minted.soulId ? all : null
    })()

    const sidecarInputs = versionsForSoul.map((version) => ({
      kind: version.kind,
      name: version.name,
      versionIndex: version.versionIndex,
      sealEncrypted: version.sealEncrypted,
      sidecar: contentSidecars.get(`${version.kind}::${version.name}::${version.versionIndex}`) ?? null,
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
      tags: normalizeTags(parseStringArray(body?.tags, 12)),
      previewImages: parseStringArray(body?.previewImages, 8),
      readme: typeof body?.readme === 'string' ? body.readme : null,
      currentKioskCapOnChainId: typeof body?.currentKioskCapOnChainId === 'string'
        ? body.currentKioskCapOnChainId
        : null,
      creatorMemberId: auth.identity.memberId,
      currentOwnerMemberId: auth.identity.memberId,
    })

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

    const responseBody = {
      txDigest,
      soulOnChainId: mirrored.onChainId,
      stateOnChainId: mirrored.stateOnChainId,
      contentOnChainId: mirrored.contentOnChainId ?? minted.contentId,
      paidAccessListOnChainId: mirrored.paidAccessListOnChainId
        ?? paidAccessListEvent?.paidAccessListId
        ?? null,
      contentVersionCount: versionsForSoul.length,
      provenanceKind: mirrored.provenanceKind,
      originRef: mirrored.originRef,
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
