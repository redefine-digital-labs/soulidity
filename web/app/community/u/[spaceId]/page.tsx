'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import { useAuth } from '@/components/providers/auth-provider'
import { useFollowStatus, useToggleFollow } from '@/lib/hooks/use-social'
import { EmptySoulsState } from '@/components/empty-souls-state'
import { ProfileStatsPill } from '@/components/profile-stats-pill'

type CommunityProfile = {
  id: string
  tgName: string | null
  displayName: string | null
  handle: string | null
  kind: string
  avatar: string | null
  bio: string | null
  coverImageUrl: string | null
  level: number
  exp: number
  joinedAt: string
  primarySuiAddress: string | null
  posts: Array<{
    id: string
    title: string
    content: string
    tags: string[]
    likeCount: number
    commentCount: number
    createdAt: string
  }>
  achievements: Array<{
    achievement: {
      id: string
      name: string
    }
  }>
  uploadedSouls: Array<{
    id: string
    onChainId: string
    name: string
    description: string
    previewImages: string[]
    tags: string[]
    listedPriceAtomic: string | null
    listingStatus: string
  }>
}

type Tab = 'Souls' | 'Posts' | 'About'

function FollowButton({ targetMemberId }: { targetMemberId: string }) {
  const { user } = useAuth()
  const { data, isLoading } = useFollowStatus(targetMemberId)
  const toggleFollow = useToggleFollow()

  const [optimistic, setOptimistic] = useState<boolean | undefined>(undefined)
  const isFollowing = optimistic !== undefined ? optimistic : (data?.isFollowing ?? false)

  if (!user || isLoading) return null

  function handleClick() {
    const next = !isFollowing
    setOptimistic(next)
    toggleFollow.mutate(targetMemberId, {
      onError: () => setOptimistic(!next),
      onSuccess: () => setOptimistic(undefined),
    })
  }

  return (
    <Button
      variant={isFollowing ? 'primary' : 'outline'}
      size="sm"
      onClick={handleClick}
      disabled={toggleFollow.isPending}
      className={isFollowing ? '' : 'border-purple text-purple hover:bg-purple hover:text-white'}
    >
      {isFollowing ? 'Following' : '+ Follow'}
    </Button>
  )
}

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatJoinedMonth(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function buildHeroStyle(imageUrl: string | null | undefined, kind: string | null | undefined) {
  if (!imageUrl) {
    if (kind === 'agent') {
      return {
        background: 'linear-gradient(115deg, #7C3AED 0%, #3B2388 42%, #14B8A6 100%)',
      }
    }
    return {
      background: 'radial-gradient(circle at 22% 30%, rgba(168,85,247,0.35), transparent 55%), radial-gradient(circle at 82% 70%, rgba(20,184,166,0.22), transparent 60%), linear-gradient(135deg, #1A1040, #0D0A1E)',
    }
  }

  return {
    backgroundImage: `linear-gradient(135deg, rgba(46,27,110,0.48), rgba(15,95,115,0.55)), url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}

export default function SpaceProfilePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params)
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('Souls')
  const { data: profile, isLoading, error } = useQuery<CommunityProfile>({
    queryKey: ['community-profile', spaceId],
    queryFn: async () => {
      const res = await fetch(`/api/community/profile/${encodeURIComponent(spaceId)}`, { cache: 'no-store' })
      if (!res.ok) {
        throw new Error('Failed to fetch community profile')
      }
      return res.json()
    },
  })
  const { data: followData, isLoading: isFollowLoading } = useFollowStatus(profile?.id ?? null)

  if (isLoading || (profile?.id && isFollowLoading)) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-8">
        <div className="h-[360px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-12">
        <EmptyState
          icon="🫥"
          label="Profile not found"
          sublabel="This community profile has not been mirrored or is not accessible from the current route."
        />
      </div>
    )
  }

  const displayName = profile.displayName || profile.tgName || (profile.handle ? `@${profile.handle}` : 'Trainer')
  const isSoulSpace = profile.kind === 'agent'
  const isOwner = !!user && profile.id === user.id
  const kindLabel = isSoulSpace ? 'Soul' : 'Trainer'

  const followerCount = followData?.followerCount ?? 0
  const followingCount = followData?.followingCount ?? 0
  const isEmpty =
    profile.uploadedSouls.length === 0 &&
    profile.posts.length === 0 &&
    (profile.exp ?? 0) === 0 &&
    followerCount === 0

  const avatarGlyph = profile.avatar || displayName.slice(0, 1).toUpperCase()
  const joinedLabel = formatJoinedMonth(profile.joinedAt).toUpperCase()

  return (
    <div className="relative z-10 min-h-screen pb-12">
      <div className="max-w-[800px] mx-auto">
        {/* ── Hero banner + avatar ── */}
        <div className="relative">
          <div
            className="group h-[120px] sm:h-[160px] relative overflow-hidden"
            style={buildHeroStyle(profile.coverImageUrl, profile.kind)}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_40%)]" />

            {/* top-left breadcrumb */}
            <Link
              href="/community"
              className="absolute top-3.5 left-5 text-[12px] text-muted hover:text-foreground transition-colors"
            >
              ← Community
            </Link>

            {/* Caption — top-right on sm+, stacks below breadcrumb on mobile */}
            <div
              className="absolute top-9 left-5 sm:top-3.5 sm:left-auto sm:right-5 font-mono text-[10.5px] uppercase tracking-[0.15em]"
              style={{ color: 'rgba(248,245,255,0.5)' }}
            >
              {kindLabel}
              {joinedLabel && <> · JOINED {joinedLabel}</>}
            </div>

            {/* owner hover overlay: Change cover */}
            {isOwner && (
              <Link
                href="/profile#cover"
                className="absolute bottom-3.5 right-5 text-[11px] font-semibold text-foreground bg-card/80 border border-border rounded-md px-2.5 py-1 opacity-100 transition-opacity hover:border-purple sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              >
                ✎ Change cover
              </Link>
            )}
          </div>

          {/* Avatar — absolute, overlapping banner 50% */}
          <div
            className="absolute left-7 bottom-0 translate-y-1/2 w-[84px] h-[84px] rounded-full flex items-center justify-center text-[28px] font-extrabold border-[3px] overflow-hidden z-10"
            style={{
              background: isSoulSpace
                ? 'conic-gradient(from 210deg at 45% 40%, #A855F7, #7C3AED, #14B8A6, #A855F7)'
                : 'linear-gradient(135deg, var(--card), var(--card2))',
              borderColor: 'var(--bg)',
              letterSpacing: '-0.02em',
            }}
          >
            {avatarGlyph}
          </div>
        </div>

        {/* ── Header row: name + handle + actions, aligned to baseline ── */}
        <div className="px-7 pt-14 sm:pt-5 sm:pl-[128px] sm:pr-7">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1
                  className="font-display font-extrabold text-[22px]"
                  style={{ letterSpacing: '-0.02em' }}
                >
                  {displayName}
                </h1>
                {profile.handle && (
                  <Tag color="muted">@{profile.handle}</Tag>
                )}
                {/* PR3: keep "Level N" tag only for Soul spaces */}
                {isSoulSpace && (
                  <Tag color="success">Level {profile.level}</Tag>
                )}
              </div>

              {/* Wallet line — owner only (PR4) */}
              {isOwner && (
                <div className="mt-1.5 font-mono text-[11px] text-muted">
                  {profile.primarySuiAddress ? (
                    <>Wallet · {formatAddress(profile.primarySuiAddress)}</>
                  ) : (
                    <>
                      Wallet not linked ·{' '}
                      <Link href="/profile#wallet" className="text-purple hover:underline">
                        Link wallet →
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Actions — right-aligned on desktop, stack below on mobile (acceptance #12) */}
            <div className="flex gap-2 shrink-0 flex-wrap">
              {isOwner ? (
                <Link href="/profile#profile">
                  <Button variant="outline" size="sm">
                    ✎ Edit profile
                  </Button>
                </Link>
              ) : (
                <>
                  <FollowButton targetMemberId={profile.id} />
                  <Button variant="outline" size="sm">
                    Share
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-7 pt-3">
          {/* Bio */}
          <p className="text-[13.5px] text-muted leading-relaxed mb-4 max-w-[560px]">
            {profile.bio ? (
              profile.bio
            ) : isOwner ? (
              <>
                No bio yet.{' '}
                <Link href="/profile" className="text-purple hover:underline">
                  Add one →
                </Link>
              </>
            ) : (
              'No bio yet.'
            )}
          </p>

          {/* Stats */}
          <ProfileStatsPill
            kind={profile.kind}
            level={profile.level}
            souls={profile.uploadedSouls.length}
            posts={profile.posts.length}
            exp={profile.exp}
            followers={followerCount}
            following={followingCount}
            achievements={profile.achievements.length}
            isEmpty={isEmpty}
            isOwner={isOwner}
            joinedAt={profile.joinedAt}
          />

          {/* Tabs (PR8) */}
          <div className="flex gap-1 mb-6 border-b border-border">
            {(['Souls', 'Posts', 'About'] as Tab[]).map((tab) => {
              const isActive = activeTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={
                    isActive
                      ? 'px-4 py-2.5 text-[13.5px] font-bold text-foreground border-b-[3px] border-purple -mb-[1.5px] relative z-10 transition'
                      : 'px-4 py-2.5 text-[13.5px] font-semibold text-muted hover:text-foreground transition'
                  }
                >
                  {tab}
                </button>
              )
            })}
          </div>

          {/* Tab: Souls */}
          {activeTab === 'Souls' && (
            profile.uploadedSouls.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-12">
                {profile.uploadedSouls.map((soul) => (
                  <Link
                    key={soul.id}
                    href={`/souls/${encodeURIComponent(soul.onChainId)}`}
                    className="bg-card border border-border rounded-xl overflow-hidden hover:border-purple hover:-translate-y-0.5 transition block"
                  >
                    <div className="h-24 flex items-end p-3" style={buildHeroStyle(soul.previewImages[0] ?? null, profile.kind)}>
                      <Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'}>{soul.listingStatus}</Tag>
                    </div>
                    <div className="p-3">
                      <div className="font-bold text-sm mb-1 truncate">{soul.name}</div>
                      <div className="text-xs text-muted leading-relaxed line-clamp-2 mb-2">{soul.description}</div>
                      <div className="flex items-center justify-between">
                        <Tag color="muted">{soul.tags[0] ?? 'Soul'}</Tag>
                        <span className="text-gold text-xs font-bold">
                          {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Held'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptySoulsState isOwner={isOwner} displayName={displayName} />
            )
          )}

          {/* Tab: Posts */}
          {activeTab === 'Posts' && (
            profile.posts.length > 0 ? (
              <div className="flex flex-col gap-3 pb-12">
                {profile.posts.map((post) => (
                  <div key={post.id} className="bg-card border border-border rounded-xl p-4 hover:border-purple/40 transition">
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 bg-card2">
                        {displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-bold text-sm">{displayName}</span>
                        <span className="text-[11px] text-muted ml-2">
                          {new Date(post.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm font-semibold mb-2">{post.title}</p>
                    <p className="text-sm leading-relaxed mb-3 text-muted">{post.content}</p>
                    <div className="flex items-center gap-4 text-xs text-muted">
                      <span>▲ {post.likeCount}</span>
                      <span>💬 {post.commentCount}</span>
                      <span>{post.tags.join(' · ') || 'untagged'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pb-12">
                <EmptyState icon="📝" label="No posts yet" sublabel="Published posts will show up here." />
              </div>
            )
          )}

          {/* Tab: About — Member ID lives here, not in hero (PR4) */}
          {activeTab === 'About' && (
            <div className="pb-12 space-y-4">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="page-kicker text-muted mb-3">Identity</div>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Member ID</span>
                    <span className="font-mono text-xs text-teal">{profile.id}</span>
                  </div>
                  {profile.handle && (
                    <div className="flex justify-between">
                      <span className="text-muted">Handle</span>
                      <span className="font-mono text-xs">@{profile.handle}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Joined</span>
                    <span>{new Date(profile.joinedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Primary wallet</span>
                    <span>{formatAddress(profile.primarySuiAddress)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <div className="page-kicker text-muted mb-3">Achievements</div>
                {profile.achievements.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {profile.achievements.map((entry) => (
                      <Tag key={entry.achievement.id} color="purple">{entry.achievement.name}</Tag>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">No achievements yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
