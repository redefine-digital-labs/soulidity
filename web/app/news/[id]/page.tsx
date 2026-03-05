import { prisma } from '@web/lib/prisma'
import { PublicNav } from '@web/components/public-nav'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

const ROLE_ICONS: Record<string, string> = {
  scout: '🕵️',
  reporter: '📝',
  analyst: '🔍',
  editor: '✅',
  publisher: '📢',
}

export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      rawItem: { select: { url: true, sourceName: true, title: true } },
      companies: { include: { company: { select: { name: true, category: true } } } },
      processLogs: {
        include: { role: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!article) notFound()

  const tags: string[] = article.tags ? JSON.parse(article.tags) : []

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <h1 className="text-2xl font-bold text-gray-900">{article.titleZh}</h1>
        <div className="mt-2 flex items-center gap-2 flex-wrap text-sm text-gray-500">
          <span>{new Date(article.createdAt).toLocaleString('zh-CN')}</span>
          {article.rawItem.sourceName && (
            <>
              <span>&middot;</span>
              <span>{article.rawItem.sourceName}</span>
            </>
          )}
          {article.rawItem.url && (
            <>
              <span>&middot;</span>
              <a href={article.rawItem.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">原文链接</a>
            </>
          )}
        </div>

        {/* Tags & Companies */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {article.companies.map(ac => (
            <span key={ac.companyId} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-sm">{ac.company.name}</span>
          ))}
          {tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-sm">{tag}</span>
          ))}
        </div>

        {/* Article body */}
        <div className="mt-6 bg-white rounded-lg p-6 shadow-sm border">
          <p className="text-gray-800 leading-relaxed font-medium">{article.summaryZh}</p>
          {article.analysisZh && (
            <div className="mt-4 text-gray-700 leading-relaxed whitespace-pre-line">{article.analysisZh}</div>
          )}
        </div>

        {/* Agent Process Logs */}
        {article.processLogs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">AI Agent 处理流程</h2>
            <div className="space-y-3">
              {article.processLogs.map(log => {
                const icon = ROLE_ICONS[log.role.name] ?? '🤖'
                const output = log.output ? JSON.parse(log.output) : null
                return (
                  <details key={log.id} className="bg-white rounded-lg shadow-sm border">
                    <summary className="p-4 cursor-pointer flex items-center gap-3">
                      <span className="text-xl">{icon}</span>
                      <span className="font-medium">{log.role.label}</span>
                      <span className={`ml-auto px-2 py-0.5 rounded text-xs ${
                        log.status === 'completed' ? 'bg-green-100 text-green-700' :
                        log.status === 'running' ? 'bg-yellow-100 text-yellow-700' :
                        log.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {log.status}
                      </span>
                      {log.completedAt && log.startedAt && (
                        <span className="text-xs text-gray-400">
                          {((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000).toFixed(1)}s
                        </span>
                      )}
                    </summary>
                    {output && (
                      <div className="px-4 pb-4 text-sm text-gray-600">
                        <pre className="bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
                      </div>
                    )}
                  </details>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
