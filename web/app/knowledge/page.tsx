'use client'
import { useEffect, useState } from 'react'

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  category: string
  contentType: string
  createdAt: string
  sources: Array<{
    rawItem: { url: string; sourceName: string }
  }>
}

const CATEGORIES = ['MCP', 'Mac', 'Windows', 'Linux', 'Prompt', 'Agent调试', '其他']
const CONTENT_TYPES = ['教程', '踩坑记录', '最佳实践', '工具推荐']

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
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">OpenClaw 知识库</h1>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">全部分类</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={contentType}
          onChange={e => setContentType(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">全部类型</option>
          {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索..."
            className="border rounded px-3 py-2 text-sm w-48"
          />
          <button type="submit" className="px-3 py-2 text-sm bg-gray-800 text-white rounded hover:bg-gray-900">
            搜索
          </button>
        </form>
      </div>

      {loading ? (
        <p className="text-gray-500">加载中...</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-500">暂无内容</p>
      ) : (
        <div className="space-y-4">
          {entries.map(entry => (
            <div key={entry.id} className="border rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">{entry.category}</span>
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">{entry.contentType}</span>
                <span className="text-xs text-gray-400">
                  {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
              <h2 className="font-medium mb-2">{entry.title}</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {entry.content.length > 200 ? entry.content.slice(0, 200) + '...' : entry.content}
              </p>
              {entry.sources.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {entry.sources.map((s, i) => (
                    <a
                      key={i}
                      href={s.rawItem.url}
                      target="_blank"
                      rel="noopener"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      来源: {s.rawItem.sourceName}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
