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
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Submit Content</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setTab('url')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'url' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Paste URL
        </button>
        <button
          onClick={() => setTab('markdown')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'markdown' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Upload Markdown
        </button>
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>

        {tab === 'markdown' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Article title"
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Content (Markdown)</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Paste markdown content here..."
                rows={12}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-gray-900 font-mono text-sm"
              />
            </div>
          </>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !url.trim() || (tab === 'markdown' && (!title.trim() || !content.trim()))}
          className="px-6 py-2 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing...' : 'Submit'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`mt-6 p-4 rounded ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          {result.success ? (
            <p className="text-green-800">
              Article created:{' '}
              <Link href={`/admin/articles/${result.articleId}`} className="font-medium underline">
                {result.title}
              </Link>
            </p>
          ) : (
            <p className="text-red-800">{result.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
