'use client'

import { useCallback } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import { savePendingAction } from '@/lib/utils/pending-action'

interface RequireAuthPending {
  path: string
  label: string
}

export function useRequireAuth() {
  const { user, loading, login } = useAuth()

  const requireAuth = useCallback((callback?: () => void, pending?: RequireAuthPending) => {
    if (loading) return

    if (user) {
      callback?.()
      return
    }

    if (pending) {
      savePendingAction(pending)
    }

    login()
  }, [loading, login, user])

  return {
    user,
    loading,
    login,
    requireAuth,
    isAuthenticated: !!user,
  }
}
