'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { useAuth } from '@/components/providers/auth-provider'

import { PetGrantDialog, type PetGrantDialogMode } from './PetGrantDialog'

export interface PetSummary {
  id: string
  label: string
  agentAddress: string
  lastSeenAt: string | null
  agentStatus: string | null
  hasActiveApiKey: boolean
  /** Number of active, non-expired asset-scope grants targeting this pet. */
  activeAssetGrantCount?: number
  createdAt: string
  updatedAt: string
}

interface PetCardProps {
  pet: PetSummary
  onMutate: () => void | Promise<void>
  /** When set, the PetCard auto-opens the issue dialog on mount. Used by
   *  the post-link UX so the user signs the asset-grant transaction
   *  immediately after the userCode complete redirect. */
  autoOpenGrant?: PetGrantDialogMode | null
  /** Notifies the parent that the auto-open intent has been consumed so it
   *  doesn't fire again on subsequent re-renders. */
  onAutoOpenConsumed?: () => void
}

const MAX_LABEL_LENGTH = 64

function truncateAddress(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000) return 'active now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  // For older timestamps a calendar date is more informative than "Nm ago".
  return new Date(iso).toLocaleDateString()
}

interface AgentStatusBadge {
  label: string
  variant: 'active' | 'disabled' | 'warning'
}

function deriveStatusBadge(pet: PetSummary): AgentStatusBadge {
  if (pet.agentStatus === 'active' && !pet.hasActiveApiKey) {
    return { label: 'API key rotated externally', variant: 'warning' }
  }
  if (pet.agentStatus === 'active') {
    return { label: 'Active', variant: 'active' }
  }
  if (pet.agentStatus === 'disabled') {
    return { label: 'Disabled', variant: 'disabled' }
  }
  return { label: pet.agentStatus ?? 'Unknown', variant: 'warning' }
}

const badgeClass: Record<AgentStatusBadge['variant'], string> = {
  active: 'border-teal/40 bg-teal/10 text-teal',
  disabled: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
}

