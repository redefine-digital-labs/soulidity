import { prisma } from '@/lib/prisma'
import { SOUL_GRANT_SCOPE_BITS } from '@soulidity/sdk'
import {
  getActiveAgentSuiAddressesForAccount,
  type AccountAgentTarget,
} from '@/lib/agents/account-agents'

/**
 * Defensive ceiling for the auto-grant capacity bump. Mirrors
 * `MAX_GRANT_CAPACITY` in `move/soulidity/sources/grant.move`. The chain
 * itself rejects values above this, so clamping is purely for friendlier
 * pre-flight errors.
 */
export const MAX_GRANT_CAPACITY = 10_000

export interface ComputeAutoGrantTargetsParams {
  accountId: string
  soulOnChainId: string
  scopeMask: number
  currentCapacity: number
  activeGrantCount: number
  now?: Date
}

export interface AutoGrantPlan {
  targets: AccountAgentTarget[]
  /** The capacity the on-chain `set_grant_capacity` call must raise the
   *  Soul to before issuing the new grants. Equal to
   *  `max(currentCapacity, activeGrantCount + targets.length)` clamped to
   *  `MAX_GRANT_CAPACITY`. */
  requiredCapacity: number
  currentCapacity: number
  activeGrantCount: number
}

/**
 * Validate that `scopeMask` is exactly one of the four single-bit scopes
 * (`seal | memory | skills | assets`). Auto-grant only issues with a
 * kind's `default_grant_scope_mask`, which is enforced single-bit by
 * `kind_registry::assert_valid_default_grant_scope`.
 */
function isSingleBitScopeMask(scopeMask: number): boolean {
  if (!Number.isInteger(scopeMask) || scopeMask <= 0) return false
  if ((scopeMask & (scopeMask - 1)) !== 0) return false
  return SOUL_GRANT_SCOPE_BITS.some((bit) => bit.mask === scopeMask)
}

/**
 * Return the subset of `granteeAddresses` that already hold ANY active,
 * non-expired `SoulGrantRecord` on this Soul — regardless of which
 * scopes the grant carries.
 *
 * Why "any grant" and not "scope-matched grant": `grant::issue` on chain
 * REPLACES an existing slot for the grantee with the new `scope_mask`
 * (`move/soulidity/sources/grant.move:134-198` — the old slot is removed
 * via `remove_active_grant_for_grantee`, then a new slot is pushed with
 * only the freshly-passed mask). If we re-issued with a single-bit mask
 * for an agent who already held a different-scope grant (e.g. a pet with
 * `[assets]` issued by `PetGrantDialog`), the supersede would silently
 * NARROW that agent's effective scope to just the new bit, breaking
 * their previously-granted reads. Skipping any already-granted address
 * is the only fix that does not change the public Move ABI; the owner
 * adjusts scope intentionally via the manual `/grant` flow.
 *
 * Mirror staleness is acceptable here:
 *  - stale forward (mirror missed a revocation) → we skip an agent who
 *    no longer has a grant; they are picked up on the next upload once
 *    the revoke is mirrored, or via manual `/grant`.
 *  - stale backward (mirror missed a fresh grant) → harmless, since
 *    excluding already-granted addresses is the exact intent.
 */
export async function getGranteesWithActiveGrants(params: {
  soulOnChainId: string
  granteeAddresses: ReadonlyArray<string>
  now?: Date
}): Promise<Set<string>> {
  if (params.granteeAddresses.length === 0) return new Set()

  const now = params.now ?? new Date()
  const rows = await prisma.soulGrantRecord.findMany({
    where: {
      soulOnChainId: params.soulOnChainId,
      granteeAddress: { in: [...params.granteeAddresses] },
      status: 'active',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    select: { granteeAddress: true },
  })
  return new Set(rows.map((r) => r.granteeAddress))
}

/**
 * Compose the full auto-grant plan for a non-public content append:
 *  - List active agents in the account (those without a Sui binding are
 *    silently skipped; they cannot receive a grant anyway).
 *  - Subtract any agent that already holds an active grant on the Soul
 *    (any scope) — see `getGranteesWithActiveGrants` for the rationale.
 *  - Compute the capacity the Soul must be bumped to before issuing
 *    the new grants (`activeGrantCount + new_targets.length`).
 *
 * If `targets` is empty the caller can skip the entire auto-grant
 * splice. If `requiredCapacity > currentCapacity` the caller should
 * splice `addSetGrantCapacityCalls` before the `addIssueGrantCalls`
 * loop.
 */
export async function computeAutoGrantTargets(
  params: ComputeAutoGrantTargetsParams,
): Promise<AutoGrantPlan> {
  const empty: AutoGrantPlan = {
    targets: [],
    requiredCapacity: params.currentCapacity,
    currentCapacity: params.currentCapacity,
    activeGrantCount: params.activeGrantCount,
  }
  if (!isSingleBitScopeMask(params.scopeMask)) return empty

  const agents = await getActiveAgentSuiAddressesForAccount(params.accountId)
  if (agents.length === 0) return empty

  const alreadyGranted = await getGranteesWithActiveGrants({
    soulOnChainId: params.soulOnChainId,
    granteeAddresses: agents.map((a) => a.address),
    now: params.now,
  })
  const targets = agents.filter((a) => !alreadyGranted.has(a.address))
  if (targets.length === 0) return empty

  const desiredCapacity = params.activeGrantCount + targets.length
  const clampedCapacity = Math.min(desiredCapacity, MAX_GRANT_CAPACITY)
  const requiredCapacity = Math.max(params.currentCapacity, clampedCapacity)
  const fittedTargets = clampedCapacity < desiredCapacity
    ? targets.slice(0, Math.max(0, MAX_GRANT_CAPACITY - params.activeGrantCount))
    : targets
  if (fittedTargets.length === 0) return empty

  return {
    targets: fittedTargets,
    requiredCapacity,
    currentCapacity: params.currentCapacity,
    activeGrantCount: params.activeGrantCount,
  }
}
