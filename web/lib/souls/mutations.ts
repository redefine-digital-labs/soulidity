'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@web/components/auth-provider'

export function useSetAgentGrant(soulId: string) {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async (params: { agentAddress: string; soulAccessCapOnChainId: string; txDigest: string }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/souls/${soulId}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('Failed to set grant')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      queryClient.invalidateQueries({ queryKey: ['soul', soulId] })
    },
  })
}

export function useRevokeAgentGrant(soulId: string) {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async (params: { txDigest: string }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/souls/${soulId}/grant`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('Failed to revoke grant')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      queryClient.invalidateQueries({ queryKey: ['soul', soulId] })
    },
  })
}
