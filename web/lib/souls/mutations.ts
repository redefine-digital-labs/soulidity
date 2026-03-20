'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@web/components/auth-provider'

export function useSetAgentGrant(passId: string) {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async (agentAddress: string) => {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/souls/passes/${passId}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ agentAddress }),
      })
      if (!res.ok) throw new Error('Failed to set grant')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-souls'] })
    },
  })
}

export function useRevokeAgentGrant(passId: string) {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/souls/passes/${passId}/grant`, {
        method: 'DELETE',
        headers: headers,
      })
      if (!res.ok) throw new Error('Failed to revoke grant')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-souls'] })
    },
  })
}
