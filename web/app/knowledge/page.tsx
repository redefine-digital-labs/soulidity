'use client'
import { useEffect, useState } from 'react'
import { PublicNav } from '@web/components/public-nav'

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  category: string
  contentType: string
  createdAt: string
  sources: Array<{ rawItem: { url: string; sourceName: string } }>
}

const CATEGORIES = ['MCP', 'Mac', 'Windows', 'Linux', 'Prompt', 'Agent调试', '其他']
const CONTENT_TYPES = ['教程', '踩坑记录', '最佳实践', '工具推荐']

const TYPE_BADGE: Record<string, string> = {
  '教程': 'badge-cyan',
  '踩坑记录': 'badge-rose',
  '最佳实践': 'badge-emerald',
  '工具推荐': 'badge-amber',
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [contentType, setContentType] = useState('')
  const [search, setSearch] = useState('')

  async function fetchEntries() {
    setLoading(true)
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (contentType) params.set('contentType', contentType)
    if (search) params.set('q', search)
    const res = await fetch(`/api/knowledge?${params}`)
    if (res.ok) setEntries(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchEntries() }, [category, contentType])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    fetchEntries()
  }

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">OpenClaw 知识库</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>配置技巧、踩坑记录、最佳实践</p>
        </div>

        <div className="flex flex-wrap gap-3 mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <select value={category} onChange={e => setCategory(e.target.value)} className="input-dark" style={{ width: 'auto' }}>
            <option value="">全部分类</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={contentType} onChange={e => setContentType(e.target.value)} className="input-dark" style={{ width: 'auto' }}>
            <option value="">全部类型</option>
            {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索..." className="input-dark" style={{ width: '12rem' }} />
            <button type="submit" className="btn btn-primary">搜索</button>
          </form>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>暂无内容</p>
        ) : (
          <div className="flex flex-col gap-3 stagger-children">
            {entries.map(entry => (
              <div key={entry.id} className="glass-card p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="badge badge-blue">{entry.category}</span>
                  <span className={`badge ${TYPE_BADGE[entry.contentType] ?? 'badge-muted'}`}>{entry.contentType}</span>
                  <span className="text-xs data-value ml-auto" style={{ color: 'var(--text-muted)' }}>
                    {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <h2 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{entry.title}</h2>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {entry.content.length > 200 ? entry.content.slice(0, 200) + '...' : entry.content}
                </p>
                {entry.sources.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    {entry.sources.map((s, i) => (
                      <a key={i} href={s.rawItem.url} target="_blank" rel="noopener" className="text-xs transition-colors" style={{ color: 'var(--accent-cyan)' }}>
                        来源: {s.rawItem.sourceName} ↗
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
