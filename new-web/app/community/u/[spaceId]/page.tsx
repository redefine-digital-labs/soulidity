'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'

type CommunityProfile = {
  id: string
  tgName: string | null
  displayName: string | null
  kind: string
  avatar: string | null
  bio: string | null
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
    category: string
    tags: string[]
    listedPriceAtomic: string | null
    listingStatus: string
  }>
}

type Tab = 'Souls' | 'Posts' | 'About'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function buildHeroStyle(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return {
      background: 'linear-gradient(135deg, #2E1B6E, #0F5F73)',
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

  if (isLoading) {
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

  const displayName = profile.displayName || profile.tgName || profile.id

  return (
    <div className="relative z-10 min-h-screen">
      <div className="h-[120px] sm:h-[180px] relative overflow-hidden" style={buildHeroStyle(null)}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_40%)]" />
      </div>

      <div className="max-w-[800px] mx-auto px-6">
        <div className="flex items-end justify-between -mt-9 mb-4">
          <div
            className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-2xl border-[3px] bg-card text-foreground font-bold overflow-hidden"
            style={{ borderColor: 'var(--bg)' }}
          >
            {profile.avatar || displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex gap-2 pb-1">
            <button className="bg-card border border-border text-foreground font-semibold text-sm px-4 py-2 rounded-lg hover:border-purple transition">
              Share
            </button>
            <button className="bg-purple text-white font-semibold text-sm px-5 py-2 rounded-lg hover:opacity-90 transition">
              Follow
            </button>
          </div>
        </div>

        <div className="mb-1 flex items-center gap-2 flex-wrap">
          <h1 className="font-display text-xl font-bold">{displayName}</h1>
          <Tag color={profile.kind === 'trainer' ? 'purple' : 'muted'}>{profile.kind}</Tag>
          <Tag color="success">Level {profile.level}</Tag>
        </div>

        <div className="text-xs text-muted font-mono mb-2">
          {profile.id}
          {profile.primarySuiAddress && <> · {formatAddress(profile.primarySuiAddress)}</>}
        </div>
        <p className="text-sm text-muted leading-relaxed mb-4">{profile.bio || 'No bio yet.'}</p>

        <div className="flex items-center gap-4 sm:gap-6 mb-5 pb-5 border-b border-border flex-wrap">
          <div className="text-center">
            <div className="font-bold text-base">{profile.uploadedSouls.length}</div>
            <div className="text-[11px] text-muted">Souls</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base text-gold">{profile.exp}</div>
            <div className="text-[11px] text-muted">EXP</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base">{profile.posts.length}</div>
            <div className="text-[11px] text-muted">Posts</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-base">{profile.achievements.length}</div>
            <div className="text-[11px] text-muted">Achievements</div>
          </div>
        </div>

        <div className="flex gap-1 mb-6 border-b border-border">
          {(['Souls', 'Posts', 'About'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-semibold transition border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-purple text-foreground'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Souls' && (
          profile.uploadedSouls.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-12">
              {profile.uploadedSouls.map((soul) => (
                <Link
                  key={soul.id}
                  href={`/souls/${encodeURIComponent(soul.onChainId)}`}
                  className="bg-card border border-border rounded-xl overflow-hidden hover:border-purple hover:-translate-y-0.5 transition block"
                >
                  <div className="h-24 flex items-end p-3" style={buildHeroStyle(soul.previewImages[0] ?? null)}>
                    <Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'}>{soul.listingStatus}</Tag>
                  </div>
                  <div className="p-3">
                    <div className="font-bold text-sm mb-1 truncate">{soul.name}</div>
                    <div className="text-xs text-muted leading-relaxed line-clamp-2 mb-2">{soul.description}</div>
                    <div className="flex items-center justify-between">
                      <Tag color="muted">{soul.category}</Tag>
                      <span className="text-gold text-xs font-bold">
                        {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Held'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="pb-12">
              <EmptyState icon="🫥" label="No Souls published yet" sublabel="When this member mints or imports Souls, they will appear here." />
            </div>
          )
        )}

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

        {activeTab === 'About' && (
          <div className="pb-12 space-y-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="page-kicker text-muted mb-3">Identity</div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Member ID</span>
                  <span className="font-mono text-xs text-teal">{profile.id}</span>
                </div>
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
  )
}
