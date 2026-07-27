'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_GRANT_CAPACITY } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useGrant } from '@/lib/hooks/use-grant'

interface AgentGrantTarget {
  memberId: string
  address: string
  displayName: string | null
  /**
   * Mask the on-chain `grant::issue` must carry for this agent. Equals
   * `existing | kindScopeMask` so the supersede expands the agent's
   * scope instead of narrowing it (see `auto-grant.ts`). For new
   * grantees this equals `kindScopeMask`; for existing grantees with a
   * different prior scope (e.g. `{seal, skills}` + sprite upload), this
   * is the merged superset (`{seal, skills, assets}`). Must be honored
   * by `issueGrant` — using the single-bit `kindScopeMask` here would
   * silently narrow the agent's scope on chain.
   */
  desiredScopeMask: number
  /** `true` when issuing consumes a new grant slot. Used here to decide
   *  whether the PTB must splice `grant::set_grant_capacity` BEFORE
   *  `grant::issue_to_grantee` so the chain accepts the new slot. */
  isNewGrantee: boolean
}

interface AutoGrantTargetsResponse {
  targets?: AgentGrantTarget[]
  currentCapacity?: number
  activeGrantCount?: number
}

interface GrantableSoulRef {
  onChainId: string
  stateOnChainId: string
  activeGrants?: Array<{ granteeAddress: string }>
}

export interface AgentGrantRecommendationsProps {
  soul: GrantableSoulRef
  /** Single-bit scope (`SOUL_GRANT_SCOPE_ASSETS | SKILLS | MEMORY | SEAL`) the
   *  recommendation should plan for. Must match the kind being uploaded so
   *  /auto-grant-targets returns the right agent set. */
  kindScopeMask: number
  /** Human-readable label that appears in "N agent(s) need <label> access". */
  kindLabel: string
  role: 'owner' | 'grantee' | 'visitor'
  /** Pass through `useSoulContentActions`'s `pendingAction` so the panel
   *  re-checks the moment an `append` finishes — covers the case where
   *  auto-grant-on-append silently no-ops (e.g. pre-deploy prod, network
   *  hiccup, agent paired after the upload PTB was signed). */
  pendingAction: string | null
  onAuthorized?: () => void
}

function truncateAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

/**
 * Owner-only nudge that surfaces account agents who still lack a
 * scope-matched grant for this Soul. Hidden in the silent-success path
 * — when auto-grant-on-append covers the agent on the upload PTB, the
 * server's `/auto-grant-targets` returns `targets: []` and this panel
 * renders nothing. Shown when:
 *   - the owner uploaded against a deployed build that did not yet have
 *     the auto-grant route (deploy-window race);
 *   - the agent was paired after the last upload;
 *   - the auto-grant pre-flight fetch failed silently (offline / 5xx).
 *
 * Per-row "Authorize" reuses `useGrant.issueGrant`, which signs a single
 * `grant::issue_to_grantee` PTB and mirrors via the existing
 * `/api/souls/[id]/grant` route — one wallet signature per agent. We
 * deliberately do not batch into one PTB here because the existing
 * mirror route extracts a single `SoulGrantIssued` event; batching
 * would need a new mirror endpoint and is not worth the surface area
 * for the typical 1-2 pet case.
 */
