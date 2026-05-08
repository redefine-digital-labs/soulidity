import { NextResponse } from 'next/server'

import { requireIdentity } from '@/lib/auth/identity'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * List the calling human account's desktop pets.
 *
 * - Cookie-based session auth only (no API key path makes sense here — pets
 *   belong to a human account, not to an agent).
 * - Reject `kind === 'agent'` so a leaked API key cannot enumerate the pets
 *   bound to its owner account.
 * - Hash leakage protection: the response surfaces `hasActiveApiKey:
 *   boolean` rather than `apiKeyHash` itself.
 */
export async function GET() {
  const { error, identity } = await requireIdentity()
  if (error) {
    return error
  }

  if (identity.kind !== 'human') {
    return NextResponse.json(
      { error: 'Only human accounts can list desktop pets' },
      { status: 403 },
    )
  }

  const pets = await prisma.desktopPet.findMany({
    where: { accountId: identity.accountId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      label: true,
      agentAddress: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      agentMember: {
        select: {
          agentStatus: true,
          apiKeyHash: true,
        },
      },
    },
  })

  // Per-pet active asset-scope grant count. Used by PetCard to gate the
  // "Revoke sprite downloads" affordance and by the unlink path's pre-check
  // to surface a "revoke first" 409. One aggregate query covers all pets;
  // membership in `granteeAddress IN (...)` keeps the cost bounded.
  //
  // The `soul.currentOwnerMemberId` filter scopes counts to grants the
  // calling account can actually revoke from `/account/pets` — the revoke
  // modal (`/api/account/pets/[id]/grantable-souls`) and the unlink
  // blocker (`findActiveAssetGrantsForPet`) both apply the same predicate.
  // Without it, a grant issued by another account's Soul to this pet's
  // address would inflate the count and surface a "Revoke sprite
  // downloads" affordance that opens an empty modal (R-001).
  let assetGrantCounts: Map<string, number> = new Map()
  if (pets.length > 0) {
    const granteeAddresses = pets.map((pet) => pet.agentAddress)
    const now = new Date()
    const groups = await prisma.soulGrantRecord.groupBy({
      by: ['granteeAddress'],
      where: {
        granteeAddress: { in: granteeAddresses },
        status: 'active',
        scopes: { has: 'assets' },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
        soul: {
          currentOwnerMemberId: identity.memberId,
        },
      },
      _count: { _all: true },
    })
    assetGrantCounts = new Map(groups.map((row) => [row.granteeAddress, row._count._all]))
  }

  return NextResponse.json({
    pets: pets.map((pet) => ({
      id: pet.id,
      label: pet.label,
      agentAddress: pet.agentAddress,
      lastSeenAt: pet.lastSeenAt ? pet.lastSeenAt.toISOString() : null,
      agentStatus: pet.agentMember?.agentStatus ?? null,
      hasActiveApiKey: Boolean(pet.agentMember?.apiKeyHash),
      activeAssetGrantCount: assetGrantCounts.get(pet.agentAddress) ?? 0,
      createdAt: pet.createdAt.toISOString(),
      updatedAt: pet.updatedAt.toISOString(),
    })),
  })
}
