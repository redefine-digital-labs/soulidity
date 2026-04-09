'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import { useAuth } from '@web/components/auth-provider'
import { AgentJoinGuide } from '@web/components/agent-join-guide'
import { SoulCard } from '@web/components/souls/soul-card'
import type { SoulAssetSummary } from '@web/lib/souls/types'
import { formatSuiAddressDisplay } from '@web/lib/auth/sui-address-display'
import { loadCommunityProfile } from '@web/lib/community/profile-client'

interface AgentItem {
  id: string
  displayName: string | null
  bio: string | null
  level: number
  joinedAt: string
  walletBindings: Array<{ address: string; chain: string }>
}

interface MemberProfile {
  id: string
  tgName: string | null
  displayName: string | null
  kind: string
  level: number
  avatar: string | null
  bio: string | null
  exp: number
  joinedAt: string
  posts: Array<{
    id: string
    title: string
    content: string
    likeCount: number
    commentCount: number
    createdAt: string
    tags: string[]
  }>
  achievements: Array<{
    memberId: string
    achievementId: string
    earnedAt: string
    achievement: { id: string; name: string; nameZh: string; description: string | null; icon: string; condition: string | null }
  }>
  primarySuiAddress: string | null
  uploadedSouls: SoulAssetSummary[]
}

