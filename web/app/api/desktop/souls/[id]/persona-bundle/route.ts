/**
 * GET /api/desktop/souls/{id}/persona-bundle
 *
 * Returns the persona bundle blob URL for a soul that's in the desktop catalog.
 * The `[id]` param is the catalog entry ID.
 *
 * Auth: desktop token OR human auth (via requireDesktopIdentity).
 *
 * For public souls: returns the Walrus blob URL directly.
 * For private/encrypted souls: verifies access (owner or active grant),
 *   then returns the blob URL + metadata so the desktop client can download it.
 *
 * Response: { blobUrl, blobId, isEncrypted }
 */

import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { findDesktopPersonaManifestById } from '@/lib/desktop/repository'
import { resolveDesktopSoulAccess } from '@/lib/soulidity/asset-access'
import { prisma } from '@web/lib/prisma'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'

export const dynamic = 'force-dynamic'

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

  // ── Resolve soul access ──────────────────────────────
  const soulOnChainId = manifest.sourceRef
  const access = await resolveDesktopSoulAccess({
    soulOnChainId,
    viewerAddresses: walletAddresses,
    viewerMemberId: member.id,
  })

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  return NextResponse.json({
    blobUrl: access.blobUrl,
    blobId: access.blobId,
    isEncrypted: access.isEncrypted,
  })
}
