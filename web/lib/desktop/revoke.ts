import type { Prisma } from '@db/prisma-client'
import {
  getActiveGrantSlotForGrantee,
  getRequiredSoulidityEnv,
  getSoulStateObject,
  SOUL_GRANT_SCOPE_ASSETS,
} from '@soulidity/sdk'

import { prisma } from '@/lib/prisma'

export interface ActiveAssetGrantSummary {
  grantOnChainId: string
  soulOnChainId: string
  expiresAt: string | null
}

/**
 * Reason the on-chain re-check could not exhaustively prove there are
 * no further active grants beyond the ones it returned.
 *
 *  - `owner-soul-overflow`: the caller currently owns more Souls than
 *    `MAX_ONCHAIN_RECHECK_SOULS`. The helper refuses to fan out further
 *    rather than turn one teardown call into thousands of RPC reads,
 *    and signals incomplete so the caller fails closed.
 *  - `rpc-error`: at least one per-Soul `getSoulStateObject` or
 *    `getActiveGrantSlotForGrantee` call failed transiently. The
 *    helper cannot prove that Soul has no active grant for this
 *    grantee, so it signals incomplete.
 */
export type ActiveAssetGrantsIncompleteReason = 'owner-soul-overflow' | 'rpc-error'

/**
 * Result of an on-chain (or hybrid mirror+chain) re-check for a desktop
 * pet's active asset-scope grants.
 *
 * `grants` lists every grant the helper could positively identify.
 *
 * `incomplete` is `true` whenever the helper cannot exhaustively rule
 * out additional grants — see {@link ActiveAssetGrantsIncompleteReason}.
 * Callers that gate teardown on this result MUST fail closed when
 * `incomplete` is `true`: a grant the helper failed to see may still
 * be live on chain.
 */
export interface ActiveAssetGrantsResult {
  grants: ActiveAssetGrantSummary[]
  incomplete: boolean
  incompleteReason?: ActiveAssetGrantsIncompleteReason
}

// Hard cap on how many caller-owned Souls the on-chain re-check will fan
// out across in a single teardown call. Real accounts hold far fewer than
// this; the cap exists so a pathological mirror state (or malicious
// inflation) can't turn one DELETE into thousands of RPC reads. When the
// caller exceeds the cap, the helper now reports `incomplete=true` with
// reason `owner-soul-overflow` instead of silently returning a
// best-effort subset.
const MAX_ONCHAIN_RECHECK_SOULS = 200

/**
 * Lookup every active, non-expired asset-scope grant whose grantee is the
 * desktop pet's agent address AND whose underlying Soul is currently
 * owned by the calling human (`ownerMemberId`). Used by both unlink paths
 * (cookie + bearer) before tearing down the pet:
 *
 *  - Cookie `DELETE /api/account/pets/[id]`: rejects with HTTP 409 when
 *    any active grants are returned, surfacing the list so the user can
 *    revoke them via the wallet-signed flow before unlinking. When the
 *    re-check is `incomplete`, the route fails closed with HTTP 503 so
 *    the user retries instead of silently orphaning a grant the helper
 *    couldn't see.
 *  - Bearer `POST /api/desktop/me/revoke`: when any active grants exist,
 *    or when the re-check is `incomplete`, clears desktop credentials but
 *    PRESERVES the `DesktopPet` row so `/account/pets` can still surface
 *    the pending revoke. The desktop app cannot sign for the human
 *    owner, so the row must remain visible until the human signs the
 *    revoke (or the re-check converges).
 *
 * Authoritative behaviour: the function loads the local `SoulGrantRecord`
 * mirror, validates every row against the authoritative chain slot
 * (`SoulState` + `getActiveGrantSlotForGrantee`), and self-heals stale
 * rows by marking them `invalidated`. When the mirror is empty (or every
 * row turned out to be stale), it re-checks the chain directly for every
 * Soul the caller currently owns (`SoulAsset.currentOwnerMemberId ==
 * ownerMemberId`).
 *
 * Why validate every mirror row: the pet authorize / unauthorize flow
 * signs `grant::issue_to_grantee` (or `grant::revoke`) first and only
 * mirrors the result via `/api/account/pets/[id]/grant-mirror`
 * afterward. If that mirror POST fails after the wallet TX lands — or if
 * a grant is issued/revoked from outside this UI — the `SoulGrantRecord`
 * mirror can be either:
 *
 *   (a) MISSING a live grant: zero rows, but the chain still authorises
 *       the pet `agentAddress`. The empty-mirror chain fallback covers
 *       this case (was already implemented).
 *   (b) STALE on a revoked grant: a row with `status='active'` survives
 *       even though `grant::revoke` already removed the slot on chain.
 *       Without per-row validation the next revoke attempt aborts with
 *       `EGrantNotFound` while the stale row keeps blocking unlink, so
 *       the user has no convergent path. Per-row chain validation
 *       restores convergence by self-healing those rows.
 *
 * Fail-closed semantics: an empty `grants` list with `incomplete=true`
 * is NOT the same as "no active grants on chain" — it means the helper
 * could not exhaustively prove there are none, either because the caller
 * owns / has mirrored more Souls than the per-call cap
 * (`owner-soul-overflow`) or because one of the per-Soul RPC reads
 * failed transiently (`rpc-error`). Callers MUST treat this as a
 * teardown blocker. RPC failures while validating a specific mirror row
 * keep that row in the result list (fail closed at the row level) so
 * the caller still treats it as a blocker until we can prove otherwise.
 *
 * The `ownerMemberId` filter is preserved across both paths: the unlink
 * blocker must match grants the signed-in account can actually revoke. A
 * grant issued by a different Soul owner to this pet's address is NOT
 * something the calling account can revoke from
 * `/account/pets/[id]/grantable-souls` (that route filters by
 * `currentOwnerMemberId: identity.memberId`), so counting it as a
 * blocker would leave the user with a stuck pet row and no convergent
 * UI path.
 */
