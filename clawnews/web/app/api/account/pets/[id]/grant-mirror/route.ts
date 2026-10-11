import { NextResponse } from 'next/server'

import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  endSoulGrantProjectionFromChain,
  syncGrantProjectionFromChain,
  syncSoulProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import { getStoredSoulidityTxSync, storeSoulidityTxSync } from '@/lib/soulidity/mirror/tx-sync'
import { assertTransactionSender, requireHumanWalletIdentity } from '@/lib/soulidity/server'
import { prisma } from '@/lib/prisma'
import {
  MAX_GRANT_BATCH_SIZE,
  SOUL_GRANT_SCOPE_ASSETS,
  extractAllSoulGrantIssuedEvents,
  extractAllSoulGrantRevokedEvents,
  extractAllSoulGrantSupersededEvents,
  getRequiredSoulidityEnv,
  getSuccessfulTransactionBlock,
  parseRequiredObjectId,
  parseRequiredTxDigest,
  readTransactionSender,
  waitForTransactionBestEffort,
} from '@soulidity/sdk'

export const dynamic = 'force-dynamic'

const PET_GRANT_RATE_LIMIT = {
  max: 20,
  windowMs: 5 * 60 * 1000,
} as const

type Action = 'issue' | 'revoke'

function parseAction(value: unknown): Action | null {
  if (value === 'issue' || value === 'revoke') return value
  return null
}

type ExpectedSoulIdsError =
  | { kind: 'malformed' }
  | { kind: 'empty' }
  | { kind: 'too-large' }
  | { kind: 'duplicate' }
  | { kind: 'invalid-id' }

function parseExpectedSoulIds(
  value: unknown,
): { ok: true; ids: string[] } | { ok: false; error: ExpectedSoulIdsError } {
  if (!Array.isArray(value)) return { ok: false, error: { kind: 'malformed' } }
  if (value.length === 0) return { ok: false, error: { kind: 'empty' } }
  // Mirror the PTB-side cap so a single signed-in human cannot force the
  // server into an unbounded `IN (...)` query before event coverage is
  // checked. Clients chunk by `MAX_GRANT_BATCH_SIZE`; anything larger is a
  // bug or abuse.
  if (value.length > MAX_GRANT_BATCH_SIZE) {
    return { ok: false, error: { kind: 'too-large' } }
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const normalized = parseRequiredObjectId(entry)
    if (!normalized) return { ok: false, error: { kind: 'invalid-id' } }
    if (seen.has(normalized)) return { ok: false, error: { kind: 'duplicate' } }
    seen.add(normalized)
    ids.push(normalized)
  }
  return { ok: true, ids }
}

