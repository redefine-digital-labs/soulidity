'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MAX_GRANT_BATCH_SIZE,
  MAX_GRANT_CAPACITY,
  SOUL_GRANT_SCOPE_ASSETS,
  buildBatchIssueGrantsTx,
  buildBatchRevokeGrantsTx,
} from '@soulidity/sdk'

import { useAuth } from '@/components/providers/auth-provider'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'

export interface GrantableSoulSummary {
  soulOnChainId: string
  stateOnChainId: string
  name: string
  imageUrl: string
  previewImage: string | null
  activeSpriteName?: string | null
  activeSpriteVersionIndex?: number | null
  activeSpriteDownloadPolicy?: string | null
}

export interface ActiveAssetGrantSummary {
  soulOnChainId: string
  stateOnChainId: string
  name: string
  imageUrl: string
  previewImage: string | null
  grantOnChainId: string
  expiresAt: string | null
}

export type PetGrantDialogMode = 'issue' | 'revoke'

interface PetGrantDialogProps {
  petId: string
  petLabel: string
  petAgentAddress: string
  mode: PetGrantDialogMode
  onClose: () => void
  onCompleted: () => void | Promise<void>
}

interface GrantSummary {
  soulOnChainId: string
  stateOnChainId: string
  name: string
  imageUrl: string
  previewImage: string | null
  /** Optional active-sprite badge text. Only set on issue mode. */
  spriteHint?: string | null
  /** Existing on-chain grant id; only set on revoke mode. */
  grantOnChainId?: string
  /** Display expiry; only set on revoke mode. */
  expiresAt?: string | null
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * Must stay ≤ the `MAX_ITEMS` cap enforced by
 * `web/app/api/souls/grant-merge-masks/route.ts` (currently 100). Sending
 * a larger preflight rejects with 400 before any wallet signature and
 * blocks the entire batch — see R-002.
 */
const MERGE_PREFLIGHT_BATCH_SIZE = 100

function truncateAddress(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

export function PetGrantDialog({
  petId,
  petLabel,
  petAgentAddress,
  mode,
  onClose,
  onCompleted,
}: PetGrantDialogProps) {
  const { getAuthHeaders } = useAuth()
  const { signAndExecute, suiWallet } = useWalletSign()

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<GrantSummary[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // Mirrors the `incompleteRecheck` flag from `/grantable-souls`. Set
  // when the on-chain active-grant fallback could not exhaustively prove
  // there are no further grants (caller owns more Souls than the per-call
  // cap, or a transient RPC failure). Drives the revoke-mode messaging:
  //   - empty items: replace the "no grants to revoke" copy with a
  //     blocking re-check error so the user does not assume a clean
  //     state.
  //   - non-empty items: surface a warning banner so the user knows the
  //     list may be partial.
  // Issue mode ignores this flag — the active-grant fallback only
  // affects the revoke-list completeness, not the issue eligibility list.
  const [incompleteRecheck, setIncompleteRecheck] = useState<
    { reason: 'owner-soul-overflow' | 'rpc-error' } | null
  >(null)

  const heading = mode === 'issue' ? 'Authorize sprite downloads' : 'Revoke sprite downloads'
  const description = mode === 'issue'
    ? `Grant ${petLabel} read-only access to download the protected sprites of the Souls you select. Grants stay valid until you revoke them here or unlink the pet.`
    : `Choose which active asset-scope grants to revoke for ${petLabel}. The pet will lose protected sprite downloads for those Souls immediately on-chain.`
  const confirmLabel = mode === 'issue' ? 'Authorize' : 'Revoke'

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIncompleteRecheck(null)
      try {
        const authHeaders = await getAuthHeaders()
        const response = await fetch(`/api/account/pets/${encodeURIComponent(petId)}/grantable-souls`, {
          method: 'GET',
          headers: authHeaders,
          credentials: 'same-origin',
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || `Failed to load Souls (${response.status})`)
        }
        const data = (await response.json()) as {
          souls: GrantableSoulSummary[]
          activeAssetGrants: ActiveAssetGrantSummary[]
          incompleteRecheck?: { reason: 'owner-soul-overflow' | 'rpc-error' }
        }
        if (cancelled) return

        setIncompleteRecheck(data.incompleteRecheck ?? null)

        if (mode === 'issue') {
          const next: GrantSummary[] = data.souls.map((soul) => {
            const policy = soul.activeSpriteDownloadPolicy ?? null
            const policyLabel = policy === 'allowlist' ? 'Allowlist' : policy === 'owner_only' ? 'Owner only' : null
            const versionLabel = soul.activeSpriteVersionIndex != null ? `v${soul.activeSpriteVersionIndex}` : null
            const spriteHint = [policyLabel, versionLabel].filter(Boolean).join(' · ') || null
            return {
              soulOnChainId: soul.soulOnChainId,
              stateOnChainId: soul.stateOnChainId,
              name: soul.name,
              imageUrl: soul.imageUrl,
              previewImage: soul.previewImage,
              spriteHint,
            }
          })
          setItems(next)
          setSelected(new Set(next.map((item) => item.soulOnChainId)))
        } else {
          const next: GrantSummary[] = data.activeAssetGrants.map((grant) => ({
            soulOnChainId: grant.soulOnChainId,
            stateOnChainId: grant.stateOnChainId,
            name: grant.name,
            imageUrl: grant.imageUrl,
            previewImage: grant.previewImage,
            grantOnChainId: grant.grantOnChainId,
            expiresAt: grant.expiresAt,
          }))
          setItems(next)
          setSelected(new Set(next.map((item) => item.soulOnChainId)))
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load Souls')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [getAuthHeaders, mode, petId])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === items.length && items.length > 0) {
        return new Set()
      }
      return new Set(items.map((item) => item.soulOnChainId))
    })
  }, [items])

