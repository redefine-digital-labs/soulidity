'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface DirectionDetail {
  id: string
  name: string
  nameZh: string
  slug: string
  icon: string
  description: string | null
  descriptionZh: string | null
  userCount: number
  rating: number
  category: { name: string; nameZh: string; icon: string }
}

interface PostItem {
  id: string
  title: string
  content: string
  type: string
  likeCount: number
  commentCount: number
  createdAt: string
  member: { id: string; tgName: string | null; avatar: string | null; level: number }
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

function levelBadge(level: number): string {
  return ['🥚', '🦐', '🦞', '🦞🦞', '🦞🦞🦞'][level - 1] ?? '🥚'
}

type TabKey = 'overview' | 'discussion' | 'qa'

export default function DirectionDetailPage() {
  const { category, slug } = useParams<{ category: string; slug: string }>()
  const [direction, setDirection] = useState<DirectionDetail | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [posts, setPosts] = useState<PostItem[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/directions/${slug}`)
      .then(r => (r.ok ? r.json() : null))
      .then(setDirection)
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (tab === 'overview' || !direction) return
    setPostsLoading(true)
    const type = tab === 'discussion' ? 'log' : 'question'
    fetch(`/api/community/posts?directionId=${direction.id}&type=${type}&sort=latest`)
      .then(r => (r.ok ? r.json() : []))
      .then(setPosts)
      .finally(() => setPostsLoading(false))
  }, [tab, direction])

  if (loading) return <div className="min-h-screen"><PublicNav /><div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div></div>
  if (!direction) return <div className="min-h-screen"><PublicNav /><div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>方向不存在</div></div>

  const description = direction.descriptionZh || direction.description
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'discussion', label: '讨论' },
    { key: 'qa', label: '问答' },
  ]

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm mb-8 animate-fade-up" style={{ color: 'var(--text-muted)' }}>
          <Link href="/directions" className="transition-colors hover:text-[var(--accent-cyan)]">养成方向</Link>
          <span>/</span>
          <Link href={`/directions/${direction.category.name}`} className="transition-colors hover:text-[var(--accent-cyan)]">
            {direction.category.icon} {direction.category.nameZh}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--text-primary)' }}>{direction.nameZh}</span>
        </nav>

        {/* Header card */}
        <div className="glass-panel p-6 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-4">
            <span className="text-5xl">{direction.icon}</span>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                <span className="text-gradient">{direction.nameZh}</span>
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{direction.name}</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold data-value" style={{ color: 'var(--accent-cyan)' }}>{direction.userCount}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>使用人数</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold data-value" style={{ color: 'var(--accent-amber)' }}>{direction.rating.toFixed(1)}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>评分</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-2xl font-bold">{direction.category.icon}</div>
            <div className="text-xs mt-1"><span className="badge badge-cyan">{direction.category.nameZh}</span></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 animate-fade-up" style={{ animationDelay: '150ms', borderBottom: '1px solid var(--border-subtle)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-4 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: tab === t.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                borderBottom: tab === t.key ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && description && (
          <div className="glass-panel p-6 animate-fade-up">
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>介绍</h2>
            <p className="whitespace-pre-line" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>{description}</p>
          </div>
        )}

        {(tab === 'discussion' || tab === 'qa') && (
          <div className="animate-fade-up">
            <div className="flex justify-end mb-4">
              <Link
                href={`/community/new?direction=${slug}&type=${tab === 'discussion' ? 'log' : 'question'}`}
                className="btn btn-primary text-sm"
              >
                {tab === 'discussion' ? '发布日志' : '提问'}
              </Link>
            </div>

            {postsLoading ? (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>加载中...</div>
            ) : posts.length === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                {tab === 'discussion' ? '暂无讨论，来发布第一篇日志吧' : '暂无问题，来提出第一个问题吧'}
              </div>
            ) : (
              <div className="flex flex-col gap-3 stagger-children">
                {posts.map(post => {
                  const displayName = post.member.tgName ?? '匿名'
                  const avatarChar = displayName.charAt(0).toUpperCase()
                  const preview = post.content.length > 100 ? post.content.slice(0, 100) + '…' : post.content

                  return (
                    <div key={post.id} className="glass-card glow-cyan p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                          {avatarChar}
                        </div>
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{displayName}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{levelBadge(post.member.level)}</span>
                        {post.type === 'question' && <span className="ml-auto badge badge-cyan">问答</span>}
                      </div>
                      <Link href={`/community/${post.id}`} className="block font-semibold mb-1 transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        {post.type === 'question' ? '❓ ' : ''}{post.title}
                      </Link>
                      {preview && <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>{preview}</p>}
                      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>👍 {post.likeCount}</span>
                        <span>💬 {post.commentCount}</span>
                        <span className="ml-auto data-value">{timeAgo(post.createdAt)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
