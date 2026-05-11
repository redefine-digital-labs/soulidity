import { prisma } from '@/lib/prisma'
import {
  SOUL_GRANT_SCOPE_BITS,
  type SoulGrantScope,
} from '@soulidity/sdk'
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
  /**
   * Single-bit scope corresponding to the kind being appended (e.g.
   * `KIND_SPRITE` → `SOUL_GRANT_SCOPE_ASSETS`). Used as the FLOOR each
   * agent's auto-grant mask must cover; if an agent already holds an
   * active grant we issue a superset mask `existingMask | kindScopeMask`
   * so they retain every previously-granted scope while gaining read
   * access to the new kind. `grant::issue` enforces single-bit per-bit
   * validity (`assert_valid_scope_mask`) over any subset of the four
   * scopes, so a merged mask is always accepted on chain.
   */
  scopeMask: number
  currentCapacity: number
  activeGrantCount: number
  now?: Date
}

export interface AutoGrantTarget extends AccountAgentTarget {
  /**
   * Mask the on-chain `grant::issue` call must carry for this agent.
   * For a new grantee this equals the kind's `scopeMask`. For an agent
   * who already holds an active grant on this Soul, this is
   * `existingScopeMask | kindScopeMask` so the supersede does not
   * narrow the agent's previously-granted scopes. Always a non-zero
   * subset of `ALL_SOUL_GRANT_SCOPE_MASK`.
   */
  desiredScopeMask: number
  /**
   * `true` when this agent does not currently hold an active grant on
   * the Soul (so issuing consumes a fresh slot). `false` when issuing
   * will supersede an existing slot (no capacity delta on chain).
   */
  isNewGrantee: boolean
}

export interface AutoGrantPlan {
  targets: AutoGrantTarget[]
  /** The capacity the on-chain `set_grant_capacity` call must raise the
   *  Soul to before issuing the new grants. Equal to
   *  `max(currentCapacity, activeGrantCount + newGranteeCount)` clamped
   *  to `MAX_GRANT_CAPACITY`. Existing grantees do not consume new
   *  slots because `grant::issue` removes their old slot before pushing
   *  the new one. */
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

function scopesToMask(scopes: ReadonlyArray<string>): number {
  let mask = 0
  for (const scope of scopes) {
    const bit = SOUL_GRANT_SCOPE_BITS.find(
      (b) => b.scope === (scope as SoulGrantScope),
    )
    if (bit) mask |= bit.mask
  }
  return mask
}

/**
 * Return a map of `grantee_address → existing_scope_mask` for every
 * agent that currently holds an active, non-expired `SoulGrantRecord`
 * on this Soul. The caller uses this to merge the kind's scope into the
 * agent's existing mask when issuing, so `grant::issue`'s replace
 * semantics never narrow an agent's previously-granted scopes.
 *
 * Mirror staleness contract:
 *  - stale forward (mirror missed a revoke / supersede / expiry) → we
 *    return the stale mask; the on-chain `cleanup_inactive_grant_for_grantee`
 *    runs before `issue`, so chain-side capacity counts may differ from
 *    DB. The PTB still succeeds because we conservatively size
 *    `requiredCapacity` against `activeGrantCount + newGranteeCount`,
 *    which already accounts for the chain-side slot churn.
 *  - stale backward (mirror missed a fresh grant) → we miss an existing
 *    mask; the issue would re-grant the single kind scope and narrow
 *    the chain-side scope. This is rare (write-after-write within the
 *    mirror gap) and self-heals on the next mirror sync; the owner can
 *    re-issue from the Grants tab if they notice immediately.
 */
export async function getActiveGrantScopeByGrantee(params: {
  soulOnChainId: string
  granteeAddresses: ReadonlyArray<string>
  now?: Date
}): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (params.granteeAddresses.length === 0) return out

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
    select: { granteeAddress: true, scopes: true },
  })
  for (const row of rows) {
    const mask = scopesToMask(row.scopes)
    if (mask === 0) continue
    // Defensive merge: a single grantee should have at most one active
    // grant on chain (`grant::issue` supersedes the old slot before
    // pushing a new one), but if the mirror has multiple active rows
    // for some reason, OR them together so the resulting mask is a
    // superset of every recorded scope.
    out.set(row.granteeAddress, (out.get(row.granteeAddress) ?? 0) | mask)
  }
  return out
}

/**
 * Compose the full auto-grant plan for a non-public content append:
 *  - List active agents in the account (those without a Sui binding are
 *    silently skipped; they cannot receive a grant anyway).
 *  - Look up each agent's existing active grant scope on this Soul.
 *  - For agents whose existing mask already covers the kind's scope →
 *    skip (the issue would be a no-op for the kind).
 *  - For everyone else, queue a target with `desiredScopeMask =
 *    existingMask | kindScopeMask` so the on-chain `grant::issue`
 *    supersede strictly EXPANDS the agent's scope and never narrows.
 *  - Capacity bump only counts NEW grantees because `grant::issue`
 *    removes an existing grantee's old slot before pushing the new one.
 *
 * If `targets` is empty the caller can skip the entire auto-grant
 * splice. If `requiredCapacity > currentCapacity` the caller should
 * splice `addSetGrantCapacityCalls` before the `addIssueGrantCalls`
 * loop. Each `addIssueGrantCalls` must use `target.desiredScopeMask`
 * (not the kind's single-bit `scopeMask`) so the issue is a superset.
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

  const existingMaskByGrantee = await getActiveGrantScopeByGrantee({
    soulOnChainId: params.soulOnChainId,
    granteeAddresses: agents.map((a) => a.address),
    now: params.now,
  })

  const candidates: AutoGrantTarget[] = []
  for (const agent of agents) {
    const existing = existingMaskByGrantee.get(agent.address) ?? 0
    if (existing !== 0 && (existing & params.scopeMask) === params.scopeMask) {
      // Already covered — issuing again would be a no-op for the kind
      // and waste a wallet signature.
      continue
    }
    const desiredScopeMask = existing | params.scopeMask
    candidates.push({
      memberId: agent.memberId,
      address: agent.address,
      displayName: agent.displayName,
      desiredScopeMask,
      isNewGrantee: existing === 0,
    })
  }
  if (candidates.length === 0) return empty

  const newGranteeCount = candidates.filter((t) => t.isNewGrantee).length
  const desiredCapacity = params.activeGrantCount + newGranteeCount
  const clampedCapacity = Math.min(desiredCapacity, MAX_GRANT_CAPACITY)
  const requiredCapacity = Math.max(params.currentCapacity, clampedCapacity)

  // Capacity-overflow fitting: trim NEW grantees first (they consume
  // slots) while always keeping existing-grantee supersede targets
  // (they don't consume new slots, so they fit regardless).
  let fittedTargets = candidates
  if (clampedCapacity < desiredCapacity) {
    const slotsAvailable = Math.max(0, MAX_GRANT_CAPACITY - params.activeGrantCount)
    let newSlotsUsed = 0
    fittedTargets = []
    for (const candidate of candidates) {
      if (candidate.isNewGrantee) {
        if (newSlotsUsed >= slotsAvailable) continue
        newSlotsUsed += 1
      }
      fittedTargets.push(candidate)
    }
  }
  if (fittedTargets.length === 0) return empty

  return {
    targets: fittedTargets,
    requiredCapacity,
    currentCapacity: params.currentCapacity,
    activeGrantCount: params.activeGrantCount,
  }
}
