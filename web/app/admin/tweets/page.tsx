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

export default function TweetsReviewPage() {
  const [items, setItems] = useState<TweetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

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
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