export function PetCard({ pet, onMutate, autoOpenGrant, onAutoOpenConsumed }: PetCardProps) {
  const { getAuthHeaders } = useAuth()
  const renameInputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(pet.label)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [grantDialogMode, setGrantDialogMode] = useState<PetGrantDialogMode | null>(() => autoOpenGrant ?? null)
  const activeAssetGrantCount = pet.activeAssetGrantCount ?? 0
  // Mirrors the server-side gating in
  // `/api/account/pets/[id]/grant-mirror` (issue path) and
  // `/api/account/pets/[id]/grantable-souls`. Once a desktop reset has
  // disabled the agent member, new grants cannot be backed by a usable
  // bearer/API key — only revoke remains useful so the human owner can
  // clean up any lingering on-chain grants before unlinking.
  const canAuthorizeGrants = pet.agentStatus === 'active'

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const closeGrantDialog = useCallback(() => {
    setGrantDialogMode(null)
    if (autoOpenGrant) onAutoOpenConsumed?.()
  }, [autoOpenGrant, onAutoOpenConsumed])

  const startEdit = useCallback(() => {
    setDraftLabel(pet.label)
    setError(null)
    setIsEditing(true)
  }, [pet.label])

  const cancelEdit = useCallback(() => {
    setDraftLabel(pet.label)
    setError(null)
    setIsEditing(false)
  }, [pet.label])

  const submitRename = useCallback(async () => {
    const trimmed = draftLabel.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) {
      setError(`Label must be 1-${MAX_LABEL_LENGTH} characters.`)
      return
    }
    if (trimmed === pet.label) {
      setIsEditing(false)
      return
    }

    setPending(true)
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/account/pets/${encodeURIComponent(pet.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        credentials: 'same-origin',
        body: JSON.stringify({ label: trimmed }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || `Rename failed (${response.status})`)
        return
      }

      setIsEditing(false)
      await onMutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error while saving.')
    } finally {
      setPending(false)
    }
  }, [draftLabel, getAuthHeaders, onMutate, pet.id, pet.label])

  const handleUnlink = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/account/pets/${encodeURIComponent(pet.id)}`, {
        method: 'DELETE',
        headers: authHeaders,
        credentials: 'same-origin',
      })

      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
          activeAssetGrants?: Array<{ grantOnChainId: string; soulOnChainId: string }>
        }
        const count = body.activeAssetGrants?.length ?? 0
        setError(
          body.error
          || `Revoke ${count} active sprite grant${count === 1 ? '' : 's'} before unlinking.`,
        )
        setConfirmDelete(false)
        // Open the revoke modal directly so the user does not need to find
        // the affordance after the inline error.
        setGrantDialogMode('revoke')
        return
      }

      // Fail-closed retryable response from the on-chain grant re-check.
      // The mirror was empty so `activeAssetGrantCount` is zero (the normal
      // revoke button is hidden), but the helper could not exhaustively
      // prove there are no live grants. Open the revoke dialog so the
      // user sees any chain-identified grants and the dialog's own
      // incomplete-recheck banner — without this branch the inline error
      // is the only feedback and there is no path forward.
      if (response.status === 503) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
          retryable?: boolean
          reason?: 'owner-soul-overflow' | 'rpc-error'
        }
        const fallback = body.reason === 'owner-soul-overflow'
          ? 'Could not verify on-chain grant state — this account owns too many Souls to scan exhaustively. Open the revoke dialog to review any grants we did identify, or contact support.'
          : 'Could not verify on-chain grant state for this desktop pet. Please retry.'
        setError(body.error || fallback)
        setConfirmDelete(false)
        setGrantDialogMode('revoke')
        return
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || `Unlink failed (${response.status})`)
        setConfirmDelete(false)
        return
      }

      await onMutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error while unlinking.')
    } finally {
      setPending(false)
    }
  }, [getAuthHeaders, onMutate, pet.id])

  const badge = deriveStatusBadge(pet)

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={renameInputId} className="sr-only">
                Pet label
              </label>
              <input
                ref={inputRef}
                id={renameInputId}
                type="text"
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEdit()
                  }
                }}
                maxLength={MAX_LABEL_LENGTH}
                disabled={pending}
                className="w-full rounded-lg border border-border bg-card2 px-3 py-2 text-sm text-foreground outline-none transition focus:border-purple"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void submitRename()}
                  disabled={pending}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={pending}
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-muted transition hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground" title={pet.label}>
                {pet.label}
              </h3>
              <button
                type="button"
                onClick={startEdit}
                className="text-muted transition-colors hover:text-foreground"
                aria-label={`Rename ${pet.label}`}
              >
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span className="font-mono" title={pet.agentAddress}>
              {truncateAddress(pet.agentAddress)}
            </span>
            <span aria-hidden="true">·</span>
            <span>Last seen {formatRelative(pet.lastSeenAt)}</span>
          </div>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em] ${badgeClass[badge.variant]}`}
        >
          {badge.label}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] text-muted">
          Linked {new Date(pet.createdAt).toLocaleDateString()}
          {activeAssetGrantCount > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span>
                {activeAssetGrantCount} active sprite grant{activeAssetGrantCount === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAuthorizeGrants && (
            <button
              type="button"
              onClick={() => setGrantDialogMode('issue')}
              disabled={pending}
              className="inline-flex h-8 items-center rounded-md border border-purple/40 px-3 text-xs font-semibold text-purple transition hover:bg-purple/10 disabled:opacity-50"
            >
              Authorize sprite downloads
            </button>
          )}
          {activeAssetGrantCount > 0 && (
            <button
              type="button"
              onClick={() => setGrantDialogMode('revoke')}
              disabled={pending}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Revoke sprite downloads
            </button>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted">Unlink and revoke key?</span>
              <button
                type="button"
                onClick={() => void handleUnlink()}
                disabled={pending}
                className="inline-flex h-8 items-center rounded-md bg-danger px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending ? 'Unlinking…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-muted transition hover:text-foreground disabled:opacity-50"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
              className="inline-flex h-8 items-center rounded-md border border-danger/40 px-3 text-xs font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              Unlink
            </button>
          )}
        </div>
      </div>

      {grantDialogMode && (
        <PetGrantDialog
          petId={pet.id}
          petLabel={pet.label}
          petAgentAddress={pet.agentAddress}
          mode={grantDialogMode}
          onClose={closeGrantDialog}
          onCompleted={onMutate}
        />
      )}
    </div>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M11.5 2.5 13.5 4.5 5 13H3v-2L11.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
