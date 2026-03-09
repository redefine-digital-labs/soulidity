'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Company { id: string; name: string; slug: string; category: string }

interface Article {
  id: string
  titleZh: string
  summaryZh: string
  analysisZh: string | null
  tags: string | null
  companies?: Company[]
  status: string
  source_url?: string
  source_name?: string
  createdAt: string
}

export function ArticleEditor({ article }: { article: Article }) {
  const router = useRouter()
  const [form, setForm] = useState(article)
  const [saving, setSaving] = useState(false)

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  async function save() {
    setSaving(true)
    await fetch(`/api/articles/${article.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false)
    router.refresh()
  }

  async function setStatus(status: string) {
    await fetch(`/api/articles/${article.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    router.refresh()
    router.push('/admin')
  }

  async function publish() {
    await fetch(`/api/articles/${article.id}/publish`, { method: 'POST' })
    router.refresh()
    router.push('/admin')
  }

  return (
    <div className="space-y-6">
      {/* Meta info */}
      <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        <span className="badge badge-muted">{form.status}</span>
        {article.source_name && <span>Source: {article.source_name}</span>}
        {article.source_url && <a href={article.source_url} target="_blank" style={{ color: 'var(--accent-cyan)' }}>Original ↗</a>}
        <span className="data-value">{new Date(article.createdAt).toLocaleString()}</span>
      </div>

      {/* Editor */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标题</label>
          <input className="input-dark" value={form.titleZh} onChange={e => update('titleZh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>摘要</label>
          <textarea className="input-dark" style={{ height: '8rem', resize: 'vertical' }} value={form.summaryZh} onChange={e => update('summaryZh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>解读</label>
          <textarea className="input-dark" style={{ height: '8rem', resize: 'vertical' }} value={form.analysisZh ?? ''} onChange={e => update('analysisZh', e.target.value)} />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Tags (comma separated)</label>
        <input className="input-dark" value={form.tags ? JSON.parse(form.tags).join(', ') : ''} onChange={e => update('tags', JSON.stringify(e.target.value.split(',').map(t => t.trim()).filter(Boolean)))} />
      </div>

      {/* Companies */}
      {article.companies && article.companies.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>关联公司</label>
          <div className="flex flex-wrap gap-2">
            {article.companies.map(c => (
              <span key={c.id} className="badge badge-violet">{c.name} <span style={{ opacity: 0.6 }}>({c.category})</span></span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? 'Saving...' : 'Save'}</button>
        {form.status === 'draft' && <button onClick={publish} className="btn" style={{ background: 'var(--accent-violet-dim)', color: 'var(--accent-violet)', border: '1px solid rgba(167,139,250,0.2)' }}>Publish to TG</button>}
        {form.status === 'draft' && <button onClick={() => setStatus('rejected')} className="btn btn-danger">Reject</button>}
        <button onClick={() => router.push('/admin')} className="btn btn-surface">Back</button>
      </div>
    </div>
  )
}
