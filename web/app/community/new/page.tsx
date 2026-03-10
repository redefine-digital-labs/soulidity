'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface DirectionOption {
  id: string
  nameZh: string
  icon: string
  slug?: string
}

export default function NewCommunityPostPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [memberId, setMemberId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [directionId, setDirectionId] = useState('')
  const [postType, setPostType] = useState<'log' | 'question'>(
    (searchParams.get('type') as 'log' | 'question') ?? 'log'
  )
  const [tags, setTags] = useState('')
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/directions').then(r => (r.ok ? r.json() : [])).then((data: DirectionOption[]) => {
      setDirections(data)
      const dirSlug = searchParams.get('direction')
      if (dirSlug) {
        const match = data.find((d: DirectionOption) => d.slug === dirSlug)
        if (match) setDirectionId(match.id)
      }
    }).catch(() => setDirections([]))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body: Record<string, string> = { memberId, title, content, type: postType }
      if (directionId) body.directionId = directionId
      if (tags.trim()) body.tags = tags.trim()
      const res = await fetch('/api/community/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || `发布失败 (${res.status})`); return }
      const post = await res.json()
      router.push(`/community/${post.id}`)
    } catch { setError('网络错误，请重试') } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-6">
          <Link href="/community" className="text-sm transition-colors" style={{ color: 'var(--text-muted)' }}>← 返回社区</Link>
        </div>
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
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>用户ID (临时)</label>
              <input type="text" value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="粘贴你的成员 UUID" required className="input-dark" />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>临时字段，auth 集成后将自动填充</p>
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
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>方向 (可选)</label>
              <select value={directionId} onChange={e => setDirectionId(e.target.value)} className="input-dark">
                <option value="">不关联方向</option>
                {directions.map(d => <option key={d.id} value={d.id}>{d.icon} {d.nameZh}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标签 (可选)</label>
              <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="用逗号分隔，例如：DeFi,NFT,Sui" className="input-dark" />
            </div>
            {error && <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>}
            <button type="submit" disabled={loading || !memberId || !title || !content} className="btn btn-primary w-full">
              {loading ? '发布中...' : '发布'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
