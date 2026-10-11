'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLogin } from '@/lib/hooks/use-login'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { TabStrip } from '@/components/nav/tab-strip'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { CreatePostModal } from '@/components/community/create-post-modal'
import { VoteControls } from '@/components/community/vote-controls'
import { useCommunityFeed } from '@/lib/hooks/use-community-feed'
import { useAuth } from '@/components/providers/auth-provider'

const channelTabs = [
  { id: '', label: 'All' }, { id: 'general', label: 'General' },
  { id: 'news', label: 'News' }, { id: 'questions', label: 'Questions' },
]
const sortFilters = [
  { id: 'latest', label: 'New' }, { id: 'popular', label: 'Top' }, { id: 'discussed', label: 'Discussed' },
]
const timeRangeOptions = [
  { value: '', label: 'All Time' }, { value: 'past_hour', label: 'Past Hour' },
  { value: 'today', label: 'Today' }, { value: 'this_week', label: 'This Week' }, { value: 'this_month', label: 'This Month' },
]
type ChainFeedRow = ReturnType<typeof useCommunityFeed>['items'][number]
type FeedSort = 'latest' | 'popular' | 'discussed'
type FeedTimeRange = '' | 'past_hour' | 'today' | 'this_week' | 'this_month'

function formatDate(milliseconds: string) {
  const value = BigInt(milliseconds)
  if (value > 8640000000000000n) return milliseconds + ' ms since epoch'
  const date = new Date(Number(value)), diff = Date.now() - date.getTime()
  if (diff >= 0 && diff < 60_000) return 'just now'
  if (diff >= 0 && diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago'
  if (diff >= 0 && diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago'
  if (diff >= 0 && diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + 'd ago'
  return date.toLocaleDateString()
}

function PostCard({ row }: { row: ChainFeedRow }) {
  const { post, document, authorMetadata } = row, author = post.author
  return <article className="card flex gap-3 px-4 py-4 sm:px-5">
    <div className="min-w-[36px] pt-0.5"><VoteControls postId={post.id} /></div>
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Tag color={post.channel === 'questions' ? 'teal' : 'muted'}>{post.channel}</Tag>
        <span>·</span><span>Profile</span><span>·</span>
        <span aria-hidden="true">{authorMetadata.avatar || '🤖'}</span>
        <Link href={'/community/u/' + author.id} className="font-semibold hover:text-foreground">
          {authorMetadata.displayName || author.handle || 'Anon'}
        </Link>
        <span>·</span><span>{formatDate(post.createdAtMs)}</span>
      </div>
      <Link href={'/community/posts/' + post.id} className="block">
        <h3 className="mb-1 text-sm font-bold leading-snug text-foreground hover:text-action-label">{document.title}</h3>
        <p className="line-clamp-2 whitespace-pre-wrap text-[13px] leading-[1.6] text-muted">{document.content}</p>
      </Link>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
        <Link href={'/community/posts/' + post.id} className="text-muted hover:text-foreground">💬 {post.commentCount} comments</Link>
        {document.tags.slice(0, 3).map(tag => <Tag key={tag} color="muted">{tag}</Tag>)}
      </div>
    </div>
  </article>
}

function ChainFeed({ channel, showCreateModal, closeCreateModal, feed, sort, setSort, timeRange, setTimeRange }: {
  channel: '' | 'general' | 'questions'; showCreateModal: boolean; closeCreateModal: () => void
  feed: ReturnType<typeof useCommunityFeed>; sort: FeedSort; setSort: (value: FeedSort) => void
  timeRange: FeedTimeRange; setTimeRange: (value: FeedTimeRange) => void
}) {
  const run = (work: () => Promise<void>) => { void work().catch(() => { /* Hook retains the read error. */ }) }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <FilterTabs tabs={sortFilters} activeId={sort} onChange={value => {
        if (value === 'latest' || value === 'popular' || value === 'discussed') setSort(value)
      }} />
      {(sort === 'popular' || sort === 'discussed') && <select aria-label="Post time range" value={timeRange}
        onChange={event => setTimeRange(event.target.value as typeof timeRange)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted">
        {timeRangeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>}
      <button disabled={feed.busy || feed.loading} onClick={() => run(feed.refresh)} className="text-xs text-action-label">Refresh posts</button>
    </div>
    <div role="status" aria-label="Feed coverage" className="text-xs text-muted">
      <p>Scanned {feed.scanned} of {feed.observedCount} posts. Showing up to 30 matching posts.</p>
      <p>Post counts and scores are read at different times. Refresh to update this view.</p>
      {feed.status === 'COMPLETE_WINDOW'
        ? <p>The captured post window has been fully scanned.</p>
        : <p>Partial feed: ranking covers only scanned posts, not the global feed.</p>}
      {feed.status === 'LIMIT_REACHED' && <p>The scan limit was reached. Results are incomplete.</p>}
      {feed.hasNewerEntries && <p>Newer posts are available. Refresh to start a new window.</p>}
    </div>
    {feed.error && <div role="alert" className="text-sm text-danger">Unable to read all requested posts: {feed.error}</div>}
    {feed.loading && <p role="status">Loading community posts…</p>}
    {feed.items.slice(0, 30).map(row => <PostCard key={row.post.id} row={row} />)}
    {!feed.loading && !feed.error && feed.items.length === 0 && <p className="rounded-xl border border-border bg-card2/40 px-6 py-10 text-center text-sm text-muted">
      {feed.status === 'COMPLETE_WINDOW' ? 'No matching posts in this captured window.' : 'No matching posts in the scanned range. More posts may be available.'}
    </p>}
    {feed.status === 'PARTIAL' && <button disabled={feed.busy || feed.loading} onClick={() => run(feed.loadMore)} className="text-sm text-action-label">
      {feed.busy ? 'Reading more posts…' : 'Scan more posts'}
    </button>}
    <CreatePostModal open={showCreateModal} onClose={closeCreateModal} channel={channel || undefined}
      onPublished={() => run(feed.refresh)} />
  </div>
}

export default function CommunityFeed({ activeChannel }: { activeChannel?: string }) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [sort, setSort] = useState<FeedSort>('latest')
  const [timeRange, setTimeRange] = useState<FeedTimeRange>('')
  const { walletAddress } = useAuth(), login = useLogin()
  const channel = activeChannel ?? '', deferred = channel === 'news'
  const enabled = channel === '' || channel === 'general' || channel === 'questions'
  const feed = useCommunityFeed({ sort, channel: enabled && channel ? channel : undefined, timeRange: timeRange || undefined }, enabled)
  const channelCounts = enabled ? feed.channels : null
  const coverage = feed.status === 'COMPLETE_WINDOW' ? 'in captured window' : 'in scanned range'
  return <PageContainer className="space-y-6">
    <SectionHeader label="Community" title="Soul Feed" subtitle="Public community posts from registered profiles."
      action={!deferred ? <Button variant="primary" size="sm" onClick={() => walletAddress ? setShowCreateModal(true) : login()}>+ Post</Button> : null} />
    <TabStrip tabs={channelTabs} activeId={channel} onChange={value => { window.location.href = value ? '/community/' + value : '/community' }} />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
      {deferred ? <p role="status">News is deferred and is not available in this release.</p>
        : channel === '' || channel === 'general' || channel === 'questions'
          ? <ChainFeed channel={channel} showCreateModal={showCreateModal} closeCreateModal={() => setShowCreateModal(false)}
              feed={feed} sort={sort} setSort={setSort} timeRange={timeRange} setTimeRange={setTimeRange} />
          : <p role="alert">Unknown community channel.</p>}
      <aside className="space-y-4" aria-label="Community sidebar">
        <section className="card px-4 py-4" aria-label="Channel counts">
          <h2 className="mb-3 text-sm font-bold">Channels</h2>
          <p className="mb-2 text-xs text-muted">{channelCounts ? 'Verified channel counts ' + coverage + ', before feed filters.' : enabled && feed.loading ? 'Loading channel counts…' : 'Channel counts unavailable.'}</p>
          {feed.error && enabled && <p role="alert" className="text-xs text-muted">Channel scan could not advance. {channelCounts ? 'Counts retain the verified scanned range.' : 'Counts are unavailable.'}</p>}
          {([{ id: 'general', label: 'General', icon: '💬' }, { id: 'news', label: 'News', icon: '📰' }, { id: 'questions', label: 'Questions', icon: '❓' }] as const).map(item => <Link key={item.id} href={'/community/' + item.id}
            className={'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-card2 ' + (channel === item.id ? 'bg-card2 text-foreground' : 'text-muted')}>
            <span>{item.icon}</span><span className="flex-1 font-medium">{item.label}</span><span className="text-xs" aria-label={item.label + ' count'}>
              {item.id === 'news' ? 'Deferred' : channelCounts?.[item.id] ?? (enabled && feed.loading ? 'Loading…' : 'Unavailable')}
            </span>
          </Link>)}
        </section>
        <section className="card px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-bold">Top Contributors</h2>
            <Link href="/community/leaderboard" className="text-[11px] text-action-label">View all →</Link></div>
          <p role="status" className="text-xs text-muted">Contributor rankings are temporarily unavailable. Verified rankings are deferred; this does not mean there are no contributions.</p>
        </section>
      </aside>
    </div>
  </PageContainer>
}
