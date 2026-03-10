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

interface DirectionOption {
  id: string
  name: string
  nameZh: string
  icon: string
  category: { id: string; name: string; nameZh: string; icon: string }
}

interface CategoryOption {
  id: string
  name: string
  nameZh: string
  icon: string
}

const CATEGORIES = ['MCP', 'Mac', 'Windows', 'Linux', 'Prompt', 'Agent调试', '其他']
const CONTENT_TYPES = ['教程', '踩坑记录', '最佳实践', '工具推荐']

export default function TweetsReviewPage() {
  const [items, setItems] = useState<TweetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [kbModal, setKbModal] = useState<{ id: string; content: string } | null>(null)
  const [kbForm, setKbForm] = useState({ category: CATEGORIES[0], contentType: CONTENT_TYPES[0], title: '' })

  // Direction state
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [selectedDirection, setSelectedDirection] = useState<Record<string, string>>({}) // itemId -> directionId
  const [lastUsedDirectionId, setLastUsedDirectionId] = useState<string>('')
  const [showNewDirModal, setShowNewDirModal] = useState<string | null>(null) // itemId that triggered the modal
  const [dirCategories, setDirCategories] = useState<CategoryOption[]>([])
  const [newDirForm, setNewDirForm] = useState({ categoryId: '', name: '', nameZh: '', icon: '🔧' })
  const [newDirLoading, setNewDirLoading] = useState(false)

  async function fetchItems() { setLoading(true); const res = await fetch('/api/admin/tweets'); if (res.ok) setItems(await res.json()); setLoading(false) }
  async function fetchDirCategories() {
    const res = await fetch('/api/admin/categories')
    if (res.ok) {
      const categories = await res.json()
      setDirCategories(categories)
      return categories as CategoryOption[]
    }
    return []
  }

  async function fetchDirections() {
    const res = await fetch('/api/admin/directions')
    if (res.ok) {
      setDirections(await res.json())
    }
  }

  useEffect(() => { void Promise.all([fetchItems(), fetchDirections(), fetchDirCategories()]) }, [])

  // Auto-select when there's only one direction
  useEffect(() => {
    if (directions.length === 1 && items.length > 0) {
      const defaultId = directions[0].id
      setSelectedDirection(prev => {
        const updated = { ...prev }
        for (const item of items) {
          if (!updated[item.id]) updated[item.id] = defaultId
        }
        return updated
      })
    }
  }, [directions, items])

  async function handleApprove(id: string) {
    const directionId = selectedDirection[id]
    if (!directionId) { alert('请先选择关联方向'); return }
    setActionLoading(id)
    const res = await fetch(`/api/admin/tweets/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directionId }),
    })
    if (res.ok) {
      setLastUsedDirectionId(directionId)
      setItems(prev => {
        const remaining = prev.filter(i => i.id !== id)
        // Auto-fill last used direction for remaining items that haven't been assigned
        const updated: Record<string, string> = {}
        for (const item of remaining) {
          if (!selectedDirection[item.id]) updated[item.id] = directionId
        }
        if (Object.keys(updated).length > 0) {
          setSelectedDirection(prev => ({ ...prev, ...updated }))
        }
        return remaining
      })
    } else { const err = await res.json(); alert(err.error || '审核通过失败') }
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

  async function openNewDirModal(itemId: string) {
    const categories = dirCategories.length > 0 ? dirCategories : await fetchDirCategories()
    setShowNewDirModal(itemId)
    setNewDirForm({ categoryId: categories[0]?.id ?? '', name: '', nameZh: '', icon: '🔧' })
  }


  async function handleCreateDirection() {
    if (dirCategories.length === 0) { alert('暂无可选分类，请先到方向管理中创建分类'); return }
    if (!newDirForm.categoryId) { alert('请选择所属分类'); return }
    if (!newDirForm.name) { alert('请填写英文名'); return }
    if (!newDirForm.nameZh) { alert('请填写中文名'); return }
    setNewDirLoading(true)
    try {
      const res = await fetch('/api/admin/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDirForm),
      })
      if (res.ok) {
        const created = await res.json()
        await Promise.all([fetchDirections(), fetchDirCategories()])
        if (showNewDirModal) {
          setSelectedDirection(prev => ({ ...prev, [showNewDirModal]: created.id }))
        }
        setShowNewDirModal(null)
      } else {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        alert(err.error || '创建失败')
      }
    } catch (e: unknown) {
      alert('网络错误: ' + (e instanceof Error ? e.message : '请重试'))
    }
    setNewDirLoading(false)
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
            const dirId = selectedDirection[item.id]
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
                    {/* Direction selector */}
                    <div className="flex items-center gap-2 mt-3">
                      <select
                        value={dirId ?? ''}
                        onChange={e => setSelectedDirection(prev => ({ ...prev, [item.id]: e.target.value }))}
                        className="input-dark text-sm flex-1"
                        style={{ maxWidth: 280 }}
                      >
                        <option value="" disabled>选择关联方向（必选）</option>
                        {directions.map(d => (
                          <option key={d.id} value={d.id}>{d.icon} {d.nameZh} ({d.name})</option>
                        ))}
                      </select>
                      <button onClick={() => openNewDirModal(item.id)} className="btn btn-surface text-xs" style={{ whiteSpace: 'nowrap' }}>+ 新建</button>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleApprove(item.id)} disabled={isProcessing || !dirId} className="btn btn-success text-xs">{isProcessing ? '处理中...' : '通过'}</button>
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

      {/* New Direction Modal */}
      {showNewDirModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-panel p-6 w-full max-w-md animate-fade-up">
            <h2 className="text-lg font-bold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>新建方向</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>所属分类</label>
                <select value={newDirForm.categoryId} onChange={e => setNewDirForm(f => ({ ...f, categoryId: e.target.value }))} className="input-dark">
                  {dirCategories.length === 0 && <option value="">暂无分类</option>}
                  {dirCategories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.nameZh}</option>)}
                </select>
                {dirCategories.length === 0 && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    请先到 /admin/directions 页面创建分类，再回来新建方向。
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>英文名</label>
                <input type="text" value={newDirForm.name} onChange={e => setNewDirForm(f => ({ ...f, name: e.target.value }))} className="input-dark" placeholder="e.g. Claude Code" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>中文名</label>
                <input type="text" value={newDirForm.nameZh} onChange={e => setNewDirForm(f => ({ ...f, nameZh: e.target.value }))} className="input-dark" placeholder="e.g. Claude 编程助手" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>图标</label>
                <input type="text" value={newDirForm.icon} onChange={e => setNewDirForm(f => ({ ...f, icon: e.target.value }))} className="input-dark" placeholder="🔧" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewDirModal(null)} className="btn btn-surface">取消</button>
              <button onClick={handleCreateDirection} disabled={newDirLoading || dirCategories.length === 0} className="btn btn-primary">{newDirLoading ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
