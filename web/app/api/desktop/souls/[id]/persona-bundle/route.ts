/**
 * GET /api/desktop/souls/{id}/persona-bundle
 *
 * Returns the persona bundle blob URL for a soul that's in the desktop catalog.
 * The `[id]` param is the catalog entry ID.
 *
 * Auth: desktop token OR human auth (via requireDesktopIdentity).
 *
 * Phase 2: replaces the legacy `resolveDesktopSoulAccess` helper. The active
 * persona sprite is now a slot in the unified `SoulContent` typed-content root
 * (kind=KIND_SPRITE, name=`SoulState.active_sprite_name`). This route looks
 * the slot up directly and forwards the resolved access envelope.
 *
 * Response: { blobUrl, blobId, isEncrypted }
 */

import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { findDesktopPersonaManifestById } from '@/lib/desktop/repository'
import { prisma } from '@/lib/prisma'
import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import {
  ContentAccessDeniedError,
  resolveContentAccessPayload,
} from '@/lib/soulidity/access'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import {
  downloadPolicyFromU8,
  KIND_SPRITE,
} from '@soulidity/sdk'
import { toProjectionNumber } from '@soulidity/sdk'
import type { SoulContentVersionRecord } from '@soulidity/sdk'

export const dynamic = 'force-dynamic'

function asIso(value: Date) {
  return value.toISOString()
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth ─────────────────────────────────────────────
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

  const { id } = await params

  // ── Find the catalog entry manifest ──────────────────
  const manifest = await findDesktopPersonaManifestById(id)
  if (!manifest) {
    return NextResponse.json({ error: 'Catalog entry not found' }, { status: 404 })
  }

  if (manifest.sourceType !== 'soul') {
    // Starter personas use direct file URLs — no persona-bundle needed
    return NextResponse.json(
      { error: 'Persona bundle is only available for soul entries' },
      { status: 400 },
    )
  }

  const sprite = manifest.sprite
  if (!sprite) {
    return NextResponse.json({ error: 'Soul sprite manifest is missing' }, { status: 404 })
  }

  if (sprite.downloadPolicy === 'missing') {
    return NextResponse.json(
      { error: sprite.error ?? 'Soul sprite metadata is missing' },
      { status: 404 },
    )
  }

  if (sprite.downloadPolicy === 'invalid') {
    return NextResponse.json(
      { error: sprite.error ?? 'Soul sprite metadata is invalid' },
      { status: 409 },
    )
  }

  if (sprite.downloadPolicy === 'public') {
    return NextResponse.json({
      blobUrl: sprite.publicUrl ?? null,
      blobId: null,
      isEncrypted: false,
    })
  }

  if (!sprite.assetName || sprite.versionIndex == null) {
    return NextResponse.json(
      { error: 'Soul sprite metadata is incomplete' },
      { status: 409 },
    )
  }

  // ── Resolve the user's member + wallet for access check ─
  const member = await prisma.member.findFirst({
    where: { accountId: auth.accountId!, kind: 'human' },
    select: { id: true },
  })

  if (!member) {
    return NextResponse.json({ error: 'Member not found for this account' }, { status: 404 })
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(member.id)
  } catch {
    walletAddresses = []
  }

  // ── Load the soul mirror + active sprite content version ─
  const soulOnChainId = manifest.sourceRef
  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: soulOnChainId },
    select: {
      onChainId: true,
      stateOnChainId: true,
      contentOnChainId: true,
      paidAccessListOnChainId: true,
    },
  })

  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  if (!soul.contentOnChainId) {
    return NextResponse.json(
      { error: 'Soul content root is not available' },
      { status: 409 },
    )
  }

  const versionRow = await prisma.soulContentVersionRecord.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      contentOnChainId: soul.contentOnChainId,
      kind: KIND_SPRITE,
      name: sprite.assetName,
      versionIndex: sprite.versionIndex,
      deletedAt: null,
    },
  })

  if (!versionRow) {
    return NextResponse.json(
      { error: 'Active sprite content version is missing from the mirror' },
      { status: 404 },
    )
  }

  const version: SoulContentVersionRecord = {
    id: versionRow.id,
    soulOnChainId: versionRow.soulOnChainId,
    contentOnChainId: versionRow.contentOnChainId,
    kind: versionRow.kind,
    kindName: versionRow.kindName,
    name: versionRow.name,
    versionIndex: versionRow.versionIndex,
    blobObjectId: versionRow.blobObjectId,
    blobId: versionRow.blobId,
    readModeMask: versionRow.readModeMask,
    opMask: versionRow.opMask,
    grantScopeMask: versionRow.grantScopeMask,
    isPublic: versionRow.isPublic,
    sealEncrypted: versionRow.sealEncrypted,
    downloadPolicy: downloadPolicyFromU8(versionRow.downloadPolicy),
    sealSidecar: (versionRow.sealSidecar ?? null) as SoulContentVersionRecord['sealSidecar'],
    deletedAt: versionRow.deletedAt ? asIso(versionRow.deletedAt) : null,
    purgedAt: versionRow.purgedAt ? asIso(versionRow.purgedAt) : null,
    createdAtMs: toProjectionNumber(versionRow.createdAtMs, 'SoulContentVersionRecord.createdAtMs'),
    createdAt: asIso(versionRow.createdAt),
    updatedAt: asIso(versionRow.updatedAt),
  }

  try {
    const access = await resolveContentAccessPayload({
      soul: {
        onChainId: soul.onChainId,
        stateOnChainId: soul.stateOnChainId,
        contentOnChainId: soul.contentOnChainId,
        paidAccessListOnChainId: soul.paidAccessListOnChainId,
      },
      version,
      viewerAddresses: walletAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID'),
    })

    return NextResponse.json({
      blobUrl: access.artifact.walrusBlobUrl,
      blobId: access.artifact.walrusBlobId,
      isEncrypted: access.visibility === 'sealed',
    })
  } catch (error) {
    if (error instanceof ContentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
