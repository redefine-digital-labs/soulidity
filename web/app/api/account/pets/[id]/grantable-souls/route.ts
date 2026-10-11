import { NextResponse } from 'next/server'

import { requireIdentity } from '@/lib/auth/identity'
import { findActiveAssetGrantsForPet } from '@/lib/desktop/revoke'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type GrantableSoulRow = {
  onChainId: string
  stateOnChainId: string
  name: string
  imageUrl: string
  previewImages: string[]
  activeSpriteName: string | null
  activeSpriteVersionIndex: number | null
  activeSpriteDownloadPolicy: string | null
}

interface ActiveAssetGrantPayload {
  soulOnChainId: string
  stateOnChainId: string
  name: string
  imageUrl: string
  previewImage: string | null
  grantOnChainId: string
  expiresAt: string | null
}

// Stable typed empty array used when the pet is in the partial-revoke
// state — keeps the Promise.all branches' result types compatible
// without forcing a cast at the call site.
const EMPTY_GRANTABLE_SOULS: GrantableSoulRow[] = []

/**
 * Owner-facing list of currently owned Souls with a protected (owner_only /
 * allowlist) active sprite that the desktop pet does NOT yet have an active
 * asset-scope grant for.
 *
 * Driven by `/account/pets` PetCard "Authorize sprite downloads" modal:
 * the human owner sees all Souls that *could* be authorized for their
 * linked desktop pet, and decides which to include in a single batch
 * `grant::issue_to_grantee` PTB.
 *
 * Active-grant filter rules (must match `lib/soulidity/access.ts`):
 *  - SoulGrantRecord.status === 'active'
 *  - granteeAddress matches the pet's agentAddress (case-sensitive match
 *    is fine — both sides come from the on-chain mirror that already
 *    normalises addresses).
 *  - scopes contains 'assets' (the only scope desktop sprite unlock needs).
 *  - expiresAt IS NULL or > now (a stale-but-not-yet-ended row is excluded).
 *
 * Authoritative active-grant lookup: the route delegates to
 * `findActiveAssetGrantsForPet`, which validates every mirrored row
 * against the chain (self-healing stale `status='active'` rows) and
 * falls through to a chain-only scan for never-mirrored grants. This
 * keeps the modal's revoke surface in sync with the unlink blocker
 * (`/api/account/pets/[id]`) and the bearer revoke
 * (`/api/desktop/me/revoke`). Without per-row validation, a stale
 * mirror row would surface a grant whose on-chain slot is already
 * gone, and signing revoke from PetCard would abort with
 * `EGrantNotFound` while unlink stayed blocked.
 *
 * Auth: cookie-based human session only. Cross-account pet access returns
 * 404 (indistinguishable from "no such pet" by design).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json(
      { error: 'Only human accounts can manage desktop pet grants' },
      { status: 403 },
    )
  }

  const pet = await prisma.desktopPet.findUnique({
    where: { id },
    select: {
      id: true,
      accountId: true,
      agentAddress: true,
      desktopAccessTokenHash: true,
      agentMember: { select: { agentStatus: true } },
    },
  })

  if (!pet || pet.accountId !== identity.accountId) {
    return NextResponse.json({ error: 'Desktop pet not found' }, { status: 404 })
  }

  // Pets in the partial-revoke state (bearer hash cleared, agent member
  // disabled — see `partialRevokeDesktopPetCredentials`) keep the row
  // alive only so the human owner can revoke any lingering on-chain
  // grants. New grants would target an agent that no longer has a
  // working bearer / API key, so we hide grantable Souls in that state
  // (the issue mirror route mirrors this rejection). The active-grant
  // list is still returned so the revoke flow continues to work.
  const petCanReceiveGrants =
    pet.desktopAccessTokenHash !== null && pet.agentMember?.agentStatus === 'active'

  const now = new Date()

  // Authoritative active-grant lookup: the helper validates every
  // mirrored row against the chain, self-heals stale rows
  // (e.g. revokes whose mirror POST was lost), and falls through to a
  // chain-only scan for never-mirrored grants. Using the helper here
  // keeps the modal's revoke surface and the unlink blocker
  // (`/api/account/pets/[id]`) reading the same authoritative state —
  // without it, a stale `status='active'` mirror row would surface a
  // grant whose on-chain slot is already gone, and signing revoke from
  // PetCard would abort with `EGrantNotFound`.
  const activeGrantsResult = await findActiveAssetGrantsForPet({
    agentAddress: pet.agentAddress,
    ownerMemberId: identity.memberId,
    now,
  })
  const incompleteRecheck:
    | { reason: 'owner-soul-overflow' | 'rpc-error' }
    | null
    = activeGrantsResult.incomplete && activeGrantsResult.incompleteReason
      ? { reason: activeGrantsResult.incompleteReason }
      : null
  const validatedActiveSoulIds = activeGrantsResult.grants.map((g) => g.soulOnChainId)

  // (1) Grantable list: Souls currently owned by the caller with a
  // protected active sprite, EXCLUDING any Soul whose mirror+chain
  // re-check just confirmed an active asset-scope grant for this pet.
  // (2) Active-grant Soul metadata lookup: enrichment for the
  // already-validated grants list. Re-scoped by `currentOwnerMemberId`
  // so a Soul transferred between validation and enrichment is dropped
  // rather than surfaced under the wrong owner.
  const [grantableSouls, activeGrantSoulRows] = await Promise.all([
    petCanReceiveGrants
      ? prisma.soulAsset.findMany({
          where: {
            currentOwnerMemberId: identity.memberId,
            activeSpriteDownloadPolicy: { in: ['owner_only', 'allowlist'] },
            ...(validatedActiveSoulIds.length > 0
              ? { onChainId: { notIn: validatedActiveSoulIds } }
              : {}),
          },
          select: {
            onChainId: true,
            stateOnChainId: true,
            name: true,
            imageUrl: true,
            previewImages: true,
            activeSpriteName: true,
            activeSpriteVersionIndex: true,
            activeSpriteDownloadPolicy: true,
          },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve(EMPTY_GRANTABLE_SOULS),
    validatedActiveSoulIds.length > 0
      ? prisma.soulAsset.findMany({
          where: {
            onChainId: { in: validatedActiveSoulIds },
            currentOwnerMemberId: identity.memberId,
          },
          select: {
            onChainId: true,
            stateOnChainId: true,
            name: true,
            imageUrl: true,
            previewImages: true,
          },
        })
      : Promise.resolve([] as Array<{
          onChainId: string
          stateOnChainId: string
          name: string
          imageUrl: string
          previewImages: string[]
        }>),
  ])

  const souls = grantableSouls.map((soul) => ({
    soulOnChainId: soul.onChainId,
    stateOnChainId: soul.stateOnChainId,
    name: soul.name,
    imageUrl: soul.imageUrl,
    previewImage: soul.previewImages[0] ?? null,
    activeSpriteName: soul.activeSpriteName,
    activeSpriteVersionIndex: soul.activeSpriteVersionIndex,
    activeSpriteDownloadPolicy: soul.activeSpriteDownloadPolicy,
  }))

  const soulMetaById = new Map(activeGrantSoulRows.map((row) => [row.onChainId, row]))
  const activeAssetGrants: ActiveAssetGrantPayload[] = activeGrantsResult.grants.flatMap((grant) => {
    // The enrichment query filters by `currentOwnerMemberId === identity.memberId`,
    // so a Soul transferred between validation and enrichment is dropped here
    // rather than surfaced under the wrong owner.
    const soul = soulMetaById.get(grant.soulOnChainId)
    if (!soul) return []
    return [{
      soulOnChainId: soul.onChainId,
      stateOnChainId: soul.stateOnChainId,
      name: soul.name,
      imageUrl: soul.imageUrl,
      previewImage: soul.previewImages[0] ?? null,
      grantOnChainId: grant.grantOnChainId,
      expiresAt: grant.expiresAt,
    }]
  })

  return NextResponse.json({
    pet: {
      id: pet.id,
      agentAddress: pet.agentAddress,
    },
    souls,
    activeAssetGrants,
    ...(incompleteRecheck ? { incompleteRecheck } : {}),
  })
}
