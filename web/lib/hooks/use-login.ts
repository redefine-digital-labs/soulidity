'use client'

import { useCallback } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import { clearPendingAction } from '@/lib/utils/pending-action'

/**
 * Generic sign-in entrypoint for buttons/links that should open the wallet
 * connect modal but are not tied to a specific gated action. Clears any stale
 * pending-action entry so a previously cancelled gated flow does not hijack
 * this unrelated sign-in.
 *
 * Use `useRequireAuth` for gated actions that should resume after login.
 */
export function useLogin(): () => void {
  const { login } = useAuth()
  return useCallback(() => {
    clearPendingAction()
    login()
  }, [login])
}

