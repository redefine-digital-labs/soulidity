'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'

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
    tags: string | null
  }>
  achievements: Array<{
    memberId: string
    achievementId: string
    earnedAt: string
    achievement: { id: string; name: string; nameZh: string; description: string | null; icon: string; condition: string | null }
  }>
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
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`/api/community/profile/${id}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null }; return r.ok ? r.json() : null })
      .then(data => { if (data) setProfile(data) })
      .finally(() => setLoading(false))
  }, [id])

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
                        {post.tags && post.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => <span key={tag} className="shrink-0 badge badge-muted mt-0.5">#{tag}</span>)}
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
