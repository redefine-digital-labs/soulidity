'use client'

import { useState } from 'react'
import { useAuth } from '@/components/providers/auth-provider'

export type ProfileUpdateStatus = 'idle' | 'saving' | 'success' | 'error'

export interface ProfileUpdatePayload {
  displayName?: string | null
  avatar?: string | null
  bio?: string | null
  handle?: string | null
  twitterUrl?: string | null
  websiteUrl?: string | null
}

export function useUpdateProfile() {
  const [status, setStatus] = useState<ProfileUpdateStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const { getAuthHeaders, refresh } = useAuth()

  async function updateProfile(payload: ProfileUpdatePayload) {
    setStatus('saving')
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Update failed: ${res.status}`)
      }
      await refresh()
      setStatus('success')
      setTimeout(() => setStatus('idle'), 3000)
      return res.json()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile update failed')
      setStatus('error')
      throw err
    }
  }

  return { status, error, updateProfile }
}
