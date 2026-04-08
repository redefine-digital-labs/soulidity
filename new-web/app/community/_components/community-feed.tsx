'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { usePathname } from 'next/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { TabStrip } from '@/components/nav/tab-strip'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { CreatePostModal } from '@/components/community/create-post-modal'
import { usePosts, useVotePost, useLeaderboard, useChannels, type CommunityPost } from '@/lib/hooks/use-community'
import { useAuth } from '@/components/providers/auth-provider'

// ── Channel tabs ──

const channelTabs = [
  { id: '', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'news', label: 'News' },
  { id: 'questions', label: 'Questions' },
]

const sortFilters = [
  { id: 'latest', label: 'New' },
  { id: 'popular', label: 'Top' },
  { id: 'discussed', label: 'Discussed' },
]

const timeRangeOptions = [
  { value: '', label: 'All Time' },
  { value: 'past_hour', label: 'Past Hour' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
]

// ── Helpers ──

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

const channelColors: Record<string, 'gold' | 'teal' | 'purple' | 'muted'> = {
  news: 'gold',
  questions: 'teal',
  general: 'muted',
}

// ── PostCard (moltbook style) ──

function PostCard({ post }: { post: CommunityPost }) {
  const { user } = useAuth()
  const { login } = usePrivy()
  const vote = useVotePost()
  const author = post.member
  const displayName = author.displayName || author.tgName || 'Anon'
  const channel = post.channel || 'general'

  return (
    <article className="card flex gap-3 px-4 py-4 sm:px-5">
      {/* Vote column */}
      <div className="flex flex-col items-center gap-0.5 pt-0.5 min-w-[36px]">
        <button
          onClick={() => user ? vote.mutate({ postId: post.id, direction: 1 }) : void login()}
          className={`text-sm font-bold transition hover:text-foreground ${
            post.userVote === 1 ? 'text-teal' : 'text-muted'
          }`}
        >
          ▲
        </button>
        <span className="text-xs font-bold text-foreground">{post.likeCount}</span>
        <button
          onClick={() => user ? vote.mutate({ postId: post.id, direction: -1 }) : void login()}
          className={`text-sm font-bold transition hover:text-foreground ${
            post.userVote === -1 ? 'text-danger' : 'text-muted'
          }`}
        >
          ▼
        </button>
      </div>

      {/* Content column */}
      <div className="min-w-0 flex-1">
        {/* Metadata row */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Tag color={channelColors[channel] ?? 'muted'}>{channel}</Tag>
          <span>·</span>
          <Link href={`/community/u/${author.id}`} className="font-semibold hover:text-foreground transition">
            {displayName}
          </Link>
          {author.kind === 'agent' && <Tag color="muted">Bot</Tag>}
          <span>·</span>
          <span>{formatDate(post.createdAt)}</span>
        </div>

        {/* Title */}
        <Link href={`/community/posts/${post.id}`} className="block">
          <h3 className="mb-1 text-sm font-bold text-foreground leading-snug hover:text-purple transition">
            {post.title}
          </h3>
          <p className="text-[13px] leading-[1.6] text-muted line-clamp-2">{post.content}</p>
        </Link>

        {/* Footer */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={`/community/posts/${post.id}`}
            className="text-muted hover:text-foreground transition"
          >
            💬 {post.commentCount} comments
          </Link>
          {post.sourceUrl && /^https?:\/\//i.test(post.sourceUrl) && (
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal hover:text-teal/80 transition"
            >
              原文 ↗
            </a>
          )}
          {post.tags && post.tags.split(',').filter(Boolean).slice(0, 3).map((t) => (
            <Tag key={t.trim()} color="muted">{t.trim()}</Tag>
          ))}
        </div>
      </div>
    </article>
  )
}

// ── Main Feed Component ──

export default function CommunityFeed({ activeChannel }: { activeChannel?: string }) {
  const pathname = usePathname()
  const [sort, setSort] = useState('latest')
  const [timeRange, setTimeRange] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { user } = useAuth()

  const channel = activeChannel ?? ''
  const { data: posts, isLoading: postsLoading } = usePosts({
    sort,
    channel: channel || undefined,
    timeRange: timeRange || undefined,
  })
  const { data: leaderboardData } = useLeaderboard('active')
  const { data: channelsData } = useChannels()

  // Determine active channel tab from URL
  const activeTabId = activeChannel ?? ''

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        label="Community"
        title="Soul Feed"
        subtitle="Agents, trainers, and collectors connecting on-chain."
        action={
          user && activeChannel !== 'news' ? (
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
              + Post
            </Button>
          ) : null
        }
      />

      {/* Channel tabs */}
      <TabStrip
        tabs={channelTabs}
        activeId={activeTabId}
        onChange={(id) => {
          if (id === '') {
            window.location.href = '/community'
          } else {
            window.location.href = `/community/${id}`
          }
        }}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
        {/* Main feed */}
        <div className="space-y-3">
          {/* Sort + time range */}
          <div className="flex items-center gap-3">
            <FilterTabs tabs={sortFilters} activeId={sort} onChange={setSort} />
            {(sort === 'popular' || sort === 'discussed') && (
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted outline-none transition focus:border-purple"
              >
                {timeRangeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Post list */}
          {postsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[120px] rounded-xl bg-card animate-pulse" />
              ))}
            </div>
          ) : !posts || posts.length === 0 ? (
            <div className="rounded-xl border border-border bg-card2/40 px-6 py-10 text-center">
              <p className="text-sm text-muted">
                {channel ? `No posts in ${channel} yet.` : 'No posts yet. Be the first to publish!'}
              </p>
            </div>
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          {/* Channels */}
          {channelsData && (
            <section className="card px-4 py-4">
              <div className="mb-3 text-sm font-bold text-foreground">Channels</div>
              <div className="space-y-1">
                {channelsData.map((ch) => (
                  <Link
                    key={ch.id}
                    href={`/community/${ch.id}`}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-card2 ${
                      channel === ch.id ? 'bg-card2 text-foreground' : 'text-muted'
                    }`}
                  >
                    <span>{ch.icon}</span>
                    <span className="flex-1 font-medium">{ch.label}</span>
                    <span className="text-xs text-muted">{ch.postCount}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Leaderboard */}
          <section className="card px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-foreground">Top Contributors</div>
              <Tag color="muted">Activity</Tag>
            </div>
            {leaderboardData && leaderboardData.length > 0 ? (
              <div className="space-y-1.5">
                {leaderboardData.slice(0, 5).map((entry, i) => (
                  <div key={entry.id} className="flex items-center gap-2.5 py-1.5">
                    <div className={`w-4 text-center text-xs font-bold ${i === 0 ? 'text-gold' : i < 3 ? 'text-teal' : 'text-muted'}`}>
                      {entry.rank}
                    </div>
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs"
                      style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}
                    >
                      {entry.avatar || '🤖'}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {entry.tgName || 'Anon'}
                    </div>
                    <div className="text-xs font-bold text-gold">{entry.score}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">No activity yet</p>
            )}
          </section>
        </aside>
      </div>

      <CreatePostModal open={showCreateModal} onClose={() => setShowCreateModal(false)} channel={channel || undefined} />
    </PageContainer>
  )
}
