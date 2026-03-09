'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'

interface PostDetail {
  id: string
  title: string
  content: string
  tags: string | null
  likeCount: number
  commentCount: number
  createdAt: string
  updatedAt: string
  member: { id: string; tgName: string | null; avatar: string | null; level: number }
  direction: { nameZh: string; icon: string; slug: string; category: { name: string } } | null
  comments: Array<{
    id: string
    content: string
    createdAt: string
    member: { id: string; tgName: string | null; avatar: string | null; level: number }
  }>
}

function levelBadge(level: number): string {
  const badges: Record<number, string> = { 1: '🥚', 2: '🦐', 3: '🦞', 4: '🦞🦞', 5: '🦞🦞🦞' }
  return badges[level] ?? '🥚'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [memberId, setMemberId] = useState('')
  const [commentContent, setCommentContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function fetchPost() {
    try {
      const res = await fetch(`/api/community/posts/${id}`)
      if (!res.ok) throw new Error('加载失败')
      setPost(await res.json())
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败') } finally { setLoading(false) }
  }

  useEffect(() => { if (id) fetchPost() }, [id])

  async function handleCommentSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!memberId.trim() || !commentContent.trim()) return
    setSubmitting(true); setSubmitError(null)
    try {
      const res = await fetch(`/api/community/posts/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: memberId.trim(), content: commentContent.trim() }) })
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data?.error ?? '发表失败') }
      setCommentContent('')
      await fetchPost()
    } catch (e) { setSubmitError(e instanceof Error ? e.message : '发表失败') } finally { setSubmitting(false) }
  }

  if (loading) return (<div className="min-h-screen"><PublicNav /><div className="max-w-4xl mx-auto px-6 py-10 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div></div>)
  if (error || !post) return (<div className="min-h-screen"><PublicNav /><div className="max-w-4xl mx-auto px-6 py-10"><Link href="/community" className="text-sm mb-6 inline-block" style={{ color: 'var(--text-muted)' }}>← 返回社区</Link><div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>{error ?? '帖子不存在'}</div></div></div>)

  const displayName = post.member.tgName ?? '匿名'
  const avatarChar = displayName.charAt(0).toUpperCase()
  const tags = post.tags ? post.tags.split(',').map(t => t.trim()).filter(Boolean) : []

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link href="/community" className="text-sm mb-6 inline-block transition-colors" style={{ color: 'var(--text-muted)' }}>← 返回社区</Link>

        {/* Post */}
        <div className="glass-panel p-6 mb-4 animate-fade-up">
          <div className="flex items-center gap-3 mb-4">
            <Link href={`/u/${post.member.id}`} className="shrink-0">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-all" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{avatarChar}</div>
            </Link>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <Link href={`/u/${post.member.id}`} className="text-sm font-medium transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-primary)' }}>{displayName}</Link>
                <span className="text-xs">{levelBadge(post.member.level)}</span>
              </div>
              <span className="text-xs data-value" style={{ color: 'var(--text-muted)' }}>{formatDate(post.createdAt)}</span>
            </div>
            {post.direction && <span className="ml-auto badge badge-muted">{post.direction.icon} {post.direction.nameZh}</span>}
          </div>
          <h1 className="text-2xl font-bold mb-4 leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{post.title}</h1>
          <p className="leading-relaxed whitespace-pre-wrap mb-4" style={{ color: 'var(--text-secondary)' }}>{post.content}</p>
          {tags.length > 0 && <div className="flex flex-wrap gap-2 mb-4">{tags.map(tag => <span key={tag} className="badge badge-muted">#{tag}</span>)}</div>}
          <div className="flex items-center gap-4 text-sm pt-4" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span>👍 {post.likeCount}</span>
            <span>💬 {post.commentCount}</span>
          </div>
        </div>

        {/* Comments */}
        <div className="glass-panel p-6 mb-4 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>评论 ({post.comments.length})</h2>
          {post.comments.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>暂无评论，来留下第一条吧</p>
          ) : (
            <div className="flex flex-col gap-5">
              {post.comments.map(comment => {
                const cName = comment.member.tgName ?? '匿名'
                const cChar = cName.charAt(0).toUpperCase()
                return (
                  <div key={comment.id} className="flex gap-3">
                    <Link href={`/u/${comment.member.id}`} className="shrink-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{cChar}</div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/u/${comment.member.id}`} className="text-sm font-medium transition-colors hover:text-[var(--accent-cyan)]" style={{ color: 'var(--text-secondary)' }}>{cName}</Link>
                        <span className="text-xs">{levelBadge(comment.member.level)}</span>
                        <span className="text-xs data-value ml-auto shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(comment.createdAt)}</span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{comment.content}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Comment form */}
        <div className="glass-panel p-6 animate-fade-up" style={{ animationDelay: '200ms' }}>
          <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>发表评论</h2>
          <form onSubmit={handleCommentSubmit} className="flex flex-col gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>用户ID (临时)</label>
              <input type="text" value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="输入你的用户 ID" className="input-dark" required />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>内容</label>
              <textarea value={commentContent} onChange={e => setCommentContent(e.target.value)} placeholder="写下你的评论..." rows={4} className="input-dark" style={{ resize: 'none' }} required />
            </div>
            {submitError && <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{submitError}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={submitting} className="btn btn-primary">{submitting ? '提交中...' : '发表评论'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
