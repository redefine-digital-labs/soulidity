'use client'
import { useEffect, useState } from 'react'
import { parseTweetMeta } from '@web/lib/admin-tweet-review'

interface TweetItem {
  id: string
  title: string
  content: string | null
  url: string
  score: number
  status: string
  rawData: string | null
  createdAt: string
}

const CATEGORIES = ['MCP', 'Mac', 'Windows', 'Linux', 'Prompt', 'Agent调试', '其他']
const CONTENT_TYPES = ['教程', '踩坑记录', '最佳实践', '工具推荐']

export default function TweetsReviewPage() {
  const [items, setItems] = useState<TweetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [kbModal, setKbModal] = useState<{ id: string; content: string } | null>(null)
  const [kbForm, setKbForm] = useState({ category: CATEGORIES[0], contentType: CONTENT_TYPES[0], title: '' })

  async function fetchItems() {
    setLoading(true)
    const res = await fetch('/api/admin/tweets')
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchItems() }, [])

  async function handleApprove(id: string) {
    setActionLoading(id)
    const res = await fetch(`/api/admin/tweets/${id}/approve`, { method: 'POST' })
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id))
    } else {
      const err = await res.json()
      alert(err.error || 'Approve failed')
    }
    setActionLoading(null)
  }

  async function handleReject(id: string) {
    setActionLoading(id)
    const res = await fetch(`/api/admin/tweets/${id}/reject`, { method: 'POST' })
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id))
    }
    setActionLoading(null)
  }

  function openKbModal(item: TweetItem) {
    setKbForm({
      category: CATEGORIES[0],
      contentType: CONTENT_TYPES[0],
      title: (item.content ?? item.title).slice(0, 60),
    })
    setKbModal({ id: item.id, content: item.content ?? item.title })
  }

  async function handleSaveKb() {
    if (!kbModal) return
    setActionLoading(kbModal.id)
    const res = await fetch('/api/admin/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawItemId: kbModal.id,
        category: kbForm.category,
        contentType: kbForm.contentType,
        title: kbForm.title,
      }),
    })
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== kbModal.id))
      setKbModal(null)
    } else {
      const err = await res.json()
      alert(err.error || '保存失败')
    }
    setActionLoading(null)
  }

  if (loading) return <div className="max-w-4xl mx-auto p-6">Loading...</div>

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">推文审核</h1>
      {items.length === 0 ? (
        <p className="text-gray-500">没有待审核的推文</p>
      ) : (
        <div className="space-y-4">
          {items.map(item => {
            const meta = parseTweetMeta(item.rawData)
            const isProcessing = actionLoading === item.id
            return (
              <div key={item.id} className="border rounded-lg p-4 bg-white">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm">{meta?.author ?? 'unknown'}</span>
                      {meta?.display_name && (
                        <span className="text-gray-400 text-xs">{meta.display_name}</span>
                      )}
                      <span className="text-xs text-gray-400">
                        {meta?.tweet_type === 'SHORT' ? '短推' : '长推'}
                      </span>
                      <span className="text-xs text-gray-400">
                        Score: {item.score}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap mb-2">{item.content}</p>
                    <div className="flex gap-3 text-xs text-gray-400">
                      <span>❤️ {meta?.like_count ?? 0}</span>
                      <span>🔁 {meta?.retweet_count ?? 0}</span>
                      <span>💬 {meta?.reply_count ?? 0}</span>
                      <span>👁 {meta?.view_count ?? 0}</span>
                      <a href={item.url} target="_blank" rel="noopener" className="text-blue-500 hover:underline">
                        原文
                      </a>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {isProcessing ? '处理中...' : '通过'}
                    </button>
                    <button
                      onClick={() => handleReject(item.id)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      拒绝
                    </button>
                    <button
                      onClick={() => openKbModal(item)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      知识库
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {kbModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">存入知识库</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">标题</label>
                <input
                  type="text"
                  value={kbForm.title}
                  onChange={e => setKbForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">分类</label>
                <select
                  value={kbForm.category}
                  onChange={e => setKbForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">内容类型</label>
                <select
                  value={kbForm.contentType}
                  onChange={e => setKbForm(f => ({ ...f, contentType: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setKbModal(null)}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveKb}
                disabled={!kbForm.title || actionLoading === kbModal.id}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading === kbModal.id ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
