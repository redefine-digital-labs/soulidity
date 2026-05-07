import { NextResponse } from 'next/server'

import { requireDesktopIdentity } from '@/lib/desktop/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_ROTATION_ID_LENGTH = 64

/**
 * Commit a previously-issued pending rotation.
 *
 * Promotes `pendingApiKeyHash → apiKeyHash` atomically once the desktop's
 * local enc file has been written. If the pending row has expired or the
 * rotationId doesn't match, returns 409 `stale-rotation` and the OLD active
 * key remains valid — the desktop will retry rotate with a fresh
 * rotationId.
 */
export async function POST(request: Request) {
  const auth = await requireDesktopIdentity(request, { mutation: true })
  if (auth.error) {
    return auth.error
  }

  if (!auth.desktopPet) {
    return NextResponse.json({ error: 'Desktop pet identity required' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const rawRotationId = bodyObj?.rotationId
  if (
    typeof rawRotationId !== 'string' ||
    rawRotationId.length === 0 ||
    rawRotationId.length > MAX_ROTATION_ID_LENGTH
  ) {
    return NextResponse.json(
      { error: 'rotationId must be a non-empty string up to 64 chars' },
      { status: 400 },
    )
  }

  const rotationId = rawRotationId
  const { agentMemberId } = auth.desktopPet

  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({
      where: { id: agentMemberId },
      select: {
        id: true,
        apiKeyHash: true,
        apiKeyRotationId: true,
        pendingApiKeyHash: true,
        pendingApiKeyRotationId: true,
        pendingApiKeyRotationExpiresAt: true,
      },
    })

    if (!member) {
      return NextResponse.json({ error: 'Agent member not found' }, { status: 404 })
    }

    // Idempotent: this rotation is already committed.
    if (member.apiKeyRotationId === rotationId) {
      return NextResponse.json({ ok: true })
    }

    const now = new Date()
    const pendingMatches =
      member.pendingApiKeyRotationId === rotationId &&
      member.pendingApiKeyHash !== null &&
      member.pendingApiKeyRotationExpiresAt !== null &&
      member.pendingApiKeyRotationExpiresAt > now

    if (pendingMatches) {
      await tx.member.update({
        where: { id: agentMemberId },
        data: {
          apiKey: null,
          apiKeyHash: member.pendingApiKeyHash,
          apiKeyRotationId: rotationId,
          pendingApiKeyHash: null,
          pendingApiKeyRotationId: null,
          pendingApiKeyRotationExpiresAt: null,
        },
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'stale-rotation' }, { status: 409 })
  })
}
