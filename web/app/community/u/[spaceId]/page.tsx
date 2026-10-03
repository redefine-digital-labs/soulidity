'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useFollowStatus } from '@/lib/hooks/use-social'
import { FollowButton } from '@/components/community/follow-button'
import { ChainSoulCover } from '@/components/souls/chain-soul-cover'
import { usePublicCommunityProfile, useCommunityProfilePosts, useCommunityAuthoredSouls } from '@/lib/hooks/use-public-community-profile'

type Tab = 'Souls' | 'Posts' | 'About'
const address = (value: string) => value.slice(0, 6) + '…' + value.slice(-4)
function date(milliseconds: string, month = false) {
  const value = BigInt(milliseconds)
  if (value > 8640000000000000n) return milliseconds + ' ms since epoch'
  return new Date(Number(value)).toLocaleDateString('en-US', month ? { month: 'short', year: 'numeric' } : undefined)
}
function hero(image: string | null | undefined) {
  return image ? { backgroundImage: 'linear-gradient(135deg, rgba(46,27,110,0.48), rgba(15,95,115,0.55)), url(' + JSON.stringify(image) + ')', backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: 'radial-gradient(circle at 22% 30%, rgba(168,85,247,0.35), transparent 55%), radial-gradient(circle at 82% 70%, rgba(20,184,166,0.22), transparent 60%), linear-gradient(135deg, #1A1040, #0D0A1E)' }
}

