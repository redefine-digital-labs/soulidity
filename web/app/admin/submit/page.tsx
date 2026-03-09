'use client'
import { useState } from 'react'
import Link from 'next/link'

type Tab = 'url' | 'markdown'

export default function SubmitPage() {
  const [tab, setTab] = useState<Tab>('url')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; articleId?: string; title?: string; error?: string } | null>(null)

  async function handleSubmit() {
    if (!url.trim()) return
    if (tab === 'markdown' && (!title.trim() || !content.trim())) return

    setLoading(true)
    setResult(null)

    try {
      const body = tab === 'url'
        ? { url: url.trim() }
        : { url: url.trim(), title: title.trim(), content: content.trim() }

      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (res.ok) {
        setResult({ success: true, articleId: data.articleId, title: data.title })
        setUrl('')
        setTitle('')
        setContent('')
      } else {
        setResult({ success: false, error: data.error })
      }
    } catch {
      setResult({ success: false, error: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">Submit Content</span>
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 animate-fade-up" style={{ animationDelay: '50ms' }}>
        <button
          onClick={() => setTab('url')}
          className={`filter-pill ${tab === 'url' ? 'filter-pill-active' : ''}`}
        >
          Paste URL
        </button>
        <button
          onClick={() => setTab('markdown')}
          className={`filter-pill ${tab === 'markdown' ? 'filter-pill-active' : ''}`}
        >
          Upload Markdown
        </button>
      </div>

      {/* Form */}
      <div className="glass-panel p-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>URL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="input-dark"
            />
          </div>

          {tab === 'markdown' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Article title"
                  className="input-dark"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Content (Markdown)</label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Paste markdown content here..."
                  rows={12}
                  className="input-dark"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}
                />
              </div>
            </>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !url.trim() || (tab === 'markdown' && (!title.trim() || !content.trim()))}
            className="btn btn-primary"
          >
            {loading ? 'Processing...' : 'Submit'}
          </button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div
          className="mt-6 glass-panel p-4 animate-fade-up"
          style={{
            borderColor: result.success ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 113, 133, 0.3)',
            background: result.success ? 'var(--accent-emerald-dim)' : 'var(--accent-rose-dim)',
          }}
        >
          {result.success ? (
            <p style={{ color: 'var(--accent-emerald)' }}>
              Article created:{' '}
              <Link href={`/admin/articles/${result.articleId}`} className="font-medium underline">
                {result.title}
              </Link>
            </p>
          ) : (
            <p style={{ color: 'var(--accent-rose)' }}>{result.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
