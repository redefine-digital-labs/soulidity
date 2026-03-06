'use client'
import { useEffect, useState, useCallback } from 'react'
import { PublicNav } from '@web/components/public-nav'
import Link from 'next/link'

const ROLE_ICONS: Record<string, string> = {
  scout: '🕵️',
  reporter: '📝',
  analyst: '🔍',
  editor: '✅',
  publisher: '📢',
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500',
  running: 'bg-yellow-400 animate-pulse',
  failed: 'bg-red-500',
  pending: 'bg-gray-300',
}

interface ProcessLog {
  id: string
  status: string
  startedAt: string | null
  completedAt: string | null
  role: { name: string; label: string; sortOrder: number }
}

interface PipelineArticle {
  id: string
  titleZh: string
  pipelineStatus: string
  createdAt: string
  rawItem: { title: string; sourceName: string; score: number }
  processLogs: ProcessLog[]
}

export default function PipelinePage() {
  const [articles, setArticles] = useState<PipelineArticle[]>([])

  const fetchData = useCallback(() => {
    fetch('/api/pipeline').then(r => r.ok ? r.json() : []).then(setArticles)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const roles = ['scout', 'reporter', 'analyst', 'editor', 'publisher']

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Agent Pipeline</h1>
        <p className="text-sm text-gray-500 mb-6">实时查看 AI Agent 新闻处理流水线</p>

        {/* Role legend */}
        <div className="flex gap-4 mb-6 text-sm">
          {roles.map(r => (
            <span key={r} className="flex items-center gap-1">
              <span>{ROLE_ICONS[r]}</span>
              <span className="text-gray-600 capitalize">{r}</span>
            </span>
          ))}
        </div>

        {/* Pipeline table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="p-3">新闻</th>
                {roles.map(r => (
                  <th key={r} className="p-3 text-center w-20">
                    <span className="text-lg">{ROLE_ICONS[r]}</span>
                  </th>
                ))}
                <th className="p-3 text-center w-20">状态</th>
              </tr>
            </thead>
            <tbody>
              {articles.map(article => (
                <tr key={article.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/news/${article.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 line-clamp-1">
                      {article.titleZh}
                    </Link>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {article.rawItem.sourceName} &middot; {new Date(article.createdAt).toLocaleTimeString('zh-CN')}
                    </div>
                  </td>
                  {roles.map(roleName => {
                    const log = article.processLogs.find(l => l.role.name === roleName)
                    const status = log?.status ?? 'pending'
                    return (
                      <td key={roleName} className="p-3 text-center">
                        <div className={`w-4 h-4 rounded-full mx-auto ${STATUS_COLORS[status] ?? STATUS_COLORS.pending}`} title={status} />
                      </td>
                    )
                  })}
                  <td className="p-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      article.pipelineStatus === 'completed' ? 'bg-green-100 text-green-700' :
                      article.pipelineStatus === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {article.pipelineStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
