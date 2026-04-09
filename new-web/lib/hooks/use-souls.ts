'use client'

import { useQuery } from '@tanstack/react-query'
import type { MySoulsResponse, SoulAssetDetail, SoulsListResponse } from '@/lib/soulidity/types'

export type SoulsSortOption = 'newest' | 'price_asc' | 'price_desc' | 'popular'

export interface SoulsListParams {
  page?: number
  category?: string
  q?: string
  sort?: SoulsSortOption
  minPrice?: string
  maxPrice?: string
  creator?: string
}

export function useSoulsList(params: SoulsListParams) {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set('page', String(params.page))
  if (params.category) searchParams.set('category', params.category)
  if (params.q) searchParams.set('q', params.q)
  if (params.sort && params.sort !== 'newest') searchParams.set('sort', params.sort)
  if (params.minPrice) searchParams.set('minPrice', params.minPrice)
  if (params.maxPrice) searchParams.set('maxPrice', params.maxPrice)
  if (params.creator) searchParams.set('creator', params.creator)

  return useQuery<SoulsListResponse>({
    queryKey: ['souls', params],
    queryFn: async () => {
      const res = await fetch(`/api/souls?${searchParams}`, { cache: 'no-store' })
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
      const res = await fetch(`/api/souls/${encodeURIComponent(id)}`, { cache: 'no-store', headers })
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
      const res = await fetch('/api/souls/my', { cache: 'no-store', headers: authHeaders })
      if (!res.ok) throw new Error('Failed to fetch my souls')
      return res.json()
    },
    enabled: !!userId,
  })
}
