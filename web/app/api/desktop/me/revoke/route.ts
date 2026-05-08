import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { prisma } from '@/lib/prisma'
import {
  findActiveAssetGrantsForPet,
  partialRevokeDesktopPetCredentials,
  revokeDesktopPet,
} from '@/lib/desktop/revoke'

export const dynamic = 'force-dynamic'

/**
 * Revoke the calling desktop pet's identity.
 *
 * Two outcomes depending on on-chain grant state. The grant blocker is
 * authoritative — `findActiveAssetGrantsForPet` consults the local
 * mirror first and re-checks the chain when the mirror is empty, so a
 * never-mirrored or stale on-chain grant can't fail-open this revoke.
 *
 * - When the agent address has NO active asset-scope grant on chain
 *   AND the re-check converged (`incomplete=false`), tear the pet down
 *   completely:
 *     - Delete the `DesktopPet` row (invalidates the bearer `dtk_*`).
 *     - Disable the bound agent `Member` and clear all API key hashes
 *       (active + pending), so any committed `sk-*` is also invalidated.
 *
 * - When the agent address still has active asset-scope grants, OR the
 *   on-chain re-check came back `incomplete` (caller owns more Souls
 *   than the per-call cap, or a transient RPC failed), do a PARTIAL
 *   teardown: clear the bearer token + `Member` API keys, set
 *   `agentStatus='disabled'`, but KEEP the `DesktopPet` row. Reason:
 *   the desktop app cannot sign on behalf of the human owner, so
 *   on-chain grants must be revoked from `/account/pets`. Removing the
 *   pet row would erase the only UI surface that knows which
 *   `agentAddress` to target, stranding any on-chain authorisation we
 *   either confirmed or could not exhaustively rule out. The response
 *   carries `partial: true` plus a `reason` (`active-asset-grants-remain`
 *   when we found grants, or `on-chain-recheck-incomplete` when we
 *   couldn't fully verify) so the desktop app can tell the user to
 *   "open the web app to finish revoke".
 *
 * `WalletBinding` is intentionally preserved either way so the operator
 * can re-link the same agent address later via a fresh device-pair flow.
 *
 * Mirrors the cookie-authenticated `DELETE /api/account/pets/[id]` route;
 * shared DB mutations live in `web/lib/desktop/revoke.ts`.
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

  const { id: desktopPetId, agentMemberId, agentAddress } = auth.desktopPet
  const { accountId } = auth

  // The blocker check must only count grants whose underlying Soul is
  // owned by this account's human member — those are the only grants the
  // human can later revoke from `/account/pets`. Grants issued by another
  // owner's Soul to this pet's address are not revocable here, so they
  // must NOT preserve the pet row (otherwise the user is stuck with a
  // pet row and no UI path to clear it).
  const ownerMember = await prisma.member.findFirst({
    where: { accountId, kind: 'human' },
    select: { id: true },
  })
  const grantsResult = ownerMember
    ? await findActiveAssetGrantsForPet({ agentAddress, ownerMemberId: ownerMember.id })
    : { grants: [], incomplete: false as const }

  // Partial teardown when grants exist OR the chain re-check is
  // incomplete. Both conditions block a clean full delete: incomplete
  // results may hide a live grant the helper couldn't see, so erasing
  // the pet row would leave the user with no convergent revoke surface
  // for it. Treating "incomplete" the same as "grants exist" keeps the
  // bearer-revoke path fail-closed.
  if (grantsResult.grants.length > 0 || grantsResult.incomplete) {
    try {
      await prisma.$transaction(async (tx) => {
        await partialRevokeDesktopPetCredentials(tx, {
          desktopPetId,
          agentMemberId,
          accountId,
        })
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

    if (grantsResult.incomplete && grantsResult.grants.length === 0) {
      return NextResponse.json({
        ok: true,
        partial: true,
        reason: 'on-chain-recheck-incomplete',
        incompleteReason: grantsResult.incompleteReason,
        activeAssetGrants: [],
        message:
          'Desktop credentials cleared. We could not fully verify on-chain grant state — open My Desktop Pets on the web app to confirm and finish revoke.',
      })
    }

    return NextResponse.json({
      ok: true,
      partial: true,
      reason: 'active-asset-grants-remain',
      activeAssetGrants: grantsResult.grants,
      ...(grantsResult.incomplete
        ? { incompleteReason: grantsResult.incompleteReason }
        : {}),
      message:
        'Desktop credentials cleared. Active sprite grants still exist on-chain — open My Desktop Pets on the web app to revoke them with the owner wallet.',
    })
  }

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
