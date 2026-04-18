'use client'

import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { clearPendingAction } from '@/lib/utils/pending-action'

/**
 * Privy login wrapper for generic sign-in entrypoints not tied to a specific
 * gated action. Clears any stale pending-action entry before opening Privy so
 * a previously cancelled gated flow does not hijack this unrelated sign-in.
 *
 * Use `useRequireAuth` for gated actions that should resume after login.
 */
export function useGenericLogin(): () => void {
  const { login } = usePrivy()
  return useCallback(() => {
    clearPendingAction()
    login()
  }, [login])
}
