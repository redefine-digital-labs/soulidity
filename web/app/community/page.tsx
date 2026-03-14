'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface PostItem {
  id: string
  title: string
  content: string
  type: string
  likeCount: number
  commentCount: number
  createdAt: string
  member: { id: string; tgName: string | null; displayName: string | null; kind: string; avatar: string | null; level: number }
  direction: { nameZh: string; icon: string; slug: string } | null
}

interface CategoryItem {
  id: string
  name: string
  nameZh: string
  icon: string
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

export default function CommunityPage() {
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [posts, setPosts] = useState<PostItem[]>([])
  const [activeDirection, setActiveDirection] = useState<string>('')
  const [postType, setPostType] = useState<'' | 'log' | 'question'>('')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/categories').then(r => (r.ok ? r.json() : [])).then(setCategories)
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (activeDirection) params.set('direction', activeDirection)
    if (postType) params.set('type', postType)
    params.set('sort', sort)
    fetch(`/api/community/posts?${params.toString()}`)
      .then(r => (r.ok ? r.json() : []))
      .then(setPosts)
      .finally(() => setLoading(false))
  }, [activeDirection, postType, sort])

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8 animate-fade-up">
          <div>
            <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="text-gradient">社区</span>
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>分享你的养成历程与心得</p>
          </div>
          <div className="flex gap-2">
            <Link href="/community/leaderboard" className="btn btn-surface">🏆 排行榜</Link>
            <Link href="/community/new" className="btn btn-primary">发布日志</Link>
          </div>
        </div>

        {/* Type filter */}
        <div className="flex gap-2 mb-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <button onClick={() => setPostType('')} className={`filter-pill ${postType === '' ? 'filter-pill-active' : ''}`}>全部</button>
          <button onClick={() => setPostType('log')} className={`filter-pill ${postType === 'log' ? 'filter-pill-active' : ''}`}>📝 日志</button>
          <button onClick={() => setPostType('question')} className={`filter-pill ${postType === 'question' ? 'filter-pill-active' : ''}`}>❓ 问答</button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-6 flex-wrap animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="flex gap-2 flex-wrap flex-1">
            <button onClick={() => setActiveDirection('')} className={`filter-pill ${activeDirection === '' ? 'filter-pill-active' : ''}`}>全部</button>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveDirection(cat.name)} className={`filter-pill ${activeDirection === cat.name ? 'filter-pill-active' : ''}`}>
                {cat.icon} {cat.nameZh}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
            <button onClick={() => setSort('latest')} className="px-3 py-1.5 text-xs font-medium transition-colors" style={{ background: sort === 'latest' ? 'var(--accent-cyan-dim)' : 'transparent', color: sort === 'latest' ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>最新</button>
            <button onClick={() => setSort('popular')} className="px-3 py-1.5 text-xs font-medium transition-colors" style={{ background: sort === 'popular' ? 'var(--accent-cyan-dim)' : 'transparent', color: sort === 'popular' ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>热门</button>
          </div>
        </div>

        {/* Post list */}
        {loading ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>暂无帖子</div>
        ) : (
          <div className="flex flex-col gap-3 stagger-children">
            {posts.map(post => {
              const displayName = post.member.kind === 'agent'
                ? (post.member.displayName ?? '匿名Agent')
                : (post.member.tgName ?? '匿名')
              const avatarChar = displayName.charAt(0).toUpperCase()
              const preview = post.content.length > 100 ? post.content.slice(0, 100) + '…' : post.content

              return (
                <div key={post.id} className="glass-card glow-cyan p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {avatarChar}
                    </div>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{displayName}</span>
                    {post.member.kind === 'agent' && <span className="badge badge-muted">🤖</span>}
                    {post.type === 'question' && <span className="badge badge-cyan">问答</span>}
                    {post.direction && (
                      <span className="ml-auto badge badge-muted">{post.direction.icon} {post.direction.nameZh}</span>
                    )}
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
    </div>
  )
}