  const toggleOne = useCallback((soulOnChainId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(soulOnChainId)) {
        next.delete(soulOnChainId)
      } else {
        next.add(soulOnChainId)
      }
      return next
    })
  }, [])

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.soulOnChainId)),
    [items, selected],
  )

  const batchCount = useMemo(
    () => Math.ceil(selectedItems.length / MAX_GRANT_BATCH_SIZE),
    [selectedItems.length],
  )

  const handleConfirm = useCallback(async () => {
    if (!suiWallet) {
      setError('Connect a Sui wallet before signing transactions')
      return
    }
    if (selectedItems.length === 0) {
      setError(mode === 'issue' ? 'Select at least one Soul to authorize' : 'Select at least one grant to revoke')
      return
    }

    setPending(true)
    setError(null)
    setProgress({ done: 0, total: batchCount })
    try {
      const authHeaders = await getAuthHeaders()
      const batches = chunk(selectedItems, MAX_GRANT_BATCH_SIZE)

      // Issue path: preflight existing scopes per Soul. `grant::issue`
      // replaces the grantee's slot wholesale, so issuing with the bare
      // `SOUL_GRANT_SCOPE_ASSETS` would silently narrow any agent that
      // already holds other scopes on a Soul (e.g. sprite-upload
      // auto-grant just expanded them to {seal,skills,assets}, then a
      // PetGrantDialog issue would knock them back to {assets} only).
      // The merge endpoint returns `mergedScopeMask = existing | added`
      // per item; we use it as the on-chain scope so the supersede
      // strictly EXPANDS the grantee's scopes.
      //
      // The endpoint also returns `isNewGrantee`, `currentCapacity`, and
      // `requiredCapacity` per item (R-001). When a Soul is at capacity
      // and the pet is a new grantee on that Soul, `grant::issue` would
      // abort with `EGrantCapacityExceeded` unless `set_grant_capacity`
      // is spliced into the same PTB. We capture `setCapacityTo` per
      // item so the per-item batch builder splices the bump in order.
      //
      // The endpoint caps each request at `MERGE_PREFLIGHT_BATCH_SIZE`,
      // so split the preflight into chunks. Sequential — keeps total
      // RPC pressure bounded and respects the 60/5min rate limit when
      // a single user authorizes many Souls in a row (R-002).
      interface PreflightDecision {
        mergedScopeMask: number
        setCapacityTo: number | null
      }
      const decisionBySoul = new Map<string, PreflightDecision>()
      if (mode === 'issue') {
        const preflightChunks = chunk(selectedItems, MERGE_PREFLIGHT_BATCH_SIZE)
        for (const preflightBatch of preflightChunks) {
          const mergeResponse = await fetch('/api/souls/grant-merge-masks', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              items: preflightBatch.map((item) => ({
                soulOnChainId: item.soulOnChainId,
                granteeAddress: petAgentAddress,
                addedScopeMask: SOUL_GRANT_SCOPE_ASSETS,
              })),
            }),
          })
          if (!mergeResponse.ok) {
            const body = (await mergeResponse.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error || `Failed to compute grant scopes (${mergeResponse.status})`)
          }
          const mergeBody = (await mergeResponse.json()) as {
            items: Array<{
              soulOnChainId: string
              mergedScopeMask: number
              isNewGrantee: boolean
              currentCapacity: number
              requiredCapacity: number
            }>
          }
          for (const m of mergeBody.items) {
            if (m.isNewGrantee && m.requiredCapacity > MAX_GRANT_CAPACITY) {
              // Fail fast before any wallet signature — bumping past the
              // on-chain ceiling would always abort. Tell the user which
              // Soul is the problem so they can revoke an existing
              // grantee on it manually before retrying.
              throw new Error(
                `Soul ${m.soulOnChainId} is at the on-chain grant capacity limit (${MAX_GRANT_CAPACITY}). Revoke an existing grantee on that Soul before authorizing this pet.`,
              )
            }
            decisionBySoul.set(m.soulOnChainId, {
              mergedScopeMask: m.mergedScopeMask,
              setCapacityTo:
                m.requiredCapacity > m.currentCapacity ? m.requiredCapacity : null,
            })
          }
        }
      }

      for (const [batchIndex, batch] of batches.entries()) {
        const tx = mode === 'issue'
          ? buildBatchIssueGrantsTx({
              items: batch.map((item) => {
                const decision = decisionBySoul.get(item.soulOnChainId)
                return {
                  stateObjectId: item.stateOnChainId,
                  granteeAddress: petAgentAddress,
                  scopeMask: decision?.mergedScopeMask ?? SOUL_GRANT_SCOPE_ASSETS,
                  // Lifetime grant — pet access ends only via explicit
                  // revoke from PetCard or unlink. See feedback memory
                  // `feedback_grant_no_default_expiry`.
                  expiresAtMs: null,
                  // R-001: splice `set_grant_capacity` before `issue`
                  // when the preflight said this Soul's capacity must
                  // be raised to fit a new grantee. `null` for existing
                  // grantees (supersede reuses the slot) and for souls
                  // already at sufficient capacity.
                  setCapacityTo: decision?.setCapacityTo ?? null,
                }
              }),
            })
          : buildBatchRevokeGrantsTx({
              items: batch.map((item) => ({
                stateObjectId: item.stateOnChainId,
                granteeAddress: petAgentAddress,
              })),
            })

        const result = await signAndExecute(tx)
        const expectedSoulIds = batch.map((item) => item.soulOnChainId)

        const response = await fetch(
          `/api/account/pets/${encodeURIComponent(petId)}/grant-mirror`,
          {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              action: mode,
              txDigest: result.digest,
              expectedSoulIds,
            }),
          },
        )
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || `Mirror failed (${response.status})`)
        }
        setProgress({ done: batchIndex + 1, total: batches.length })
      }

      await onCompleted()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${mode === 'issue' ? 'Authorize' : 'Revoke'} failed`)
    } finally {
      setPending(false)
      setProgress(null)
    }
  }, [
    batchCount,
    getAuthHeaders,
    mode,
    onClose,
    onCompleted,
    petAgentAddress,
    petId,
    selectedItems,
    signAndExecute,
    suiWallet,
  ])

  const renderEmpty = () => {
    if (mode === 'issue') {
      return (
        <p className="text-sm text-muted">
          No protected Souls are waiting to be authorized. Mint or move a protected
          sprite into this account to enable desktop downloads.
        </p>
      )
    }
    if (incompleteRecheck) {
      // Empty + incomplete is NOT "no grants to revoke" — the on-chain
      // re-check could not exhaustively prove that. Block the user with
      // a clear retry / support path so they don't assume a clean state.
      const message = incompleteRecheck.reason === 'owner-soul-overflow'
        ? 'Could not verify on-chain grant state for this desktop pet — this account owns too many Souls to scan exhaustively. Contact support before unlinking; lingering on-chain grants may need manual revocation.'
        : 'Could not verify on-chain grant state for this desktop pet. Close this dialog and try again in a moment — if the issue persists, contact support.'
      return (
        <p className="text-sm font-semibold text-danger">
          {message}
        </p>
      )
    }
    return (
      <p className="text-sm text-muted">
        This pet has no active asset-scope grants to revoke.
      </p>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{heading}</h2>
            <p className="mt-1 text-xs text-muted">
              <span className="font-mono" title={petAgentAddress}>{truncateAddress(petAgentAddress)}</span>
              <span aria-hidden="true"> · </span>
              <span>{description}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-muted transition-colors hover:text-foreground disabled:opacity-50"
            aria-label="Close grant dialog"
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-6">{renderEmpty()}</div>
        ) : (
          <>
            {mode === 'revoke' && incompleteRecheck && (
              <div className="mt-4 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                {incompleteRecheck.reason === 'owner-soul-overflow'
                  ? 'On-chain re-check could not enumerate every owned Soul — this list may be partial. Contact support if any grants remain after revocation.'
                  : 'On-chain re-check was incomplete (transient RPC error) — this list may be partial. Retry the unlink after revocation; any remaining grants will surface again.'}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted">
                {selectedItems.length} of {items.length} selected
                {batchCount > 1 && (
                  <span aria-hidden="true">{' · '}{batchCount} signatures required</span>
                )}
              </p>
              <button
                type="button"
                onClick={toggleAll}
                disabled={pending}
                className="text-xs font-semibold text-primary underline disabled:opacity-50"
              >
                {selected.size === items.length ? 'Clear all' : 'Select all'}
              </button>
            </div>

            <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {items.map((item) => {
                const checked = selected.has(item.soulOnChainId)
                return (
                  <li key={item.soulOnChainId}>
                    <label
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
                        checked ? 'border-purple bg-purple/5' : 'border-border bg-card2'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(item.soulOnChainId)}
                        disabled={pending}
                        className="h-4 w-4"
                      />
                      {(item.previewImage || item.imageUrl) && (
                        // eslint-disable-next-line @next/next/no-img-element -- thumbs are external (Walrus)
                        <img
                          src={item.previewImage ?? item.imageUrl}
                          alt=""
                          className="h-9 w-9 rounded object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground" title={item.name}>
                          {item.name}
                        </div>
                        <div className="text-[11px] text-muted">
                          {mode === 'issue' && item.spriteHint && <span>{item.spriteHint}</span>}
                          {mode === 'revoke' && (
                            <span>
                              Expires {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : '—'}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {progress && (
          <p className="mt-3 text-xs text-muted">
            Signed {progress.done} of {progress.total} batch{progress.total === 1 ? '' : 'es'}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs font-semibold text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs font-semibold text-muted transition hover:text-foreground disabled:opacity-50"
          >
            {pending ? 'Cancel' : 'Close'}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={pending || items.length === 0 || selectedItems.length === 0}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Signing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
