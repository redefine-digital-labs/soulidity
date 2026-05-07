import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { prisma } from '@/lib/prisma'
import { revokeDesktopPet } from '@/lib/desktop/revoke'

export const dynamic = 'force-dynamic'

/**
 * Revoke the calling desktop pet's identity entirely:
 * - Delete the `DesktopPet` row (invalidates the bearer `dtk_*`).
 * - Disable the bound agent `Member` and clear all API key hashes
 *   (active + pending), so any committed `sk-*` is also invalidated.
 *
 * `WalletBinding` is intentionally preserved so the operator can re-link
 * the same agent address later via a fresh device-pair flow.
 *
 * Mirrors the cookie-authenticated `DELETE /api/account/pets/[id]` route;
 * shared DB mutation lives in `web/lib/desktop/revoke.ts`.
 *
 * Bearer-token auth here uses `allowExpiredDesktopToken: true`. Possession
 * of the token hash is cryptographic proof of ownership, and revoke is
 * always a tear-down (never escalates access). Without this opt-in, a
 * `dtk_*` whose `desktopAccessTokenIssuedAt` is older than 90 days would
 * be rejected with 401 even though the underlying `DesktopPet` row still
 * exists, forcing the desktop reset helper to choose between leaving
 * orphaned server-side state (treat 401 as "pet gone") or stranding the
 * keypair on disk (treat 401 as a hard error). Allowing expired tokens
 * for revoke restores the invariant that 401 from this route uniquely
 * means "no pet matches this token hash" — i.e. the pet is already gone.
 */
export async function POST(request: Request) {
  const auth = await requireDesktopIdentity(request, {
    mutation: true,
    allowExpiredDesktopToken: true,
  })
  if (auth.error) {
    return auth.error
  }

  if (!auth.desktopPet) {
    return NextResponse.json({ error: 'Desktop pet identity required' }, { status: 403 })
  }

  const { id: desktopPetId, agentMemberId } = auth.desktopPet
  const { accountId } = auth

  try {
    await prisma.$transaction(async (tx) => {
      await revokeDesktopPet(tx, { desktopPetId, agentMemberId, accountId })
    })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2025'
    ) {
      return NextResponse.json({ error: 'Desktop pet not found' }, { status: 404 })
    }
    throw error
  }

  return NextResponse.json({ ok: true })
}