export default function SpaceProfilePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params), { walletAddress } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('Souls')
  const [shareState, setShareState] = useState<{ spaceId: string; message: string } | null>(null)
  const identity = usePublicCommunityProfile(spaceId), data = identity.data
  const profile = data?.profile, metadata = data?.metadata
  const targetId = profile?.id ?? (/^0x[0-9a-f]{64}$/.test(spaceId) && !/^0x0+$/.test(spaceId) ? spaceId : null)
  const posts = useCommunityProfilePosts(profile?.id ?? null)
  const souls = useCommunityAuthoredSouls(profile ?? null)
  const follows = useFollowStatus(targetId)
  const isOwner = !!profile && walletAddress === profile.owner
  const displayName = metadata?.displayName || (profile?.handle ? '@' + profile.handle : 'Profile')
  const authored = profile ? souls.items.filter(soul => soul.creatorAddress === profile.owner)
    .sort((a, b) => BigInt(a.createdAtMs) > BigInt(b.createdAtMs) ? -1 : BigInt(a.createdAtMs) < BigInt(b.createdAtMs) ? 1 : a.onChainId.localeCompare(b.onChainId)).slice(0, 12) : []
  const visiblePosts = posts.items.slice(0, 10)
  const run = (work: () => Promise<unknown>) => { void work().catch(() => { /* Source hook retains read errors. */ }) }
  async function share() {
    const url = window.location.href
    try { await navigator.clipboard.writeText(url); setShareState({ spaceId, message: 'Profile link copied.' }) }
    catch { setShareState({ spaceId, message: 'Unable to copy the link. Copy this page address from your browser.' }) }
  }
  return <div className="relative z-10 min-h-screen pb-12">
    <div className="mx-auto max-w-[800px]">
      <div className="relative">
        <div className="group relative h-[120px] overflow-hidden sm:h-[160px]" style={hero(metadata?.coverImageUrl)}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_40%)]" />
          <Link href="/community" className="absolute left-5 top-3.5 text-xs text-muted hover:text-foreground">← Community</Link>
          {profile && <div className="absolute left-5 top-9 font-mono text-[10.5px] uppercase tracking-[0.15em] text-muted sm:left-auto sm:right-5 sm:top-3.5">
            Profile · JOINED {date(profile.createdAtMs, true).toUpperCase()}
          </div>}
          {isOwner && <Link href="/profile#cover" className="absolute bottom-3.5 right-5 rounded-md border border-border bg-card/80 px-2.5 py-1 text-[11px] font-semibold hover:border-purple">✎ Change cover</Link>}
        </div>
        <div className="absolute bottom-0 left-7 z-10 flex h-[84px] w-[84px] translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-[3px] text-[28px] font-extrabold"
          style={{ background: 'linear-gradient(135deg, var(--card), var(--card2))', borderColor: 'var(--bg)' }}>
          {metadata?.avatar || (data ? displayName.slice(0, 1).toUpperCase() : '…')}
        </div>
      </div>
      <div className="px-7 pt-14 sm:pl-[128px] sm:pr-7 sm:pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[22px] font-extrabold">{data ? displayName : identity.isLoading ? 'Loading public profile…' : 'Public profile unavailable'}</h1>
              {profile?.handle && <Tag color="muted">@{profile.handle}</Tag>}
            </div>
            {isOwner && <div className="mt-1.5 font-mono text-[11px] text-muted">Wallet · {address(profile!.owner)}</div>}
          </div>
          {/* Stable slot: failed metadata/count reads must not discard follow recovery. */}
          <div className="flex shrink-0 flex-wrap gap-2">
            {targetId && <FollowButton targetMemberId={targetId} />}
            {isOwner && <Link href="/profile#profile"><Button variant="outline" size="sm">✎ Edit profile</Button></Link>}
            {data && <Button variant="outline" size="sm" onClick={() => { void share() }}>Share</Button>}
          </div>
        </div>
      </div>
      <div className="px-7 pt-3">
        {identity.error && <div role="alert" className="mb-3 text-sm text-danger">Unable to read this public profile: {identity.error.message}
          <Button variant="ghost" size="sm" disabled={identity.isFetching} onClick={() => run(identity.refetch)}>Retry profile read</Button>
        </div>}
        {!data && !identity.isLoading && !identity.error && <p role="alert">Public profile data is unavailable.</p>}
        {shareState?.spaceId === spaceId && <p role="status" className="text-xs text-muted">{shareState.message}</p>}
        {data && profile && metadata && <>
          <p className="mb-4 max-w-[560px] text-[13.5px] leading-relaxed text-muted">{metadata.bio || (isOwner
            ? <>No bio yet. <Link href="/profile" className="text-action-label hover:underline">Add one →</Link></> : 'No bio yet.')}</p>
          <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-border p-3 text-xs">
            <span>Followers: {!follows.error && follows.data ? follows.data.followerCount : follows.isLoading ? 'Loading…' : 'Unavailable'}</span>
            <span>Following: {!follows.error && follows.data ? follows.data.followingCount : follows.isLoading ? 'Loading…' : 'Unavailable'}</span>
            <span>Souls shown: {authored.length}</span><span>Posts shown: {visiblePosts.length}</span>
          </div>
          {follows.error && <div role="alert" className="mb-3 text-xs text-danger">Follow counts unavailable: {follows.error.message}
            <Button variant="ghost" size="sm" disabled={follows.isFetching} onClick={() => run(follows.refetch)}>Retry follow counts</Button>
          </div>}
          <p className="mb-4 text-xs text-muted">Profile type, level, EXP and achievements are not yet available from verified public sources.</p>
          <div className="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="Profile sections">
            {(['Souls', 'Posts', 'About'] as const).map(tab => <button key={tab} role="tab" aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)} className={'px-4 py-2.5 text-[13.5px] ' + (activeTab === tab ? 'border-b-[3px] border-purple font-bold text-foreground' : 'text-muted hover:text-foreground')}>{tab}</button>)}
          </div>
          {activeTab === 'Souls' && <section aria-label="Authored Souls" className="space-y-3 pb-12">
            <p className="text-xs text-muted">Showing up to 12 newest authored Souls found in this scan, not a total inventory count.</p>
            {souls.status !== 'COMPLETE' && <p role="status" className="text-xs text-muted">Partial discovery: more authored Souls may exist outside the scanned range.</p>}
            {souls.status === 'LIMIT_REACHED' && <p role="status">The discovery limit was reached.</p>}
            {souls.loading && <p role="status">Loading authored Souls…</p>}
            {souls.error && <p role="alert">Unable to read authored Souls: {souls.error}</p>}
            <button disabled={souls.busy || souls.loading} onClick={() => run(souls.refresh)}>Retry / refresh Souls</button>
            {souls.status === 'PARTIAL' && <button disabled={souls.busy || souls.loading} onClick={() => run(souls.loadMore)}>Find more authored Souls</button>}
            {!souls.loading && !souls.error && authored.length === 0 && <p>{souls.status === 'COMPLETE' ? 'No authored Souls found in this completed scan.' : 'No authored Souls found in the scanned range yet.'}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {authored.map(soul => <Link key={soul.onChainId} href={'/souls/' + soul.onChainId} className="block overflow-hidden rounded-xl border border-border bg-card transition hover:border-purple">
                <ChainSoulCover soulId={soul.onChainId} className="aspect-[4/5]"><div className="absolute bottom-3 left-3"><Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'}>{soul.listingStatus}</Tag></div></ChainSoulCover>
                <div className="p-3"><div className="mb-1 truncate text-sm font-bold">{soul.name}</div>
                  <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-muted">{soul.description}</p>
                  <div className="flex items-center justify-between"><Tag color="muted">{soul.tags[0] ?? 'Soul'}</Tag>
                    <span className="text-xs font-bold text-gold">{soul.listedPriceAtomic !== null ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Unlisted'}</span></div>
                </div>
              </Link>)}
            </div>
          </section>}
          {activeTab === 'Posts' && <section aria-label="Profile posts" className="space-y-3 pb-12">
            <p className="text-xs text-muted">Showing up to 10 newest posts found in this scan. Scanned {posts.scanned} of {posts.observedCount} public posts.</p>
            {posts.status !== 'COMPLETE_WINDOW' && <p role="status" className="text-xs text-muted">Partial discovery: these are the newest posts within the scanned range, not a complete profile history.</p>}
            {posts.status === 'LIMIT_REACHED' && <p role="status">The post scan limit was reached.</p>}
            {posts.hasNewerEntries && <p role="status">Newer posts are available. Refresh to start a new window.</p>}
            {posts.loading && <p role="status">Loading profile posts…</p>}
            {posts.error && <p role="alert">Unable to read profile posts: {posts.error}</p>}
            <button disabled={posts.busy || posts.loading} onClick={() => run(posts.refresh)}>Retry / refresh posts</button>
            {posts.status === 'PARTIAL' && <button disabled={posts.busy || posts.loading} onClick={() => run(posts.loadMore)}>Scan more profile posts</button>}
            {!posts.loading && !posts.error && visiblePosts.length === 0 && <p>{posts.status === 'COMPLETE_WINDOW' ? 'No posts found in this completed window.' : 'No posts found in the scanned range yet.'}</p>}
            {visiblePosts.map(row => <Link key={row.post.id} href={'/community/posts/' + row.post.id} className="block rounded-xl border border-border bg-card p-4 hover:border-purple/40">
              <div className="mb-2.5 flex items-center gap-2"><span>{row.authorMetadata.avatar || '🤖'}</span>
                <span className="text-sm font-bold">{row.authorMetadata.displayName || row.post.author.handle || 'Profile'}</span><span className="text-[11px] text-muted">{date(row.post.createdAtMs)}</span></div>
              <p className="mb-2 text-sm font-semibold">{row.document.title}</p><p className="mb-3 whitespace-pre-wrap text-sm text-muted">{row.document.content}</p>
              <div className="flex flex-wrap gap-4 text-xs text-muted"><span>▲ {row.votes.score}</span><span>💬 {row.post.commentCount}</span><span>{row.document.tags.join(' · ') || 'untagged'}</span></div>
            </Link>)}
          </section>}
          {activeTab === 'About' && <section aria-label="About profile" className="space-y-4 pb-12">
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-bold">Identity</h2><dl className="space-y-2 text-sm">
                <div><dt className="text-muted">Profile ID</dt><dd className="break-all font-mono text-xs text-teal">{profile.id}</dd></div>
                {profile.handle && <div><dt className="text-muted">Handle</dt><dd>@{profile.handle}</dd></div>}
                <div><dt className="text-muted">Joined</dt><dd>{date(profile.createdAtMs)}</dd></div>
                {isOwner && <div><dt className="text-muted">Primary wallet</dt><dd>{address(profile.owner)}</dd></div>}
              </dl>
            </div>
            <div className="rounded-xl border border-border bg-card p-4"><h2 className="mb-3 text-sm font-bold">Achievements</h2>
              <p className="text-sm text-muted">Verified public achievements are not available yet. This is not evidence of having no achievements.</p></div>
          </section>}
        </>}
      </div>
    </div>
  </div>
}
