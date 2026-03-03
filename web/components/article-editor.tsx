'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Company {
  id: string
  name: string
  slug: string
  category: string
}

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
    await fetch(`/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    router.refresh()
  }

  async function setStatus(status: string) {
    await fetch(`/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    router.refresh()
    router.push('/dashboard')
  }

  async function publish() {
    await fetch(`/api/articles/${article.id}/publish`, { method: 'POST' })
    router.refresh()
    router.push('/dashboard')
  }

  return (
    <div className="space-y-6">
      {/* Meta info */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span className="px-2 py-0.5 bg-gray-100 rounded">{form.status}</span>
        {article.source_name && <span>Source: {article.source_name}</span>}
        {article.source_url && <a href={article.source_url} target="_blank" className="text-blue-500 hover:underline">Original</a>}
        <span>{new Date(article.createdAt).toLocaleString()}</span>
      </div>

      {/* Editor */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">标题</label>
          <input className="w-full border rounded px-3 py-2" value={form.titleZh} onChange={e => update('titleZh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">摘要</label>
          <textarea className="w-full border rounded px-3 py-2 h-32" value={form.summaryZh} onChange={e => update('summaryZh', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">解读</label>
          <textarea className="w-full border rounded px-3 py-2 h-32" value={form.analysisZh ?? ''} onChange={e => update('analysisZh', e.target.value)} />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
        <input
          className="w-full border rounded px-3 py-2"
          value={form.tags ? JSON.parse(form.tags).join(', ') : ''}
          onChange={e => update('tags', JSON.stringify(e.target.value.split(',').map(t => t.trim()).filter(Boolean)))}
        />
      </div>

      {/* Companies */}
      {article.companies && article.companies.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2">关联公司</label>
          <div className="flex flex-wrap gap-2">
            {article.companies.map(c => (
              <span key={c.id} className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm">
                {c.name}
                <span className="text-indigo-400 text-xs">({c.category})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
        {form.status === 'draft' && (
          <button onClick={() => setStatus('reviewed')} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500">
            Approve
          </button>
        )}
        {(form.status === 'draft' || form.status === 'reviewed') && (
          <button onClick={publish} className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500">
            Publish to TG
          </button>
        )}
        {form.status === 'draft' && (
          <button onClick={() => setStatus('rejected')} className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200">
            Reject
          </button>
        )}
        <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
          Back
        </button>
      </div>
    </div>
  )
}
