import type { Prisma } from '@db/prisma-client'

/**
 * Shared DB mutation for revoking / unlinking a desktop pet.
 *
 * Called by both:
 * - `POST /api/desktop/me/revoke` (desktop-authenticated `dtk_*` path) — used
 *   by the desktop app's "Reset Pet Identity" / unlink flow.
 * - `DELETE /api/account/pets/[id]` (browser cookie-authenticated path) — used
 *   by the `/account/pets` management surface.
 *
 * The two routes have distinct auth + ownership checks. This helper only
 * runs the DB mutation that is identical for both:
 *
 * 1. Delete the `DesktopPet` row (invalidates any `dtk_*`).
 * 2. Disable the bound agent `Member` and clear all API key hashes
 *    (active + pending), so any committed `sk-*` is also invalidated.
 *
 * `WalletBinding` is intentionally preserved so the operator can re-link the
 * same agent address later via a fresh device-pair flow (see
 * `persistConfirmedDesktopPet` "revive" branch).
 *
 * Callers must invoke this inside a transaction — both writes must succeed
 * together, or neither.
 */
export async function revokeDesktopPet(
  tx: Prisma.TransactionClient,
  params: { desktopPetId: string; agentMemberId: string; accountId?: string },
): Promise<void> {
  const { desktopPetId, agentMemberId, accountId } = params

  // Scope the DELETE by accountId when provided so a buggy caller can't
  // accidentally delete a pet owned by a different account. Both real callers
  // verify ownership before reaching this helper, but the extra `where`
  // clause is cheap defense in depth.
  await tx.desktopPet.delete({
    where: accountId ? { id: desktopPetId, accountId } : { id: desktopPetId },
  })

  await tx.member.update({
    where: { id: agentMemberId },
    data: {
      agentStatus: 'disabled',
      apiKey: null,
      apiKeyHash: null,
      apiKeyRotationId: null,
      pendingApiKeyHash: null,
      pendingApiKeyRotationId: null,
      pendingApiKeyRotationExpiresAt: null,
    },
  })
}
