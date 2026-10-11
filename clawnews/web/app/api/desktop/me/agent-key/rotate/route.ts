import { NextResponse } from 'next/server'

import {
  generateAgentApiKeyForRotation,
  requireDesktopIdentity,
} from '@/lib/desktop/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ROTATION_PENDING_TTL_MS = 10 * 60 * 1000 // 10 minutes
const MAX_ROTATION_ID_LENGTH = 64

/**
 * Rotate the desktop pet's agent API key.
 *
 * Protocol: write a `pendingApiKeyHash` keyed on `rotationId`, return the
 * deterministic `sk-*` to the caller, but do NOT touch `apiKeyHash` until
 * the desktop calls /commit. This guarantees the previously committed key
 * remains valid for any agent process still using it (incl. a Hermes /
 * OpenClaw worker on a different host) until the desktop's local enc file
 * has been written and committed.
 *
 * Idempotency:
 * - `apiKeyRotationId === rotationId` → return the committed apiKey, no DB write.
 * - `pendingApiKeyRotationId === rotationId` (not expired) → return the pending apiKey.
 * - Different active rotation pending and not expired → 409 with rotationId/expiresAt.
 * - Expired pending → cleared, new rotation proceeds.
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

  try {
    return await prisma.$transaction(async (tx) => {
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

      const now = new Date()

      // Idempotent return path: the rotation is already committed.
      if (member.apiKeyRotationId === rotationId) {
        const { apiKey } = generateAgentApiKeyForRotation(agentMemberId, rotationId)
        return NextResponse.json({ apiKey })
      }

      // Pending return path: same rotationId still in the pending slot, not expired.
      const pendingNotExpired =
        member.pendingApiKeyRotationExpiresAt !== null &&
        member.pendingApiKeyRotationExpiresAt > now

      if (
        member.pendingApiKeyRotationId === rotationId &&
        pendingNotExpired
      ) {
        const { apiKey, hash } = generateAgentApiKeyForRotation(agentMemberId, rotationId)
        // Defensive consistency check: the stored pending hash must match
        // the deterministic hash for the same (agentMemberId, rotationId).
        if (member.pendingApiKeyHash !== hash) {
          return NextResponse.json(
            { error: 'pending hash mismatch' },
            { status: 500 },
          )
        }
        return NextResponse.json({ apiKey })
      }

      // Stale pending cleanup: expired pending row blocks new rotation.
      let staleCleared = false
      if (
        member.pendingApiKeyRotationExpiresAt !== null &&
        member.pendingApiKeyRotationExpiresAt <= now
      ) {
        await tx.member.update({
          where: { id: agentMemberId },
          data: {
            pendingApiKeyHash: null,
            pendingApiKeyRotationId: null,
            pendingApiKeyRotationExpiresAt: null,
          },
        })
        staleCleared = true
      }

      // Conflict path: a different rotationId is in flight and still alive.
      if (
        !staleCleared &&
        member.pendingApiKeyRotationId !== null &&
        member.pendingApiKeyRotationId !== rotationId &&
        pendingNotExpired
      ) {
        return NextResponse.json(
          {
            error: 'rotation_in_progress',
            rotationId: member.pendingApiKeyRotationId,
            expiresAt: member.pendingApiKeyRotationExpiresAt!.toISOString(),
          },
          { status: 409 },
        )
      }

      // New rotation: derive deterministic apiKey + hash, write pending fields.
      const { apiKey, hash } = generateAgentApiKeyForRotation(agentMemberId, rotationId)
      const expiresAt = new Date(now.getTime() + ROTATION_PENDING_TTL_MS)

      await tx.member.update({
        where: { id: agentMemberId },
        data: {
          pendingApiKeyHash: hash,
          pendingApiKeyRotationId: rotationId,
          pendingApiKeyRotationExpiresAt: expiresAt,
        },
      })

      return NextResponse.json({ apiKey })
    })
  } catch (error) {
    // Race protection: parallel rotate calls with different rotationIds will
    // collide on `pendingApiKeyRotationId @unique`. Surface as 409 so the
    // caller retries with the in-flight rotationId.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json({ error: 'rotation_in_progress' }, { status: 409 })
    }
    throw error
  }
}
