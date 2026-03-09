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

  async function fetchItems() { setLoading(true); const res = await fetch('/api/admin/tweets'); if (res.ok) setItems(await res.json()); setLoading(false) }
  useEffect(() => { fetchItems() }, [])

  async function handleApprove(id: string) {
    setActionLoading(id)
    const res = await fetch(`/api/admin/tweets/${id}/approve`, { method: 'POST' })
    if (res.ok) { setItems(prev => prev.filter(i => i.id !== id)) } else { const err = await res.json(); alert(err.error || '审核通过失败') }
    setActionLoading(null)
  }

  async function handleReject(id: string) {
    setActionLoading(id)
    const res = await fetch(`/api/admin/tweets/${id}/reject`, { method: 'POST' })
    if (res.ok) { setItems(prev => prev.filter(i => i.id !== id)) }
    setActionLoading(null)
  }

  function openKbModal(item: TweetItem) {
    setKbForm({ category: CATEGORIES[0], contentType: CONTENT_TYPES[0], title: (item.content ?? item.title).slice(0, 60) })
    setKbModal({ id: item.id, content: item.content ?? item.title })
  }

  async function handleSaveKb() {
    if (!kbModal) return
    setActionLoading(kbModal.id)
    const res = await fetch('/api/admin/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawItemId: kbModal.id, category: kbForm.category, contentType: kbForm.contentType, title: kbForm.title }) })
    if (res.ok) { setItems(prev => prev.filter(i => i.id !== kbModal.id)); setKbModal(null) } else { const err = await res.json(); alert(err.error || '保存失败') }
    setActionLoading(null)
  }

  if (loading) return <div className="max-w-5xl mx-auto px-6 py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>推文审核</h1>
      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>没有待审核的推文</p>
      ) : (
        <div className="flex flex-col gap-3 stagger-children">
          {items.map(item => {
            const meta = parseTweetMeta(item.rawData)
            const isProcessing = actionLoading === item.id
            return (
              <div key={item.id} className="glass-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm" style={{ color: 'var(--accent-cyan)' }}>{meta?.author ?? '未知'}</span>
                      {meta?.display_name && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{meta.display_name}</span>}
                      <span className="badge badge-muted">{meta?.tweet_type === 'SHORT' ? '短推' : '长推'}</span>
                      <span className="text-xs data-value" style={{ color: 'var(--text-muted)' }}>评分: {item.score}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap mb-2" style={{ color: 'var(--text-secondary)' }}>{item.content}</p>
                    <div className="flex gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>❤️ {meta?.like_count ?? 0}</span>
                      <span>🔁 {meta?.retweet_count ?? 0}</span>
                      <span>💬 {meta?.reply_count ?? 0}</span>
                      <span>👁 {meta?.view_count ?? 0}</span>
                      <a href={item.url} target="_blank" rel="noopener" style={{ color: 'var(--accent-cyan)' }}>原文 ↗</a>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleApprove(item.id)} disabled={isProcessing} className="btn btn-success text-xs">{isProcessing ? '处理中...' : '通过'}</button>
                    <button onClick={() => handleReject(item.id)} disabled={isProcessing} className="btn btn-danger text-xs">拒绝</button>
                    <button onClick={() => openKbModal(item)} disabled={isProcessing} className="btn btn-primary text-xs">存入知识库</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* KB Modal */}
      {kbModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-panel p-6 w-full max-w-md animate-fade-up">
            <h2 className="text-lg font-bold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>存入知识库</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标题</label>
                <input type="text" value={kbForm.title} onChange={e => setKbForm(f => ({ ...f, title: e.target.value }))} className="input-dark" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>分类</label>
                <select value={kbForm.category} onChange={e => setKbForm(f => ({ ...f, category: e.target.value }))} className="input-dark">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>内容类型</label>
                <select value={kbForm.contentType} onChange={e => setKbForm(f => ({ ...f, contentType: e.target.value }))} className="input-dark">{CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setKbModal(null)} className="btn btn-surface">取消</button>
              <button onClick={handleSaveKb} disabled={!kbForm.title || actionLoading === kbModal.id} className="btn btn-primary">{actionLoading === kbModal.id ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
