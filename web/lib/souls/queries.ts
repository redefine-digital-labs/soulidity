'use client'

import { useQuery } from '@tanstack/react-query'
import type { SoulsListResponse, SoulAssetDetail, MySoulsResponse } from './types'

export function useSoulsList(params: { page?: number; category?: string; q?: string }) {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set('page', String(params.page))
  if (params.category) searchParams.set('category', params.category)
  if (params.q) searchParams.set('q', params.q)

  return useQuery<SoulsListResponse>({
    queryKey: ['souls', params],
    queryFn: async () => {
      const res = await fetch(`/api/souls?${searchParams}`)
      if (!res.ok) throw new Error('Failed to fetch souls')
      return res.json()
    },
  })
}

export function useSoulDetail(id: string, getAuthHeaders?: () => Promise<Record<string, string>>, viewerId?: string | null) {
  return useQuery<SoulAssetDetail>({
    queryKey: ['soul', id, viewerId ?? null],
    queryFn: async () => {
      const headers = getAuthHeaders ? await getAuthHeaders() : undefined
      const res = await fetch(`/api/souls/${encodeURIComponent(id)}`, { headers })
      if (!res.ok) throw new Error('Failed to fetch soul')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useMySouls(userId: string | null, getAuthHeaders: () => Promise<Record<string, string>>) {
  return useQuery<MySoulsResponse>({
    queryKey: ['my-souls', userId],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/souls/my', { headers: authHeaders })
      if (!res.ok) throw new Error('Failed to fetch my souls')
      return res.json()
    },
    enabled: !!userId,
  })
}
