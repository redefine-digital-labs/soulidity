'use client'

import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAuth } from '@/components/providers/auth-provider'

export function useRequireAuth() {
  const { user, loading } = useAuth()
  const { login, ready } = usePrivy()

  const requireAuth = useCallback((callback?: () => void) => {
    if (loading || !ready) return

    if (user) {
      callback?.()
      return
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
