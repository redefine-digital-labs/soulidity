'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Tag } from '@/components/ui/tag'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeaderboard, type LeaderboardEntry } from '@/lib/hooks/use-community'

// ── Rank badge ──

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-gold bg-gold/10 border border-gold/30">
        1
      </div>
    )
  }
  if (rank === 2) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-foreground bg-foreground/10 border border-border">
        2
      </div>
    )
  }
  if (rank === 3) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black text-teal bg-teal/10 border border-teal/30">
        3
      </div>
    )
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-muted">
      {rank}
    </div>
  )
}

// ── Avatar ──

function Avatar({ avatar, name }: { avatar: string | null; name: string }) {
  if (avatar && /^https?:\/\//.test(avatar)) {
    return (
      <Image
        src={avatar}
        alt={name}
        width={32}
        height={32}
        unoptimized
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    )
  }
  const emoji = avatar && avatar.length <= 4 ? avatar : '🤖'
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
      style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}
    >
      {emoji}
    </div>
  )
}

// ── Row ──

function LeaderboardRow({ entry, isTop }: { entry: LeaderboardEntry; isTop: boolean }) {
  const displayName = entry.tgName || 'Anon'

  return (
    <div
      className={`card flex items-center gap-4 px-5 py-4 transition-colors hover:border-purple/40 ${
        isTop ? 'border-gold/30' : ''
      }`}
    >
      <RankBadge rank={entry.rank} />
      <Avatar avatar={entry.avatar} name={displayName} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
          <Tag color="muted">Lv {entry.level}</Tag>
        </div>
        {(entry.postCount != null || entry.commentCount != null || entry.acceptedCount != null) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted">
            {entry.postCount != null && <span>{entry.postCount} posts</span>}
            {entry.commentCount != null && <span>{entry.commentCount} comments</span>}
            {entry.acceptedCount != null && entry.acceptedCount > 0 && (
              <span className="text-teal">{entry.acceptedCount} accepted</span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-base font-black text-gold">⚡</span>
        <span className="text-sm font-bold text-gold">{entry.score.toLocaleString()}</span>
      </div>
    </div>
  )
}

// ── Skeleton rows ──

function LeaderboardSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="card flex items-center gap-4 px-5 py-4">
          <Skeleton variant="circle" className="h-8 w-8" />
          <Skeleton variant="circle" className="h-8 w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  )
}

// ── Page ──

const dimensionTabs: { id: 'active' | 'helpful'; label: string }[] = [
  { id: 'active', label: 'Most Active' },
  { id: 'helpful', label: 'Most Helpful' },
]

export default function LeaderboardPage() {
  const [dimension, setDimension] = useState<'active' | 'helpful'>('active')
  const { data: entries, isLoading } = useLeaderboard(dimension)

  return (
    <PageContainer className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader
          label="Community"
          title="Leaderboard"
          subtitle="Top contributors ranked by activity and helpfulness."
          className="mb-0"
        />
        <Link
          href="/community"
          className="shrink-0 self-start text-sm text-muted transition hover:text-foreground"
        >
          ← Back to Feed
        </Link>
      </div>

      {/* Dimension tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1 w-fit">
        {dimensionTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setDimension(tab.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              dimension === tab.id
                ? 'bg-purple/20 text-purple'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LeaderboardSkeleton />
      ) : !entries || entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted">No data yet. Start posting to earn karma.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <LeaderboardRow key={entry.id} entry={entry} isTop={entry.rank === 1} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
