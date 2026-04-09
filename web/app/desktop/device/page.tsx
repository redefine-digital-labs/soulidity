'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'

import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { useAuth } from '@/components/providers/auth-provider'
import { Button, buttonStyles } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import type { DesktopDeviceCompleteResponse } from '@/lib/types/desktop'

function resolveAccountLabel(user: ReturnType<typeof useAuth>['user']) {
  if (!user) {
    return null
  }

  return user.displayName ?? user.tgName ?? user.primarySuiAddress ?? user.id
}

export default function DesktopDevicePage() {
  const searchParams = useSearchParams()
  const userCode = searchParams.get('userCode')?.trim().toUpperCase() ?? ''
  const { user, loading, getAuthHeaders } = useAuth()
  const { login, ready } = usePrivy()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [completeResult, setCompleteResult] = useState<DesktopDeviceCompleteResponse | null>(null)

  const accountLabel = resolveAccountLabel(user)

  async function handleComplete() {
    if (!userCode) {
      setError('Missing pairing code. Return to Soulidity Desktop and start sign-in again.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch('/api/desktop/device/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ userCode }),
      })

      const payload = await response.json().catch(() => null) as
        | DesktopDeviceCompleteResponse
        | { error?: string; status?: string }
        | null

      if (!response.ok) {
        if (payload && typeof payload === 'object' && payload.status === 'expired') {
          setError('This pairing code has expired. Start a fresh sign-in from Soulidity Desktop.')
          return
        }

        if (payload && typeof payload === 'object' && payload.status === 'invalid_code') {
          setError('This pairing code is invalid. Start a fresh sign-in from Soulidity Desktop.')
          return
        }

        setError(
          payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Unable to confirm this desktop right now.',
        )
        return
      }

      setCompleteResult(payload as DesktopDeviceCompleteResponse)
    } catch {
      setError('Unable to confirm this desktop right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PageContainer size="md">
      <SectionHeader
        label="Desktop Login"
        title="Confirm This Soulidity Desktop"
        subtitle="Use the pairing code from your desktop app to bind this browser session without embedding login inside Tauri."
      />

      <div className="card space-y-5 rounded-2xl p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="page-kicker">Pairing Code</div>
            <div className="mt-2 font-mono text-lg font-semibold tracking-[0.18em] text-foreground">
              {userCode || 'MISSING'}
            </div>
          </div>
          <div className="rounded-full border border-teal/30 bg-teal/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-teal">
            Browser Confirm
          </div>
        </div>

        {loading || !ready ? (
          <div className="space-y-3">
            <div className="h-5 w-32 rounded bg-card2 animate-pulse" />
            <div className="h-24 rounded-xl bg-card2 animate-pulse" />
          </div>
        ) : !userCode ? (
          <EmptyState
            icon="⌁"
            label="Missing pairing code"
            sublabel="Open Soulidity Desktop, start the login flow again, and revisit this page from the fresh browser link."
            className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-10"
          />
        ) : !user ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card2/55 p-4">
              <div className="text-sm font-semibold text-foreground">Sign in first</div>
              <p className="mt-2 text-[13px] leading-6 text-muted">
                Pairing code <span className="font-mono text-foreground">{userCode}</span> is waiting for a logged-in Soulidity account.
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                void login()
              }}
            >
              Sign In To Continue
            </Button>
          </div>
        ) : completeResult ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/30 bg-success/10 p-4">
              <div className="text-sm font-semibold text-foreground">Desktop confirmed</div>
              <p className="mt-2 text-[13px] leading-6 text-muted">
                {accountLabel} is now linked to pairing code <span className="font-mono text-foreground">{completeResult.userCode}</span>.
              </p>
            </div>
            <a href={completeResult.deepLink} className={buttonStyles({ variant: 'primary' })}>
              Open Soulidity Desktop
            </a>
            <div className="rounded-xl border border-border bg-card2/55 p-4 text-[13px] text-muted">
              Deep link ready: <span className="font-mono break-all text-foreground">{completeResult.deepLink}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card2/55 p-4">
              <div className="text-sm font-semibold text-foreground">Signed in as</div>
              <p className="mt-2 text-[13px] leading-6 text-muted">
                {accountLabel} will be linked to pairing code <span className="font-mono text-foreground">{userCode}</span>.
              </p>
            </div>

            {error ? (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-foreground">
                {error}
              </div>
            ) : null}

            <Button variant="primary" onClick={handleComplete} disabled={isSubmitting}>
              {isSubmitting ? 'Confirming…' : 'Confirm This Desktop'}
            </Button>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