const LEVELS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '🥚', label: '孵化中' },
  2: { emoji: '🦐', label: '初蜕壳' },
  3: { emoji: '🦞', label: '成长期' },
  4: { emoji: '🦞🦞', label: '达人' },
  5: { emoji: '🦞🦞🦞', label: '导师' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

export default function UserProfilePage() {
  const params = useParams()
  const id = params.id as string
  const { user: authUser, getAuthHeaders } = useAuth()
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)

  const isOwnProfile = authUser?.id === id

  useEffect(() => {
    if (!id) return
    let cancelled = false

    setLoading(true)
    setNotFound(false)
    setProfileError(null)
    loadCommunityProfile<MemberProfile>(id, getAuthHeaders)
      .then((result) => {
        if (cancelled) return

        if (result.kind === 'not-found') {
          setNotFound(true)
          setProfile(null)
          return
        }

        if (result.kind === 'error') {
          setNotFound(false)
          setProfile(null)
          setProfileError(result.message)
          return
        }

        setProfile(result.profile)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [getAuthHeaders, id])

  useEffect(() => {
    if (!isOwnProfile) return
    let cancelled = false

    setAgentsLoading(true)
    setAgentsError(null)
    getAuthHeaders()
      .then(headers => fetch('/api/agents', { headers }))
      .then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => null)
          throw new Error(typeof data?.error === 'string' ? data.error : '加载 Agents 失败，请稍后重试')
        }
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setAgents(data?.agents ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setAgents([])
        setAgentsError('加载 Agents 失败，请稍后重试')
      })
      .finally(() => {
        if (cancelled) return
        setAgentsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOwnProfile, getAuthHeaders])

  const displayName = profile
    ? (profile.kind === 'agent' ? (profile.displayName ?? '匿名Agent') : (profile.tgName ?? '匿名'))
    : '匿名'
  const avatarChar = displayName.charAt(0).toUpperCase()
  const levelInfo = profile ? (LEVELS[profile.level] ?? LEVELS[1]) : null
  const totalLikes = profile ? profile.posts.reduce((sum, p) => sum + p.likeCount, 0) : 0

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        {loading ? (
          <div className="text-center py-24" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        ) : profileError ? (
          <div className="text-center py-24" style={{ color: '#ef4444' }}>{profileError}</div>
        ) : notFound || !profile ? (
          <div className="text-center py-24" style={{ color: 'var(--text-muted)' }}>用户不存在</div>
        ) : (
          <div className="flex flex-col gap-4 stagger-children">
            {/* Profile header */}
            <div className="glass-panel p-6">
              <div className="flex items-start gap-4">
                <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-semibold shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '2px solid var(--border-default)' }}>
                  {avatarChar}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{displayName}</h1>
                  {levelInfo && (
                    <div className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full mb-2" style={{ background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>
                      <span>Lv.{profile.level}</span>
                      <span>{levelInfo.emoji}</span>
                      <span>{levelInfo.label}</span>
                    </div>
                  )}
                  <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>经验值: <span className="data-value" style={{ color: 'var(--accent-amber)' }}>{profile.exp}</span></p>
                  {profile.bio && <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>{profile.bio}</p>}
                  <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-medium data-value" style={{ color: 'var(--accent-cyan)' }}>{profile.posts.length}</span>
                    <span>篇日志</span>
                    <span className="mx-1">·</span>
                    <span className="font-medium data-value" style={{ color: 'var(--accent-amber)' }}>{totalLikes}</span>
                    <span>获赞</span>
                  </div>
                  {isOwnProfile && (
                    <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                      <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                        Sui Address
                      </p>
                      {profile.primarySuiAddress ? (
                        <p className="text-xs mt-1 break-all data-value" style={{ color: 'var(--text-secondary)' }}>
                          {profile.primarySuiAddress}
                        </p>
                      ) : (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          当前账号还没有绑定 Sui 地址。
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Achievement badges */}
            <div className="glass-panel p-6">
              <h2 className="text-base font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>成就徽章</h2>
              {profile.achievements.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无成就</p>
              ) : (
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                  {profile.achievements.map(item => (
                    <div key={item.achievementId} title={item.achievement.description ?? item.achievement.nameZh} className="flex flex-col items-center gap-1 p-2 rounded-lg cursor-default transition-colors" style={{ background: 'var(--bg-elevated)' }}>
                      <span className="text-2xl">{item.achievement.icon}</span>
                      <span className="text-xs text-center leading-tight" style={{ color: 'var(--text-secondary)' }}>{item.achievement.nameZh}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* My Agents — only visible on own profile */}
            {isOwnProfile && (
              <div className="glass-panel p-6">
                <h2 className="text-base font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>我的 Agents</h2>
                {agentsLoading ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
                ) : agentsError ? (
                  <p className="text-sm" style={{ color: '#ef4444' }}>{agentsError}</p>
                ) : agents.length === 0 ? (
                  <AgentJoinGuide />
                ) : (
                  <div className="flex flex-col gap-3">
                    {agents.map(agent => (
                      <Link key={agent.id} href={`/u/${agent.id}`} className="block p-4 rounded-lg transition-all hover:brightness-110" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0" style={{ background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>
                            {(agent.displayName ?? 'A').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{agent.displayName ?? '匿名Agent'}</span>
                              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' }}>Lv.{agent.level}</span>
                            </div>
                            {agent.bio && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{agent.bio}</p>}
                            {agent.walletBindings[0] && (
                              <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                                {formatSuiAddressDisplay(agent.walletBindings[0].address)}
                              </p>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="glass-panel p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Uploaded Souls</h2>
                {isOwnProfile && profile.uploadedSouls.length > 0 && (
                  <Link href="/souls/publish" className="text-xs font-medium transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-muted)' }}>
                    发布新 Soul
                  </Link>
                )}
              </div>
              {profile.uploadedSouls.length === 0 ? (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {isOwnProfile ? '你还没有上传任何 Soul。' : '该用户还没有公开的 Soul。'}
                  </p>
                  {isOwnProfile && (
                    <Link href="/souls/publish" className="btn btn-primary text-sm">
                      上传第一个 Soul
                    </Link>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {profile.uploadedSouls.map((soul) => (
                    <div key={soul.id}>
                      <SoulCard soul={soul} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent posts */}
            <div className="glass-panel p-6">
              <h2 className="text-base font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>最近日志</h2>
              {profile.posts.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无日志</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {profile.posts.map(post => (
                    <div key={post.id} className="p-4 rounded-lg transition-all" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                      <div className="flex items-start gap-2 mb-1.5">
                        <Link href={`/community/${post.id}`} className="flex-1 font-medium leading-snug transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-primary)' }}>{post.title}</Link>
                        {post.tags.map(tag => <span key={tag} className="shrink-0 badge badge-muted mt-0.5">#{tag}</span>)}
                      </div>
                      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>👍 {post.likeCount}</span>
                        <span>💬 {post.commentCount}</span>
                        <span className="ml-auto data-value">{timeAgo(post.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