/**
 * Post-TX mirror for the desktop pet authorize / unauthorize flow. Accepts a
 * single `txDigest` from the human owner's wallet sign-and-execute, parses
 * every relevant grant event server-side, and writes the
 * `SoulGrantRecord` / `SoulAsset` projection rows for each affected Soul.
 *
 * Key rules (mirrors the single-grant route at
 * `web/app/api/souls/[id]/grant/route.ts`):
 *  - browser cookie auth + CSRF (`requireHumanWalletIdentity({ mutation })`).
 *  - the pet must belong to the calling account; otherwise 404.
 *  - the on-chain transaction sender must equal one of the caller's bound
 *    Sui wallets; otherwise 403.
 *  - clients pass `expectedSoulIds`; every emitted event must reference one
 *    of those Soul ids and only Souls owned by the caller via the DB
 *    mirror. Grant ids are never trusted from the client — they come from
 *    the parsed events.
 *  - issue events must carry `granteeAddress === pet.agentAddress` and a
 *    scope mask that includes `SCOPE_ASSETS` (no-asset-scope grants are
 *    rejected so the route stays focused on desktop sprite unlock; future
 *    callers should add their own route or relax this).
 *  - idempotent via `(routeKey, txDigest, actorKey, resourceKey)` —
 *    actorKey is the human member id, resourceKey is the pet id.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: petId } = await params
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`pet-grant:${auth.identity.memberId}`, PET_GRANT_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many desktop pet grant requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const pet = await prisma.desktopPet.findUnique({
    where: { id: petId },
    select: {
      id: true,
      accountId: true,
      agentAddress: true,
      desktopAccessTokenHash: true,
      agentMember: { select: { agentStatus: true } },
    },
  })
  if (!pet || pet.accountId !== auth.identity.accountId) {
    return NextResponse.json({ error: 'Desktop pet not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = parseAction(body?.action)
  if (!action) {
    return NextResponse.json({ error: "action must be 'issue' or 'revoke'" }, { status: 400 })
  }

  // After a desktop-initiated reset/unlink while active grants remain,
  // `partialRevokeDesktopPetCredentials` clears the bearer token hash and
  // sets `agentStatus='disabled'` but keeps the row so the human owner can
  // still revoke the on-chain grants from `/account/pets`. In that state
  // the agent has no usable credential, so issuing fresh grants would
  // create more on-chain rows the user has to revoke before unlinking,
  // without enabling any actual desktop downloads. Reject `issue` once
  // the pet enters that lifecycle. `revoke` stays allowed so the
  // preserved row can still be used to clean up.
  const petCanReceiveGrants =
    pet.desktopAccessTokenHash !== null && pet.agentMember?.agentStatus === 'active'
  if (action === 'issue' && !petCanReceiveGrants) {
    return NextResponse.json(
      {
        error:
          'This desktop pet has been disabled — revoke any remaining sprite grants and re-link the desktop before authorizing new downloads.',
      },
      { status: 409 },
    )
  }
  const txDigest = parseRequiredTxDigest(body?.txDigest)
  if (!txDigest) {
    return NextResponse.json({ error: 'txDigest must be a valid Sui transaction digest' }, { status: 400 })
  }
  const expectedParsed = parseExpectedSoulIds(body?.expectedSoulIds)
  if (!expectedParsed.ok) {
    switch (expectedParsed.error.kind) {
      case 'too-large':
        return NextResponse.json(
          { error: `expectedSoulIds must contain at most ${MAX_GRANT_BATCH_SIZE} entries` },
          { status: 400 },
        )
      case 'duplicate':
        return NextResponse.json(
          { error: 'expectedSoulIds must not contain duplicate Soul ids' },
          { status: 400 },
        )
      case 'invalid-id':
        return NextResponse.json(
          { error: 'expectedSoulIds entries must be valid Sui object ids' },
          { status: 400 },
        )
      case 'empty':
      case 'malformed':
      default:
        return NextResponse.json(
          { error: 'expectedSoulIds must be a non-empty array of Sui object ids' },
          { status: 400 },
        )
    }
  }
  const expectedSoulIds = expectedParsed.ids

  const routeKey = action === 'issue' ? 'pet-grant:issue' : 'pet-grant:revoke'
  const stored = await getStoredSoulidityTxSync({
    routeKey,
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey: petId,
  })
  if (stored) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

  try {
    await waitForTransactionBestEffort(txDigest)
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderError = assertTransactionSender(readTransactionSender(transaction), auth.walletAddresses)
    if (senderError) {
      return senderError
    }

    const expectedSet = new Set(expectedSoulIds)

    // Pre-load every owned Soul from the mirror up front. We need full
    // projection inputs (tags, previewImages, listing fields) for
    // `syncSoulProjectionFromChain`, and we want to verify the caller owns
    // every Soul referenced in the parsed events before doing any writes.
    const ownedSouls = await prisma.soulAsset.findMany({
      where: {
        onChainId: { in: expectedSoulIds },
        currentOwnerMemberId: auth.identity.memberId,
      },
      select: {
        onChainId: true,
        stateOnChainId: true,
        tags: true,
        previewImages: true,
        readme: true,
        creatorMemberId: true,
        currentOwnerMemberId: true,
        listingObjectOnChainId: true,
        listedPriceAtomic: true,
        listingStatus: true,
      },
    })
    const ownedById = new Map(ownedSouls.map((soul) => [soul.onChainId, soul]))
    if (ownedById.size !== expectedSoulIds.length) {
      return NextResponse.json(
        { error: 'expectedSoulIds includes one or more Souls not owned by the caller' },
        { status: 422 },
      )
    }

    if (action === 'issue') {
      const issuedEvents = extractAllSoulGrantIssuedEvents(transaction, packageId)
      if (issuedEvents.length === 0) {
        return NextResponse.json({ error: 'Transaction emitted no SoulGrantIssued events' }, { status: 422 })
      }

      // Every issued event must (a) target this pet's agent address, (b)
      // reference a Soul we expect, (c) include the asset scope so a UI
      // mistake never silently grants memory/skills.
      const issuedSoulIds = new Set<string>()
      for (const event of issuedEvents) {
        if (event.granteeAddress !== pet.agentAddress) {
          return NextResponse.json(
            { error: 'Transaction granted access to a different agent address' },
            { status: 422 },
          )
        }
        if (!expectedSet.has(event.soulId)) {
          return NextResponse.json(
            { error: 'Transaction issued a grant for a Soul not in expectedSoulIds' },
            { status: 422 },
          )
        }
        if ((event.scopeMask & SOUL_GRANT_SCOPE_ASSETS) !== SOUL_GRANT_SCOPE_ASSETS) {
          return NextResponse.json(
            { error: 'Pet grants must include the asset scope (SCOPE_ASSETS)' },
            { status: 422 },
          )
        }
        if (issuedSoulIds.has(event.soulId)) {
          // Two issue events for the same Soul in one TX would have us
          // mirror twice and is not how the PetGrantDialog batch builder
          // is shaped — reject so callers fix the PTB.
          return NextResponse.json(
            { error: 'Transaction issued duplicate grants for the same Soul' },
            { status: 422 },
          )
        }
        issuedSoulIds.add(event.soulId)
      }
      // Every expected Soul must have its own emitted issue event.
      // Without this, a partial TX (one grant out of two requested) would
      // be cached as a 200 success response and prevent a retry from
      // discovering the missing Soul.
      if (issuedSoulIds.size !== expectedSet.size) {
        return NextResponse.json(
          { error: 'Transaction did not issue grants for every Soul in expectedSoulIds' },
          { status: 422 },
        )
      }

      // Some PTBs may chain N issues without superseding old grants, but
      // when a new grant replaces an existing one the Move call also emits
      // `SoulGrantSuperseded`. Index those by oldGrantId so we can mark
      // each in turn.
      const supersededEvents = extractAllSoulGrantSupersededEvents(transaction, packageId)

      const issuedRecords: Array<{ soulOnChainId: string; grantOnChainId: string; supersededGrantOnChainId: string | null }> = []
      for (const event of issuedEvents) {
        const soul = ownedById.get(event.soulId)
        if (!soul) {
          // Re-check; ownedById covered every expectedSoulIds entry, so
          // this branch only hits if the chain returned a soul we never
          // expected — already caught above, but kept for type safety.
          return NextResponse.json(
            { error: 'Transaction referenced an unknown Soul' },
            { status: 422 },
          )
        }

        await syncSoulProjectionFromChain({
          packageId,
          soulObjectId: soul.onChainId,
          stateObjectId: soul.stateOnChainId,
          tags: soul.tags,
          previewImages: soul.previewImages,
          readme: soul.readme,
          creatorMemberId: soul.creatorMemberId,
          currentOwnerMemberId: soul.currentOwnerMemberId,
          listingObjectOnChainId: soul.listingObjectOnChainId,
          listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
          listingStatus: soul.listingStatus as 'held' | 'listed' | 'floor-violation',
        })

        const supersededForSoul = supersededEvents.find(
          (entry) => entry.soulId === event.soulId
            && entry.granteeAddress === pet.agentAddress
            && entry.newGrantId === event.grantId,
        )
        if (supersededForSoul?.oldGrantId) {
          await endSoulGrantProjectionFromChain({
            grantOnChainId: supersededForSoul.oldGrantId,
            status: 'superseded',
            replacedByGrantOnChainId: event.grantId,
          })
        }

        const mirroredGrant = await syncGrantProjectionFromChain({
          packageId,
          grantObjectId: event.grantId,
          soulOnChainId: soul.onChainId,
          issuedByMemberId: auth.identity.memberId,
        })

        issuedRecords.push({
          soulOnChainId: soul.onChainId,
          grantOnChainId: mirroredGrant.onChainId,
          supersededGrantOnChainId: supersededForSoul?.oldGrantId ?? null,
        })
      }

      const responseBody = {
        action: 'issue' as const,
        txDigest,
        petId: pet.id,
        granteeAddress: pet.agentAddress,
        grants: issuedRecords,
      }
      await storeSoulidityTxSync({
        routeKey,
        txDigest,
        actorKey: auth.identity.memberId,
        resourceKey: petId,
        statusCode: 200,
        responseBody,
      })
      return NextResponse.json(responseBody)
    }

    // action === 'revoke'
    const revokedEvents = extractAllSoulGrantRevokedEvents(transaction, packageId)
    if (revokedEvents.length === 0) {
      return NextResponse.json({ error: 'Transaction emitted no SoulGrantRevoked events' }, { status: 422 })
    }
    const revokedSoulIds = new Set<string>()
    for (const event of revokedEvents) {
      if (event.granteeAddress !== pet.agentAddress) {
        return NextResponse.json(
          { error: 'Transaction revoked a grant on a different agent address' },
          { status: 422 },
        )
      }
      if (!expectedSet.has(event.soulId)) {
        return NextResponse.json(
          { error: 'Transaction revoked a grant for a Soul not in expectedSoulIds' },
          { status: 422 },
        )
      }
      if (revokedSoulIds.has(event.soulId)) {
        return NextResponse.json(
          { error: 'Transaction revoked duplicate grants for the same Soul' },
          { status: 422 },
        )
      }
      revokedSoulIds.add(event.soulId)
    }
    // Every expected Soul must have its own emitted revoke event so a
    // partial TX is not cached as a 200 success.
    if (revokedSoulIds.size !== expectedSet.size) {
      return NextResponse.json(
        { error: 'Transaction did not revoke grants for every Soul in expectedSoulIds' },
        { status: 422 },
      )
    }

    const revokedRecords: Array<{ soulOnChainId: string; grantOnChainId: string }> = []
    for (const event of revokedEvents) {
      const soul = ownedById.get(event.soulId)!
      await syncSoulProjectionFromChain({
        packageId,
        soulObjectId: soul.onChainId,
        stateObjectId: soul.stateOnChainId,
        tags: soul.tags,
        previewImages: soul.previewImages,
        readme: soul.readme,
        creatorMemberId: soul.creatorMemberId,
        currentOwnerMemberId: soul.currentOwnerMemberId,
        listingObjectOnChainId: soul.listingObjectOnChainId,
        listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
        listingStatus: soul.listingStatus as 'held' | 'listed' | 'floor-violation',
      })
      await endSoulGrantProjectionFromChain({
        grantOnChainId: event.grantId,
        status: 'revoked',
      })
      revokedRecords.push({
        soulOnChainId: soul.onChainId,
        grantOnChainId: event.grantId,
      })
    }

    const responseBody = {
      action: 'revoke' as const,
      txDigest,
      petId: pet.id,
      granteeAddress: pet.agentAddress,
      grants: revokedRecords,
    }
    await storeSoulidityTxSync({
      routeKey,
      txDigest,
      actorKey: auth.identity.memberId,
      resourceKey: petId,
      statusCode: 200,
      responseBody,
    })
    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[pet-grant-mirror] Failed to mirror desktop pet grant transaction', {
      memberId: auth.identity.memberId,
      petId,
      txDigest,
      action,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror desktop pet grant transaction' }, { status: 500 })
  }
}