export async function findActiveAssetGrantsForPet(params: {
  agentAddress: string
  ownerMemberId: string
  now?: Date
}): Promise<ActiveAssetGrantsResult> {
  const now = params.now ?? new Date()
  const rows = await prisma.soulGrantRecord.findMany({
    where: {
      granteeAddress: params.agentAddress,
      status: 'active',
      scopes: { has: 'assets' },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
      soul: {
        currentOwnerMemberId: params.ownerMemberId,
      },
    },
    select: {
      onChainId: true,
      soulOnChainId: true,
      expiresAt: true,
      soul: { select: { stateOnChainId: true } },
    },
  })

  if (rows.length === 0) {
    return findActiveAssetGrantsForPetOnChain({
      agentAddress: params.agentAddress,
      ownerMemberId: params.ownerMemberId,
      now,
    })
  }

  // Refuse to fan out if a single pet somehow accumulated more
  // mirrored active asset-scope grants than the per-call validation cap.
  // Returning the rows un-validated would let stale rows block teardown
  // forever; signalling incomplete forces the caller to fail closed and
  // retry / contact support.
  if (rows.length > MAX_ONCHAIN_RECHECK_SOULS) {
    return {
      grants: rows.map((row) => ({
        grantOnChainId: row.onChainId,
        soulOnChainId: row.soulOnChainId,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      })),
      incomplete: true,
      incompleteReason: 'owner-soul-overflow',
    }
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
  const surviving: ActiveAssetGrantSummary[] = []
  const invalidatedGrantIds: string[] = []
  let hadRpcFailure = false

  for (const row of rows) {
    let state
    try {
      state = await getSoulStateObject(row.soul.stateOnChainId, packageId, {
        includeActiveGrants: false,
      })
    } catch (error) {
      // We can't prove this Soul has no active grant for the grantee
      // when the state read failed. Keep the row as a blocker (fail
      // closed at the row level) and signal incomplete so the caller
      // also fails closed at the request level.
      hadRpcFailure = true
      console.warn('[desktop-revoke] mirror validation soul state read failed (incomplete)', {
        soulOnChainId: row.soulOnChainId,
        stateOnChainId: row.soul.stateOnChainId,
        error,
      })
      surviving.push({
        grantOnChainId: row.onChainId,
        soulOnChainId: row.soulOnChainId,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      })
      continue
    }

    if (state.activeGrantCount <= 0) {
      // SoulState carries no active grant slots at all (e.g. ownership
      // transferred and bumped ownership_epoch, invalidating every
      // slot). Mirror row is stale.
      invalidatedGrantIds.push(row.onChainId)
      continue
    }

    let slot
    try {
      slot = await getActiveGrantSlotForGrantee(state, params.agentAddress)
    } catch (error) {
      // Same row-level fail-closed contract as the state-read path.
      hadRpcFailure = true
      console.warn('[desktop-revoke] mirror validation grant slot read failed (incomplete)', {
        soulOnChainId: row.soulOnChainId,
        stateOnChainId: row.soul.stateOnChainId,
        error,
      })
      surviving.push({
        grantOnChainId: row.onChainId,
        soulOnChainId: row.soulOnChainId,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      })
      continue
    }

    // Stale-row criteria: chain says no slot for this grantee, OR the
    // slot points to a different grant id (the original was superseded
    // and the mirror missed the supersede event), OR the slot no
    // longer carries the asset scope, OR the slot has expired.
    if (
      !slot
      || slot.grantId !== row.onChainId
      || (slot.scopeMask & SOUL_GRANT_SCOPE_ASSETS) !== SOUL_GRANT_SCOPE_ASSETS
      || (slot.expiresAtMs != null && slot.expiresAtMs <= now.getTime())
    ) {
      invalidatedGrantIds.push(row.onChainId)
      continue
    }

    surviving.push({
      grantOnChainId: row.onChainId,
      soulOnChainId: row.soulOnChainId,
      expiresAt: slot.expiresAtMs == null
        ? null
        : new Date(slot.expiresAtMs).toISOString(),
    })
  }

  // Self-heal stale rows so future calls (and the next time the user
  // hits unlink / `/grantable-souls`) converge without operator
  // intervention. Best-effort: a transient DB hiccup here is logged but
  // does not block the read path — the next call will retry the heal.
  if (invalidatedGrantIds.length > 0) {
    try {
      await prisma.soulGrantRecord.updateMany({
        where: { onChainId: { in: invalidatedGrantIds } },
        data: { status: 'invalidated', endedAt: now },
      })
    } catch (error) {
      console.warn('[desktop-revoke] failed to self-heal stale mirror rows', {
        invalidatedGrantIds,
        error,
      })
    }
  }

  if (surviving.length > 0) {
    return {
      grants: surviving,
      incomplete: hadRpcFailure,
      ...(hadRpcFailure ? { incompleteReason: 'rpc-error' as const } : {}),
    }
  }

  if (hadRpcFailure) {
    // Every mirror row was either validated stale OR hit an RPC error.
    // We can't prove there are zero active grants on the chain; signal
    // incomplete so the caller fails closed.
    return { grants: [], incomplete: true, incompleteReason: 'rpc-error' }
  }

  // All mirror rows turned out to be stale. Run the empty-mirror full
  // scan so never-mirrored grants are still discovered (the original
  // failure mode this fallback exists for).
  return findActiveAssetGrantsForPetOnChain({
    agentAddress: params.agentAddress,
    ownerMemberId: params.ownerMemberId,
    now,
  })
}

/**
 * Authoritative on-chain re-check used when the `SoulGrantRecord` mirror
 * is empty. Iterates every Soul the caller currently owns (per the DB
 * mirror's owner column) and asks the chain whether the SoulState
 * carries an active grant slot for this pet's agent address.
 *
 * Each Soul costs at most one `getObject` (SoulState read) plus, when
 * the state has any active grants at all, one `getDynamicFieldObject`
 * keyed by `agentAddress`. Souls with no active grants
 * (`activeGrantCount == 0`) skip the second RPC. The fan-out is bounded
 * by `MAX_ONCHAIN_RECHECK_SOULS`.
 *
 * Fail-closed signalling:
 *   - The helper fetches up to `MAX_ONCHAIN_RECHECK_SOULS + 1` Souls.
 *     If the over-cap probe row comes back, it returns
 *     `incomplete=true` with reason `owner-soul-overflow` rather than
 *     silently scanning a non-deterministic subset.
 *   - When any per-Soul `getSoulStateObject` or
 *     `getActiveGrantSlotForGrantee` call throws, the error is logged
 *     and the helper sets `incomplete=true` with reason `rpc-error`.
 *     We can't prove that Soul has no live grant for this grantee, so
 *     we refuse to claim a clean re-check. The remaining Souls still
 *     get scanned so the caller surfaces every grant we *did* see.
 *
 * Note we explicitly request `includeActiveGrants: false` on the state
 * read — `getActiveGrantSlotForGrantee` looks up the dynamic field by
 * grantee address directly, so paying for the full active-grants
 * materialization (50-page paginated read) per Soul would be wasted
 * work in this path.
 *
 * Exported so the owner-facing revoke surface
 * (`/api/account/pets/[id]/grantable-souls`) can share the same
 * authoritative chain-side lookup the teardown blocker uses, instead of
 * silently returning an empty revoke list whenever the
 * `SoulGrantRecord` mirror is missing a grant the chain still
 * authorises. Callers that already have a result from the mirror
 * branch should NOT call this directly — use
 * `findActiveAssetGrantsForPet` so the cheap mirror branch runs first.
 */
export async function findActiveAssetGrantsForPetOnChain(params: {
  agentAddress: string
  ownerMemberId: string
  now: Date
}): Promise<ActiveAssetGrantsResult> {
  // Fetch one row past the cap so we can detect overflow without paying
  // a separate `count()` round-trip. If the overflow row comes back, we
  // refuse to scan further and signal incomplete — the caller fails
  // closed.
  const ownedSouls = await prisma.soulAsset.findMany({
    where: { currentOwnerMemberId: params.ownerMemberId },
    take: MAX_ONCHAIN_RECHECK_SOULS + 1,
    select: {
      onChainId: true,
      stateOnChainId: true,
    },
  })
  if (ownedSouls.length === 0) return { grants: [], incomplete: false }

  const overflowed = ownedSouls.length > MAX_ONCHAIN_RECHECK_SOULS
  const scannableSouls = overflowed
    ? ownedSouls.slice(0, MAX_ONCHAIN_RECHECK_SOULS)
    : ownedSouls

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
  const summaries: ActiveAssetGrantSummary[] = []
  let hadRpcFailure = false

  for (const soul of scannableSouls) {
    let state
    try {
      state = await getSoulStateObject(soul.stateOnChainId, packageId, {
        includeActiveGrants: false,
      })
    } catch (error) {
      // We cannot prove this Soul has no active grant for the grantee
      // when the state read failed. Mark incomplete and keep scanning
      // the rest so the caller still gets every grant we *did* see.
      hadRpcFailure = true
      console.warn('[desktop-revoke] on-chain re-check soul state read failed (incomplete)', {
        soulOnChainId: soul.onChainId,
        stateOnChainId: soul.stateOnChainId,
        error,
      })
      continue
    }
    if (state.activeGrantCount <= 0) continue

    let slot
    try {
      slot = await getActiveGrantSlotForGrantee(state, params.agentAddress)
    } catch (error) {
      // Same logic as the state-read failure: we know this Soul has at
      // least one active grant slot (activeGrantCount > 0), but we
      // can't tell whether one of them targets the pet's grantee. Mark
      // incomplete instead of silently dropping the Soul.
      hadRpcFailure = true
      console.warn('[desktop-revoke] on-chain re-check grant slot read failed (incomplete)', {
        soulOnChainId: soul.onChainId,
        stateOnChainId: soul.stateOnChainId,
        error,
      })
      continue
    }
    if (!slot) continue
    if ((slot.scopeMask & SOUL_GRANT_SCOPE_ASSETS) !== SOUL_GRANT_SCOPE_ASSETS) continue
    if (slot.expiresAtMs != null && slot.expiresAtMs <= params.now.getTime()) continue

    summaries.push({
      grantOnChainId: slot.grantId,
      soulOnChainId: soul.onChainId,
      expiresAt: slot.expiresAtMs == null
        ? null
        : new Date(slot.expiresAtMs).toISOString(),
    })
  }

  // Overflow takes precedence over rpc-error in the reason, since the
  // caller may want to surface different UX ("you own too many Souls,
  // contact support" vs. "transient RPC issue, please retry").
  if (overflowed) {
    return { grants: summaries, incomplete: true, incompleteReason: 'owner-soul-overflow' }
  }
  if (hadRpcFailure) {
    return { grants: summaries, incomplete: true, incompleteReason: 'rpc-error' }
  }
  return { grants: summaries, incomplete: false }
}

/**
 * Shared DB mutation for the FULL revoke / unlink path:
 *
 * 1. Delete the `DesktopPet` row (invalidates any `dtk_*`).
 * 2. Disable the bound agent `Member` and clear all API key hashes
 *    (active + pending), so any committed `sk-*` is also invalidated.
 *
 * Callers MUST verify there are no active asset-scope grants on
 * `pet.agentAddress` first (via `findActiveAssetGrantsForPet`). On-chain
 * grants survive a row delete; tearing the pet down while the chain still
 * authorises the address is a footgun the wallet-signed flow exists to
 * prevent.
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

/**
 * PARTIAL teardown for the desktop bearer reset path when active asset
 * grants still exist on-chain.
 *
 * Clears the desktop credentials so the local `dtk_*` and any committed
 * `sk-*` stop working immediately (matches the "I'm resetting the local
 * keypair, lock me out" intent), but keeps the `DesktopPet` row alive so:
 *
 *  - `/account/pets` continues to show the pet, including its
 *    `agentAddress` and `activeAssetGrantCount`. Without this, the human
 *    owner has no UI to discover and revoke the lingering on-chain grants.
 *  - The wallet-signed revoke flow can still target this pet by id.
 *
 * Once the human owner revokes the on-chain grants from the web side, the
 * cookie unlink path performs the FULL delete via `revokeDesktopPet`.
 */
export async function partialRevokeDesktopPetCredentials(
  tx: Prisma.TransactionClient,
  params: { desktopPetId: string; agentMemberId: string; accountId: string },
): Promise<void> {
  const { desktopPetId, agentMemberId, accountId } = params

  await tx.desktopPet.update({
    where: { id: desktopPetId, accountId },
    data: {
      desktopAccessTokenHash: null,
      desktopAccessTokenIssuedAt: null,
    },
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
