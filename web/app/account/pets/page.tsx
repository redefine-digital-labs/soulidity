'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth } from '@/components/providers/auth-provider'

import { LinkPetDialog } from './_components/LinkPetDialog'
import { PetCard, type PetSummary } from './_components/PetCard'

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; pets: PetSummary[] }
  | { status: 'error'; message: string }

function PetsPanel() {
  const { authenticated, getAuthHeaders } = useAuth()
  const searchParams = useSearchParams()
  const initialCode = searchParams.get('link')
  const [state, setState] = useState<FetchState>({ status: 'idle' })
  // `autoOpenGrantPetId` flips on once after a fresh link so the matching
  // PetCard opens the issue dialog — the wallet sign still happens
  // explicitly inside the dialog.
  const [autoOpenGrantPetId, setAutoOpenGrantPetId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    try {
      const headers = await getAuthHeaders()
      const response = await fetch('/api/account/pets', {
        method: 'GET',
        headers,
        credentials: 'same-origin',
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setState({
          status: 'error',
          message: body.error || `Failed to load pets (${response.status})`,
        })
        return
      }

      const body = (await response.json()) as { pets: PetSummary[] }
      setState({ status: 'ready', pets: body.pets })
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error while loading pets',
      })
    }
  }, [getAuthHeaders])

  const handleLinked = useCallback(
    async (result: { petId: string | null }) => {
      if (result.petId) {
        setAutoOpenGrantPetId(result.petId)
      }
      await refresh()
    },
    [refresh],
  )

  useEffect(() => {
    if (!authenticated) return
    void refresh()
  }, [authenticated, refresh])

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 relative z-10">
      <div className="mb-6">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">
          Account
        </p>
        <h1 className="font-display text-2xl font-bold mb-2">My Desktop Pets</h1>
        <p className="text-sm text-muted">
          Each linked desktop companion appears here. Rename a pet, see when it
          was last active, or unlink one to revoke its access.
        </p>
      </div>

      <div className="mb-6">
        <LinkPetDialog initialCode={initialCode} onLinked={handleLinked} />
      </div>

      {state.status === 'loading' || state.status === 'idle' ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="h-4 w-32 rounded bg-card2 animate-pulse mb-3" />
          <div className="h-16 w-full rounded bg-card2 animate-pulse" />
        </div>
      ) : state.status === 'error' ? (
        <div className="rounded-xl border border-danger/30 bg-danger/8 px-5 py-4">
          <p className="text-sm font-semibold text-danger">{state.message}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 text-xs font-semibold text-danger underline"
          >
            Retry
          </button>
        </div>
      ) : state.pets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-8 text-center">
          <div className="text-3xl mb-2" aria-hidden="true">
            🪐
          </div>
          <p className="text-sm font-semibold text-foreground">No desktop pets yet</p>
          <p className="mt-1 text-xs text-muted">
            Open Soulidity Desktop, copy the code from Settings, and paste it
            here to link your first pet.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {state.pets.map((pet) => (
            <li key={pet.id}>
              <PetCard
                pet={pet}
                onMutate={refresh}
                autoOpenGrant={autoOpenGrantPetId === pet.id ? 'issue' : null}
                onAutoOpenConsumed={() => setAutoOpenGrantPetId(null)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AccountPetsPage() {
  return (
    <AuthGate
      icon="🛰️"
      label="Sign in to manage desktop pets"
      sublabel="You need a wallet session to view and manage your linked desktop companions."
      className="max-w-2xl"
    >
      <Suspense fallback={null}>
        <PetsPanel />
      </Suspense>
    </AuthGate>
  )
}
