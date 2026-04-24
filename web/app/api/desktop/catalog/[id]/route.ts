import { NextResponse } from 'next/server'
import { normalizeSuiAddress } from '@mysten/sui/utils'

import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { findDesktopPersonaManifestById } from '@/lib/desktop/repository'
import { prisma } from '@/lib/prisma'
import {
  AssetAccessDeniedError,
  resolveSoulAssetVersionAccessPayload,
} from '@/lib/soulidity/asset-version-access'

export const dynamic = 'force-dynamic'

function safeNormalizeSuiAddress(value: string | null | undefined) {
  if (!value) return null
  try {
    return normalizeSuiAddress(value)
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // Public marketplace surface: dynamic `soul:<onChainId>` lookups must be
  // gated to `listingStatus: 'listed'` so held/unpublished Souls do not leak
  // their sprite manifest (and public Walrus URL) to unauthenticated callers.
  // Owned held Souls reach the renderer via the authenticated
  // `/api/desktop/me/souls` and `/api/desktop/souls/[id]/persona-bundle` paths.
  const manifest = await findDesktopPersonaManifestById(id, { publicOnly: true })

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

  const auth = await requireDesktopIdentity(request)
  if (auth.error) {
    return auth.error
  }

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

  try {
    const privateAccess = await resolveSoulAssetVersionAccessPayload({
      soulOnChainId: manifest.sourceRef,
      assetName: sprite.assetName,
      versionIndex: sprite.versionIndex,
      viewerAddresses: effectiveViewerAddresses,
    })

    if (privateAccess.visibility !== 'private') {
      return NextResponse.json({ error: 'Expected private sprite access payload' }, { status: 409 })
    }

    return NextResponse.json({
      ...manifest,
      sprite: {
        ...sprite,
        privateAccess,
      },
    })
  } catch (error) {
    if (error instanceof AssetAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
