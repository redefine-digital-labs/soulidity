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

const ROLE_COLORS: Record<string, string> = {
  scout: 'var(--accent-amber)',
  reporter: 'var(--accent-cyan)',
  analyst: 'var(--accent-violet)',
  editor: 'var(--accent-emerald)',
  publisher: 'var(--accent-blue)',
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
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="animate-fade-up">
          <h1 className="text-3xl font-bold mb-4 leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {article.titleZh}
          </h1>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="data-value text-sm" style={{ color: 'var(--text-muted)' }}>
              {new Date(article.createdAt).toLocaleString('zh-CN')}
            </span>
            {article.rawItem.sourceName && (
              <>
                <span style={{ color: 'var(--border-default)' }}>·</span>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{article.rawItem.sourceName}</span>
              </>
            )}
            {article.rawItem.url && (
              <>
                <span style={{ color: 'var(--border-default)' }}>·</span>
                <a href={article.rawItem.url} target="_blank" rel="noopener noreferrer" className="text-sm" style={{ color: 'var(--accent-cyan)' }}>
                  原文链接 ↗
                </a>
              </>
            )}
          </div>

          {/* Tags & Companies */}
          <div className="flex items-center gap-2 flex-wrap mb-8">
            {article.companies.map(ac => (
              <span key={ac.companyId} className="badge badge-violet">{ac.company.name}</span>
            ))}
            {tags.map(tag => (
              <span key={tag} className="badge badge-muted">{tag}</span>
            ))}
          </div>
        </div>

        {/* Article body */}
        <div className="glass-panel p-6 mb-8 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <p className="text-base leading-relaxed font-medium" style={{ color: 'var(--text-primary)' }}>{article.summaryZh}</p>
          {article.analysisZh && (
            <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>{article.analysisZh}</p>
            </div>
          )}
        </div>

        {/* Agent Process Logs */}
        {article.processLogs.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              AI Agent 处理流程
            </h2>
            <div className="flex flex-col gap-2">
              {article.processLogs.map(log => {
                const icon = ROLE_ICONS[log.role.name] ?? '🤖'
                const accentColor = ROLE_COLORS[log.role.name] ?? 'var(--text-muted)'
                const output = log.output ? JSON.parse(log.output) : null
                const statusBadge = log.status === 'completed' ? 'badge-emerald'
                  : log.status === 'running' ? 'badge-amber'
                  : log.status === 'failed' ? 'badge-rose'
                  : 'badge-muted'

                return (
                  <details key={log.id} className="glass-panel overflow-hidden group">
                    <summary className="p-4 cursor-pointer flex items-center gap-3 select-none" style={{ listStyle: 'none' }}>
                      <span className="text-xl">{icon}</span>
                      <span className="font-medium text-sm" style={{ color: accentColor }}>{log.role.label}</span>
                      <span className={`badge ${statusBadge} ml-auto`}>{log.status}</span>
                      {log.completedAt && log.startedAt && (
                        <span className="data-value text-xs" style={{ color: 'var(--text-muted)' }}>
                          {((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000).toFixed(1)}s
                        </span>
                      )}
                      <svg className="w-4 h-4 transition-transform group-open:rotate-90" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </summary>
                    {output && (
                      <div className="px-4 pb-4">
                        <pre className="text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {JSON.stringify(output, null, 2)}
                        </pre>
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
