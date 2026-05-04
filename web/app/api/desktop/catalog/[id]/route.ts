import { NextResponse } from 'next/server'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { findDesktopPersonaManifestById } from '@/lib/desktop/repository'
import { prisma } from '@/lib/prisma'
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
import type { DesktopPersonaManifest } from '@/lib/types/desktop'

export const dynamic = 'force-dynamic'

function safeNormalizeSuiAddress(value: string | null | undefined) {
  if (!value) return null
  try {
    return normalizeSuiAddress(value)
  } catch {
    return null
  }
}

function asIso(value: Date) {
  return value.toISOString()
}

function hasDesktopAuthHint(request: Request) {
  return Boolean(request.headers.get('authorization') || request.headers.get('cookie'))
}

type DesktopMemberContext = {
  member: { id: string }
  walletAddresses: string[]
}

type DesktopMemberContextResult = {
  memberContext: DesktopMemberContext | null
  error: NextResponse | null
}

type AuthenticatedHeldSoulManifestResult = {
  manifest: DesktopPersonaManifest | null
  memberContext: DesktopMemberContext | null
  error: NextResponse | null
}

async function resolveDesktopMemberContext(request: Request): Promise<DesktopMemberContextResult> {
  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return { memberContext: null, error: auth.error }
  }

  const member = await prisma.member.findFirst({
    where: { accountId: auth.accountId!, kind: 'human' },
    select: { id: true },
  })

  if (!member) {
    return {
      memberContext: null,
      error: NextResponse.json({ error: 'Member not found for this account' }, { status: 404 }),
    }
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(member.id)
  } catch {
    walletAddresses = []
  }

  return { memberContext: { member, walletAddresses }, error: null }
}

async function resolveAuthenticatedHeldSoulManifest(
  id: string,
  request: Request,
): Promise<AuthenticatedHeldSoulManifestResult> {
  const memberResult = await resolveDesktopMemberContext(request)
  if (memberResult.error) {
    return { manifest: null, memberContext: null, error: memberResult.error }
  }

  const memberContext = memberResult.memberContext!
  const member = memberContext.member
  const manifest = await findDesktopPersonaManifestById(id)
  if (!manifest) {
    return {
      manifest: null,
      memberContext: null,
      error: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }

  if (manifest.sourceType !== 'soul') {
    return { manifest, memberContext, error: null }
  }

  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: manifest.sourceRef },
    select: { currentOwnerMemberId: true },
  })

  if (!soul) {
    return {
      manifest: null,
      memberContext: null,
      error: NextResponse.json({ error: 'Soul not found' }, { status: 404 }),
    }
  }

  if (soul.currentOwnerMemberId !== member.id) {
    return {
      manifest: null,
      memberContext: null,
      error: NextResponse.json(
        { error: 'Authenticated desktop access to this held Soul requires ownership' },
        { status: 403 },
      ),
    }
  }

  return { manifest, memberContext, error: null }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // Public marketplace surface: dynamic `soul:<onChainId>` lookups must be
  // gated to `listingStatus: 'listed'` so held/unpublished Souls do not leak
  // their sprite manifest (and public Walrus URL) to unauthenticated callers.
  // Owned held Souls can fall through to the authenticated owner-only fallback;
  // unauthenticated callers still see only listed/public catalog entries.
  const publicManifest = await findDesktopPersonaManifestById(id, { publicOnly: true })
  const heldSoulResult = publicManifest || !hasDesktopAuthHint(request)
    ? { manifest: null, memberContext: null, error: null }
    : await resolveAuthenticatedHeldSoulManifest(id, request)
  if (heldSoulResult.error) {
    return heldSoulResult.error
  }
  const manifest = publicManifest ?? heldSoulResult.manifest
  let memberContext = heldSoulResult.memberContext

  if (!manifest) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (manifest.sourceType !== 'soul') {
    return NextResponse.json(manifest)
  }

  const sprite = manifest.sprite
  if (!sprite) {
    return NextResponse.json({ error: 'Soul sprite manifest is missing' }, { status: 404 })
  }

  if (sprite.downloadPolicy === 'missing') {
    return NextResponse.json({ error: sprite.error ?? 'Soul sprite metadata is missing' }, { status: 404 })
  }

  if (sprite.downloadPolicy === 'invalid') {
    return NextResponse.json({ error: sprite.error ?? 'Soul sprite metadata is invalid' }, { status: 422 })
  }

  if (sprite.downloadPolicy === 'public') {
    return NextResponse.json(manifest)
  }

  if (!sprite.assetName || sprite.versionIndex == null) {
    return NextResponse.json({ error: 'Soul sprite metadata is incomplete' }, { status: 422 })
  }

  if (!memberContext) {
    const memberResult = await resolveDesktopMemberContext(request)
    if (memberResult.error) {
      return memberResult.error
    }
    memberContext = memberResult.memberContext
  }
  const walletAddresses = memberContext?.walletAddresses ?? []

  const url = new URL(request.url)
  const rawViewer = url.searchParams.get('viewer')
  const viewerAddress = safeNormalizeSuiAddress(rawViewer)
  if (rawViewer && !viewerAddress) {
    return NextResponse.json({ error: 'Invalid viewer wallet address' }, { status: 400 })
  }

  let effectiveViewerAddresses = walletAddresses
  if (viewerAddress) {
    const normalizedBindings = new Set(
      walletAddresses
        .map((address) => safeNormalizeSuiAddress(address))
        .filter((address): address is string => address !== null),
    )
    if (!normalizedBindings.has(viewerAddress)) {
      return NextResponse.json(
        {
          error:
            'The active desktop wallet does not match any Sui wallet bound to this account. Re-link the desktop or switch wallets before downloading protected sprites.',
        },
        { status: 403 },
      )
    }
    effectiveViewerAddresses = [viewerAddress]
  }

  // Phase 2: load the soul mirror + the active sprite content version from
  // `soul_content_version_records` (single typed-content table). The legacy
  // `SoulAssetVersionRecord` table is gone — every kind of slot now lives in
  // `SoulContentVersionRecord`.
  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: manifest.sourceRef },
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
    return NextResponse.json({ error: 'Soul content root is not available' }, { status: 409 })
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
      viewerAddresses: effectiveViewerAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    })

    if (access.visibility !== 'sealed') {
      return NextResponse.json(
        { error: 'Expected sealed sprite access payload' },
        { status: 409 },
      )
    }

    return NextResponse.json({
      ...manifest,
      sprite: {
        ...sprite,
        privateAccess: access,
      },
    })
  } catch (error) {
    if (error instanceof ContentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