export function AgentGrantRecommendations({
  soul,
  kindScopeMask,
  kindLabel,
  role,
  pendingAction,
  onAuthorized,
}: AgentGrantRecommendationsProps) {
  const [targets, setTargets] = useState<AgentGrantTarget[]>([])
  // Capacity context for per-target `setCapacityTo` derivation at
  // Authorize click time. `grant::issue_to_grantee` aborts with
  // `EGrantCapacityExceeded` when a new grantee would push
  // `active_grant_count` past `grant_capacity`, so the PTB must splice
  // `grant::set_grant_capacity` for any `isNewGrantee` target while
  // `activeGrantCount >= currentCapacity`. Refreshed on every fetch so
  // sequential Authorizes see post-issue capacity counts.
  const [currentCapacity, setCurrentCapacity] = useState<number>(0)
  const [activeGrantCount, setActiveGrantCount] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [grantingAddress, setGrantingAddress] = useState<string | null>(null)
  const { getAuthHeaders } = useAuth()
  const grant = useGrant(soul)

  const refresh = useCallback(async () => {
    if (role !== 'owner') {
      setTargets([])
      return
    }
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `/api/souls/${encodeURIComponent(soul.onChainId)}/auto-grant-targets?scopeMask=${kindScopeMask}`,
        { cache: 'no-store', headers },
      )
      if (res.ok) {
        const body = await res.json() as AutoGrantTargetsResponse
        setTargets(body.targets ?? [])
        setCurrentCapacity(typeof body.currentCapacity === 'number' ? body.currentCapacity : 0)
        setActiveGrantCount(typeof body.activeGrantCount === 'number' ? body.activeGrantCount : 0)
        return
      }
      // 404 = deployed prod is still on the pre-auto-grant build. Silently
      // hide so the page doesn't get a yellow banner on every Soul detail
      // view until Vercel finishes the deploy. Other failures get a
      // visible message so they can be diagnosed.
      if (res.status !== 404) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Could not check agent grants (HTTP ${res.status})`)
      }
      setTargets([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check agent grants')
      setTargets([])
    }
  }, [getAuthHeaders, kindScopeMask, role, soul.onChainId])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) void refresh()
    })
    return () => { active = false }
  }, [refresh])

  // Re-check the moment an append finishes. `pendingAction` is the
  // hook's transient state ('append' | 'open' | 'delete' | … | null);
  // we only want the append → null edge.
  const wasAppendingRef = useRef(false)
  useEffect(() => {
    const isAppending = pendingAction === 'append'
    if (wasAppendingRef.current && !isAppending) {
      void refresh()
    }
    wasAppendingRef.current = isAppending
  }, [pendingAction, refresh])

  if (role !== 'owner') return null
  if (targets.length === 0 && !error) return null

  async function handleAuthorize(target: AgentGrantTarget) {
    setGrantingAddress(target.address)
    setError(null)
    try {
      // Per-target capacity bump. `grant::issue_to_grantee` aborts with
      // `EGrantCapacityExceeded` when a new grantee would push
      // `active_grant_count` past `grant_capacity`; existing-grantee
      // supersedes reuse the slot and never need a bump. Mirrors the
      // GrantsPanel preflight decision in `web/app/souls/[id]/page.tsx`
      // (F-452) so the recommendation panel cannot sign a guaranteed-
      // abort PTB at full capacity.
      const projectedActive = activeGrantCount + (target.isNewGrantee ? 1 : 0)
      const setCapacityTo = projectedActive > currentCapacity ? projectedActive : null
      if (setCapacityTo != null && setCapacityTo > MAX_GRANT_CAPACITY) {
        throw new Error(
          `This Soul is at the on-chain grant capacity limit (${MAX_GRANT_CAPACITY}). Revoke an existing grantee before authorizing a new one.`,
        )
      }
      // MUST use the plan-returned `desiredScopeMask` (existing | kind),
      // never the bare `kindScopeMask`. `grant::issue` replaces the slot
      // wholesale on chain, so passing the single-bit scope would silently
      // narrow agents that already hold other scopes — exactly the bug
      // that caused {seal,skills,assets} → {assets} on production.
      await grant.issueGrant(target.address, null, target.desiredScopeMask, { setCapacityTo })
      setTargets((prev) => prev.filter((t) => t.address !== target.address))
      onAuthorized?.()
      void refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize agent')
    } finally {
      setGrantingAddress(null)
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3.5 py-3 text-[12px]">
      {targets.length > 0 && (
        <>
          <div className="mb-2 font-semibold text-amber-200">
            {targets.length} agent{targets.length === 1 ? '' : 's'} need {kindLabel} access on this Soul
          </div>
          <ul className="space-y-1.5">
            {targets.map((target) => (
              <li key={target.address} className="flex items-center justify-between gap-3">
                <span className="text-muted">
                  {target.displayName ?? truncateAddress(target.address)}
                  {target.displayName && (
                    <span className="ml-1 opacity-60">({truncateAddress(target.address)})</span>
                  )}
                </span>
                <button
                  type="button"
                  className="rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                  disabled={grantingAddress !== null}
                  onClick={() => void handleAuthorize(target)}
                >
                  {grantingAddress === target.address ? 'Authorizing…' : 'Authorize'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <div className={targets.length > 0 ? 'mt-2 text-red-400' : 'text-red-400'}>
          {error}
        </div>
      )}
    </div>
  )
}
