'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { useAuth } from '@/components/providers/auth-provider'

const USER_CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

type LinkStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'confirmed' }
  | { kind: 'error'; message: string }

interface LinkPetDialogProps {
  initialCode: string | null
  /**
   * Called after the device session is confirmed. The optional `petId` is
   * the freshly-linked DesktopPet row id (when the device-start carried a
   * wallet sig). Pages use it to auto-open the asset-grant authorize step
   * — wallet still signs explicitly; the server never silently issues
   * grants. `null` means the link succeeded but the session had no agent
   * address (legacy fallback).
   */
  onLinked: (result: { petId: string | null }) => void | Promise<void>
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase()
}

export function LinkPetDialog({ initialCode, onLinked }: LinkPetDialogProps) {
  const { getAuthHeaders } = useAuth()
  const [open, setOpen] = useState(() => Boolean(initialCode && USER_CODE_REGEX.test(normalizeCode(initialCode))))
  const [code, setCode] = useState(() => (initialCode ? normalizeCode(initialCode) : ''))
  const [status, setStatus] = useState<LinkStatus>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogId = useId()

  // If the URL deep-link arrives after first render (e.g. soft navigation),
  // keep the dialog state in sync with the latest `?link=` value.
  useEffect(() => {
    if (!initialCode) return
    const normalized = normalizeCode(initialCode)
    if (!USER_CODE_REGEX.test(normalized)) return
    setCode(normalized)
    setOpen(true)
  }, [initialCode])

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      const trimmed = normalizeCode(code)
      if (!USER_CODE_REGEX.test(trimmed)) {
        setStatus({ kind: 'error', message: 'Code format is XXXX-XXXX (letters and digits).' })
        return
      }

      setStatus({ kind: 'submitting' })
      try {
        const authHeaders = await getAuthHeaders()
        const response = await fetch('/api/desktop/device/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          credentials: 'same-origin',
          body: JSON.stringify({ userCode: trimmed }),
        })

        let data: {
          status?: string
          error?: string
          petId?: string | null
          agentAddress?: string | null
        } = {}
        try {
          data = (await response.json()) as typeof data
        } catch {
          data = {}
        }

        if (response.status === 409) {
          setStatus({
            kind: 'error',
            message:
              data.error || 'This desktop pet is already linked to another account.',
          })
          return
        }

        if (data.status === 'confirmed') {
          setStatus({ kind: 'confirmed' })
          await onLinked({ petId: data.petId ?? null })
          return
        }

        if (data.status === 'expired') {
          setStatus({
            kind: 'error',
            message: 'This code has expired. Generate a new one from your desktop companion.',
          })
          return
        }

        if (data.status === 'invalid_code') {
          setStatus({ kind: 'error', message: 'Invalid code. Check it and try again.' })
          return
        }

        if (!response.ok) {
          setStatus({
            kind: 'error',
            message: data.error || `Link failed (${response.status})`,
          })
          return
        }

        setStatus({
          kind: 'error',
          message: data.error || 'Unexpected response from the server.',
        })
      } catch (err) {
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Network error. Please try again.',
        })
      }
    },
    [code, getAuthHeaders, onLinked],
  )

  const closeDialog = useCallback(() => {
    setOpen(false)
    setStatus({ kind: 'idle' })
    setCode('')
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <span aria-hidden="true">+</span>
        Link new pet
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5" aria-labelledby={`${dialogId}-title`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${dialogId}-title`} className="text-sm font-bold text-foreground">
            Link a desktop pet
          </h2>
          <p className="mt-1 text-xs text-muted">
            Open Soulidity Desktop, copy the 8-character code from Settings, and paste it below.
          </p>
        </div>
        <button
          type="button"
          onClick={closeDialog}
          className="text-muted transition-colors hover:text-foreground"
          aria-label="Close link dialog"
        >
          ×
        </button>
      </div>

      {status.kind === 'confirmed' ? (
        <div className="mt-4 rounded-lg border border-teal/40 bg-teal/8 px-4 py-3">
          <p className="text-sm font-semibold text-teal">Pet linked successfully!</p>
          <p className="mt-1 text-xs text-muted">
            Your desktop companion will pick up the link the next time it polls.
          </p>
          <button
            type="button"
            onClick={closeDialog}
            className="mt-3 text-xs font-semibold text-teal underline"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label htmlFor={`${dialogId}-code`} className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Pairing code
          </label>
          <input
            ref={inputRef}
            id={`${dialogId}-code`}
            type="text"
            value={code}
            onChange={(event) => setCode(normalizeCode(event.target.value))}
            placeholder="XXXX-XXXX"
            maxLength={9}
            className="w-full rounded-lg border border-border bg-card2 px-4 py-3 text-center text-lg font-mono tracking-widest text-foreground outline-none transition placeholder:text-border focus:border-purple"
            disabled={status.kind === 'submitting'}
            autoComplete="off"
            spellCheck={false}
          />

          {status.kind === 'error' && (
            <p role="alert" className="text-xs font-semibold text-danger">
              {status.message}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={status.kind === 'submitting' || !USER_CODE_REGEX.test(code)}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status.kind === 'submitting' ? 'Linking…' : 'Link pet'}
            </button>
            <button
              type="button"
              onClick={closeDialog}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-muted transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
