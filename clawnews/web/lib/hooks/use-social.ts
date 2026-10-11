'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/components/providers/auth-provider'
import type { SoulAssetSummary } from '@soulidity/sdk'

// ── Types ──

export interface FollowStatus {
  isFollowing: boolean
  followerCount: number
  followingCount: number
}

export interface BookmarksResponse {
  bookmarks: SoulAssetSummary[]
}

// ── Follow hooks ──

export function useFollowStatus(memberId: string | null) {
  const { user, getAuthHeaders } = useAuth()

  return useQuery<FollowStatus>({
    queryKey: ['follow-status', memberId, user?.id ?? null],
    queryFn: async () => {
      const headers = await getAuthHeaders().catch(() => ({}))
      const res = await fetch(`/api/community/follow?memberId=${encodeURIComponent(memberId!)}`, {
        cache: 'no-store',
        headers,
      })
      if (!res.ok) throw new Error('Failed to fetch follow status')
      return res.json()
    },
    enabled: !!memberId,
  })
}

export function useToggleFollow() {
  const queryClient = useQueryClient()
  const { user, getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async (targetMemberId: string) => {
      if (!user) throw new Error('请先登录')
      const headers = await getAuthHeaders()
      const res = await fetch('/api/community/follow', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetMemberId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to toggle follow')
      }
      return res.json() as Promise<{ following: boolean; followerCount: number }>
    },
    onSuccess: (data, targetMemberId) => {
      const followStatusKey = ['follow-status', targetMemberId, user?.id ?? null] as const
      // Immediately patch the cached follower count with the value returned by POST,
      // so the count updates in sync with the button — no extra round-trip visible.
      queryClient.setQueryData<FollowStatus>(followStatusKey, (old) =>
        old
          ? { ...old, isFollowing: data.following, followerCount: data.followerCount }
          : undefined
      )
      // Then invalidate to get a fully-consistent refetch (also updates followingCount).
      queryClient.invalidateQueries({ queryKey: followStatusKey })
    },
  })
}

// ── Bookmark hooks ──

export function useBookmarkStatus(soulId: string | null) {
  const { data, isLoading } = useBookmarks()
  const bookmarked = data?.bookmarks.some((s) => s.id === soulId) ?? false
  return { data: { bookmarked }, isLoading }
}

export function useToggleBookmark() {
  const queryClient = useQueryClient()
  const { user, getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async (soulId: string) => {
      if (!user) throw new Error('请先登录')
      const headers = await getAuthHeaders()
      const res = await fetch('/api/souls/bookmark', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ soulId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to toggle bookmark')
      }
      return res.json() as Promise<{ bookmarked: boolean }>
    },
    onSuccess: (_data, _soulId) => {
      // Refetch immediately so the new bookmark count is visible on any mounted page.
      // invalidateQueries alone is not sufficient when the query is considered fresh
      // (staleTime 30s) at mount time on a page navigated to right after toggling.
      queryClient.refetchQueries({ queryKey: ['bookmarks'] })
    },
  })
}

export function useBookmarks() {
  const { user, getAuthHeaders } = useAuth()

  return useQuery<BookmarksResponse>({
    queryKey: ['bookmarks', user?.id ?? null],
    queryFn: async () => {
      const headers = await getAuthHeaders().catch(() => ({}))
      const res = await fetch('/api/souls/bookmark', { cache: 'no-store', headers })
      if (!res.ok) return { bookmarks: [] }
      return res.json()
    },
    enabled: !!user,
    staleTime: 0,
  })
}
