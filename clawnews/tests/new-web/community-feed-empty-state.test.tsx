// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

type MockPost = {
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
  member: {
    id: string
    tgName: string | null
    displayName: string | null
    kind: string
    avatar: string | null
    level: number
  }
  userVote: 1 | -1 | null
}

const postsState = vi.hoisted(() => ({
  result: {
    data: undefined as MockPost[] | undefined,
    isLoading: true,
    isError: false,
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/community',
}))

vi.mock('@/components/providers/auth-provider', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    authenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    getAuthHeaders: vi.fn(async () => ({})),
  }),
}))

vi.mock('@/lib/hooks/use-login', () => ({
  useLogin: () => vi.fn(),
}))

vi.mock('@/lib/hooks/use-community', () => ({
  usePosts: () => postsState.result,
  useVotePost: () => ({ mutate: vi.fn() }),
  useLeaderboard: () => ({ data: [] }),
  useChannels: () => ({ data: [] }),
  useCreatePost: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}))

function flushPromises() {
  return Promise.resolve()
}

describe('CommunityFeed empty state', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    postsState.result = {
      data: undefined,
      isLoading: true,
      isError: false,
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('keeps the planned main-column empty copy visible while the initial posts request is pending', async () => {
    const CommunityFeed = (await import('../../web/app/community/_components/community-feed')).default

    await act(async () => {
      root.render(<CommunityFeed />)
      await flushPromises()
    })

    expect(container.textContent).toContain('No posts yet. Be the first to publish!')
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders posts instead of the empty state when the feed has articles', async () => {
    postsState.result = {
      data: [{
        id: 'post-1',
        title: 'First community post',
        content: 'A published community post.',
        tags: ['alpha'],
        type: 'news',
        channel: 'news',
        sourceUrl: null,
        likeCount: 0,
        commentCount: 0,
        createdAt: '2026-04-27T00:00:00.000Z',
        member: {
          id: 'member-1',
          tgName: null,
          displayName: 'ClawNews Bot',
          kind: 'agent',
          avatar: 'N',
          level: 1,
        },
        userVote: null,
      }],
      isLoading: false,
      isError: false,
    }

    const CommunityFeed = (await import('../../web/app/community/_components/community-feed')).default

    await act(async () => {
      root.render(<CommunityFeed />)
      await flushPromises()
    })

    expect(container.querySelectorAll('article')).toHaveLength(1)
    expect(container.textContent).toContain('First community post')
    expect(container.textContent).not.toContain('No posts yet. Be the first to publish!')
  })
})
