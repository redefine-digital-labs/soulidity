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

  return NextResponse.json({
    pets: pets.map((pet) => ({
      id: pet.id,
      label: pet.label,
      agentAddress: pet.agentAddress,
      lastSeenAt: pet.lastSeenAt ? pet.lastSeenAt.toISOString() : null,
      agentStatus: pet.agentMember?.agentStatus ?? null,
      hasActiveApiKey: Boolean(pet.agentMember?.apiKeyHash),
      createdAt: pet.createdAt.toISOString(),
      updatedAt: pet.updatedAt.toISOString(),
    })),
  })
}
