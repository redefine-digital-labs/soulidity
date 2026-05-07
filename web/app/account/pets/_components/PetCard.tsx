'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { useAuth } from '@/components/providers/auth-provider'

export interface PetSummary {
  id: string
  label: string
  agentAddress: string
  lastSeenAt: string | null
  agentStatus: string | null
  hasActiveApiKey: boolean
  createdAt: string
  updatedAt: string
}

interface PetCardProps {
  pet: PetSummary
  onMutate: () => void | Promise<void>
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

export function PetCard({ pet, onMutate }: PetCardProps) {
  const { getAuthHeaders } = useAuth()
  const renameInputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(pet.label)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reflect server-side updates (e.g. after a refresh) without trampling
  // an unfinished rename in progress.
  useEffect(() => {
    if (!isEditing) {
      setDraftLabel(pet.label)
    }
  }, [pet.label, isEditing])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

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

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[11px] text-muted">
          Linked {new Date(pet.createdAt).toLocaleDateString()}
        </div>

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
