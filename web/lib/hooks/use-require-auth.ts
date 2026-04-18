'use client'

import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/components/providers/auth-provider'
import { savePendingAction } from '@/lib/utils/pending-action'

interface RequireAuthPending {
  path: string
  label: string
}

export function useRequireAuth() {
  const { user, loading } = useAuth()
  const { login, ready } = usePrivy()

  const requireAuth = useCallback((callback?: () => void, pending?: RequireAuthPending) => {
    if (loading || !ready) return

    if (user) {
      callback?.()
      return
    }

    if (pending) {
      savePendingAction(pending)
    }

    void login()
  }, [loading, login, ready, user])

  return {
    user,
    loading: loading || !ready,
    login,
    requireAuth,
    isAuthenticated: !!user,
  }
}
