'use client'

import { useCallback } from 'react'
import { useAuth } from '@/components/providers/auth-provider'

export function useAdminFetch() {
  const { getAuthHeaders } = useAuth()

  return useCallback(
    async (url: string, init?: RequestInit) => {
      const authHeaders = await getAuthHeaders()
      return fetch(url, {
        ...init,
        headers: {
          ...authHeaders,
          ...(init?.headers as Record<string, string>),
        },
      })
    },
    [getAuthHeaders],
  )
}
