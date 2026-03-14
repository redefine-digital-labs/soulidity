'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'
import { useAuth } from '@web/components/auth-provider'

function NewPostForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading, getAuthHeaders } = useAuth()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [postType, setPostType] = useState<'log' | 'question'>(
    (searchParams.get('type') as 'log' | 'question') ?? 'log'
  )
  const [tags, setTags] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body: Record<string, string> = { title, content, type: postType }
      if (tags.trim()) body.tags = tags.trim()
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/community/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(body) })
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || `发布失败 (${res.status})`); return }
      const post = await res.json()
      router.push(`/community/${post.id}`)
    } catch { setError('网络错误，请重试') } finally { setLoading(false) }
  }

  if (authLoading) {
    return <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  if (!user) {
    return (
      <div className="glass-panel p-6 animate-fade-up text-center">
        <p className="text-lg mb-4" style={{ color: 'var(--text-secondary)' }}>请先登录后再发帖</p>
        <Link href="/login" className="btn btn-primary inline-block">去登录</Link>
      </div>
    )
  }

  return (
    <div className="glass-panel p-6 animate-fade-up">
      <h1 className="text-xl font-bold mb-6" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        {postType === 'question' ? '提出问题' : '发布日志'}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Type selector */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setPostType('log')} className={`filter-pill ${postType === 'log' ? 'filter-pill-active' : ''}`}>📝 日志</button>
          <button type="button" onClick={() => setPostType('question')} className={`filter-pill ${postType === 'question' ? 'filter-pill-active' : ''}`}>❓ 问答</button>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标题 <span style={{ color: 'var(--accent-rose)' }}>*</span></label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder={postType === 'question' ? '你的问题是...' : '帖子标题'} required className="input-dark" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>内容 <span style={{ color: 'var(--accent-rose)' }}>*</span></label>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder={postType === 'question' ? '详细描述你的问题，以便他人帮助你...' : '写下你的内容...'} required rows={8} className="input-dark" style={{ resize: 'vertical' }} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标签 (可选)</label>
          <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="用逗号分隔，例如：DeFi,NFT,Sui" className="input-dark" />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>}
        <button type="submit" disabled={loading || !title || !content} className="btn btn-primary w-full">
          {loading ? '发布中...' : '发布'}
        </button>
      </form>
    </div>
  )
}

export default function NewCommunityPostPage() {
  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-6">
          <Link href="/community" className="text-sm transition-colors" style={{ color: 'var(--text-muted)' }}>← 返回社区</Link>
        </div>
        <Suspense fallback={<div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>}>
          <NewPostForm />
        </Suspense>
      </div>
    </div>
  )
}
