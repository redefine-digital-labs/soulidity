import { NextRequest, NextResponse } from 'next/server'

import { requireMutationIdentity } from '@/lib/auth/identity'
import { prisma } from '@/lib/prisma'
import { revokeDesktopPet } from '@/lib/desktop/revoke'

export const dynamic = 'force-dynamic'

const MAX_LABEL_LENGTH = 64

const petSelect = {
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
} as const

type PetSelected = {
  id: string
  label: string
  agentAddress: string
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
  agentMember: {
    agentStatus: string | null
    apiKeyHash: string | null
  } | null
}

function serializePet(pet: PetSelected) {
  return {
    id: pet.id,
    label: pet.label,
    agentAddress: pet.agentAddress,
    lastSeenAt: pet.lastSeenAt ? pet.lastSeenAt.toISOString() : null,
    agentStatus: pet.agentMember?.agentStatus ?? null,
    hasActiveApiKey: Boolean(pet.agentMember?.apiKeyHash),
    createdAt: pet.createdAt.toISOString(),
    updatedAt: pet.updatedAt.toISOString(),
  }
}

function isP2025(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2025'
  )
}

/**
 * Rename a desktop pet.
 *
 * Cookie-based human auth + CSRF (via `requireMutationIdentity`). The
 * `where: { id, accountId }` clause guarantees a caller can only rename
 * pets they own — Prisma raises P2025 (→ 404) for everything else, so
 * cross-account access is indistinguishable from "no such pet".
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireMutationIdentity(request)
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json(
      { error: 'Only human accounts can update desktop pets' },
      { status: 403 },
    )
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const rawLabel = bodyObj?.label

  if (typeof rawLabel !== 'string') {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }

  const label = rawLabel.trim()
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    return NextResponse.json(
      { error: `label must be 1-${MAX_LABEL_LENGTH} characters` },
      { status: 400 },
    )
  }

  try {
    const pet = await prisma.desktopPet.update({
      where: { id, accountId: identity.accountId },
      data: { label },
      select: petSelect,
    })

    return NextResponse.json({ pet: serializePet(pet) })
  } catch (err) {
    if (isP2025(err)) {
      return NextResponse.json({ error: 'Desktop pet not found' }, { status: 404 })
    }
    throw err
  }
}

/**
 * Unlink a desktop pet from the calling account.
 *
 * Cookie-based human auth + CSRF. The transaction:
 *
 * 1. Looks up the pet and verifies it belongs to the caller. Cross-account
 *    or non-existent ids both return 404.
 * 2. Deletes the `DesktopPet` row (invalidates any `dtk_*`).
 * 3. Disables the bound agent `Member` and clears all API key hashes
 *    (active + pending), invalidating any committed `sk-*`.
 *
 * `WalletBinding` is intentionally preserved so the same desktop pet
 * address can be re-linked later via a fresh device-pair flow.
 *
 * Shares the underlying mutation with `POST /api/desktop/me/revoke` via
 * `revokeDesktopPet` in `web/lib/desktop/revoke.ts`.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, identity } = await requireMutationIdentity(request)
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json(
      { error: 'Only human accounts can unlink desktop pets' },
      { status: 403 },
    )
  }

  const { id } = await params

  try {
    await prisma.$transaction(async (tx) => {
      const pet = await tx.desktopPet.findUnique({
        where: { id },
        select: { accountId: true, agentMemberId: true },
      })

      if (!pet || pet.accountId !== identity.accountId) {
        throw new PetNotFoundError()
      }

      await revokeDesktopPet(tx, {
        desktopPetId: id,
        agentMemberId: pet.agentMemberId,
        accountId: identity.accountId,
      })
    })
  } catch (err) {
    if (err instanceof PetNotFoundError || isP2025(err)) {
      return NextResponse.json({ error: 'Desktop pet not found' }, { status: 404 })
    }
    throw err
  }

  return NextResponse.json({ ok: true })
}

class PetNotFoundError extends Error {
  constructor() {
    super('Desktop pet not found')
    this.name = 'PetNotFoundError'
  }
}
