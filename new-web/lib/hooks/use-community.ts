'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/components/providers/auth-provider'

// ── Types ──

export interface PostAuthor {
  id: string
  tgName: string | null
  displayName: string | null
  kind: string
  avatar: string | null
  level: number
}

export interface PostComment {
  id: string
  content: string
  isAccepted: boolean
  createdAt: string
  member: PostAuthor
}

export interface CommunityPost {
  id: string
  title: string
  content: string
  tags: string[]
  type: string
  channel: string
  sourceUrl: string | null
  likeCount: number
  commentCount: number
  createdAt: string
  member: PostAuthor
  userVote: 1 | -1 | null
  comments?: PostComment[]
}

export interface LeaderboardEntry {
  rank: number
  id: string
  tgName: string | null
  avatar: string | null
  level: number
  score: number
  postCount?: number
  commentCount?: number
  acceptedCount?: number
}

// ── Query hooks ──

export function usePosts(params: { sort?: string; type?: string; tag?: string; channel?: string; timeRange?: string } = {}) {
  const { getAuthHeaders } = useAuth()

  return useQuery<CommunityPost[]>({
    queryKey: ['community-posts', params],
    queryFn: async () => {
      const sp = new URLSearchParams()
      if (params.sort) sp.set('sort', params.sort)
      if (params.type) sp.set('type', params.type)
      if (params.tag) sp.set('tag', params.tag)
      if (params.channel) sp.set('channel', params.channel)
      if (params.timeRange) sp.set('timeRange', params.timeRange)
      const headers = await getAuthHeaders().catch(() => ({}))
      const res = await fetch(`/api/community/posts?${sp}`, { cache: 'no-store', headers })
      if (!res.ok) throw new Error('Failed to fetch posts')
      return res.json()
    },
  })
}

export interface ChannelInfo {
  id: string
  label: string
  icon: string
  description: string
  postCount: number
}

export function useChannels() {
  return useQuery<ChannelInfo[]>({
    queryKey: ['community-channels'],
    queryFn: async () => {
      const res = await fetch('/api/community/channels', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch channels')
      return res.json()
    },
  })
}

export function usePostDetail(id: string) {
  const { getAuthHeaders } = useAuth()

  return useQuery<CommunityPost>({
    queryKey: ['community-post', id],
    queryFn: async () => {
      const headers = await getAuthHeaders().catch(() => ({}))
      const res = await fetch(`/api/community/posts/${encodeURIComponent(id)}`, { cache: 'no-store', headers })
      if (!res.ok) throw new Error('Failed to fetch post')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useLeaderboard(dimension: 'active' | 'helpful' = 'active') {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ['community-leaderboard', dimension],
    queryFn: async () => {
      const res = await fetch(`/api/community/leaderboard?dimension=${dimension}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch leaderboard')
      return res.json()
    },
  })
}

export function useTags() {
  return useQuery<string[]>({
    queryKey: ['community-tags'],
    queryFn: async () => {
      const res = await fetch('/api/community/tags', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch tags')
      return res.json()
    },
  })
}

// ── Mutation hooks ──

export function useCreatePost() {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (payload: { title: string; content: string; type?: string; tags?: string[]; channel?: string }) => {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create post')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-posts'] })
      setError(null)
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  return { ...mutation, error }
}

export function useCreateComment() {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async ({ postId, content }: { postId: string; content: string }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create comment')
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['community-post', variables.postId] })
      queryClient.invalidateQueries({ queryKey: ['community-posts'] })
    },
  })
}

export function useVotePost() {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async ({ postId, direction }: { postId: string; direction: 1 | -1 }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/vote`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to vote')
      }
      return res.json() as Promise<{ likeCount: number; userVote: 1 | -1 | null }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['community-post', variables.postId] })
      queryClient.invalidateQueries({ queryKey: ['community-posts'] })
    },
  })
}

export function useAcceptComment() {
  const queryClient = useQueryClient()
  const { getAuthHeaders } = useAuth()

  return useMutation({
    mutationFn: async ({ postId, commentId }: { postId: string; commentId: string }) => {
      const headers = await getAuthHeaders()
      const res = await fetch(
        `/api/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/accept`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to accept comment')
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['community-post', variables.postId] })
    },
  })
}
