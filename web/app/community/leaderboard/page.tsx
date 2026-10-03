'use client'

import Link from 'next/link'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'

// Keep the original entry and dimensions, without treating deferred chain
// aggregation as an empty ranking or querying the retired business backend.
export default function LeaderboardPage() {
  return <PageContainer className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <SectionHeader label="Community" title="Leaderboard"
        subtitle="Activity and helpfulness rankings are deferred." className="mb-0" />
      <Link href="/community" className="shrink-0 self-start text-sm text-muted transition hover:text-foreground">
        ← Back to Feed
      </Link>
    </div>
    <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
      {['Most Active', 'Most Helpful'].map(label => <button key={label} disabled
        aria-describedby="rankings-status" className="rounded-lg px-4 py-1.5 text-sm font-semibold text-muted opacity-60">
        {label}
      </button>)}
    </div>
    <div id="rankings-status" role="status" className="rounded-xl border border-border bg-card px-6 py-12 text-center">
      <p className="text-sm text-muted">Contributor rankings are temporarily unavailable.</p>
      <p className="mt-2 text-sm text-muted">Verified rankings are deferred; this does not mean there are no contributions. Posts and comments remain available in the feed.</p>
    </div>
  </PageContainer>
}
