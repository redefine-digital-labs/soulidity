'use client'

import { useState, useCallback } from 'react'
import { useLinkJwtAccount } from '@privy-io/react-auth'
import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth } from '@/components/providers/auth-provider'

type LinkStatus = 'idle' | 'submitting' | 'confirmed' | 'error'

export default function DesktopLinkPage() {
  return (
    <AuthGate icon="link" label="Link Desktop Companion" sublabel="Sign in to link your device">
      <DesktopLinkForm />
    </AuthGate>
  )
}

function DesktopLinkForm() {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<LinkStatus>('idle')
  const [message, setMessage] = useState('')
  const { linkWithCustomJwt } = useLinkJwtAccount()
  const { getAuthHeaders } = useAuth()

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return

    setStatus('submitting')
    setMessage('')

    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/desktop/device/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ userCode: trimmed }),
      })

      const data = await res.json()

      if (data.status === 'confirmed') {
        const privyTokenResponse = await fetch('/api/desktop/auth/privy-token', {
          method: 'POST',
          headers: authHeaders,
        })
        const privyTokenBody = await privyTokenResponse.json().catch(() => ({}))
        if (!privyTokenResponse.ok) {
          throw new Error(
            typeof privyTokenBody.error === 'string'
              ? privyTokenBody.error
              : 'Desktop linked, but wallet auth setup failed.',
          )
        }

        if (!privyTokenBody.alreadyLinked && typeof privyTokenBody.jwt === 'string') {
          await linkWithCustomJwt(privyTokenBody.jwt)
        }

        setStatus('confirmed')
        setMessage('Device linked successfully!')
      } else if (data.status === 'expired') {
        setStatus('error')
        setMessage('This code has expired. Please generate a new one from your desktop companion.')
      } else if (data.status === 'invalid_code') {
        setStatus('error')
        setMessage('Invalid code. Please check and try again.')
      } else if (data.error) {
        setStatus('error')
        setMessage(data.error)
      }
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Network error. Please try again.')
    }
  }, [code, linkWithCustomJwt, getAuthHeaders])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Link Desktop Companion</h1>
          <p className="text-sm text-foreground/60">
            Enter the code shown in your Soulidity Desktop companion to link it to your account.
          </p>
        </div>

        {status === 'confirmed' ? (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-center">
            <p className="text-green-400 font-medium">{message}</p>
            <p className="text-sm text-foreground/50 mt-2">
              You can close this page. Your desktop companion is now linked.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX"
                className="w-full px-4 py-3 rounded-lg bg-card border border-border text-center text-lg font-mono tracking-widest text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/50"
                maxLength={9}
                autoFocus
                disabled={status === 'submitting'}
              />
            </div>

            {status === 'error' && message && (
              <p className="text-sm text-red-400 text-center">{message}</p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting' || code.trim().length < 4}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-medium transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? 'Linking...' : 'Link Device'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
