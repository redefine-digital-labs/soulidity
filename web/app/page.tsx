import { prisma } from '@web/lib/prisma'
import { PublicNav } from '@web/components/public-nav'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const articles = await prisma.article.findMany({
    where: { status: 'published' },
    include: {
      rawItem: { select: { url: true, sourceName: true } },
      companies: { include: { company: { select: { name: true, category: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return (
    <div className="min-h-screen">
      <PublicNav />

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Hero section */}
        <div className="mb-10 animate-fade-up">
          <h1 className="text-4xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">最新资讯</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem' }}>
            AI 多智能体流水线驱动的加密货币与 Web3 情报
          </p>
        </div>

        {/* Article list */}
        <div className="flex flex-col gap-3 stagger-children">
          {articles.map(article => {
            const tags: string[] = article.tags ? JSON.parse(article.tags) : []
            return (
              <article key={article.id} className="glass-card glow-cyan p-5 group">
                <Link href={`/news/${article.id}`} className="block">
                  <h2 className="text-lg font-semibold mb-2 transition-colors group-hover:text-[var(--accent-cyan)]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                    {article.titleZh}
                  </h2>
                  <p className="text-sm leading-relaxed line-clamp-2 mb-3" style={{ color: 'var(--text-secondary)' }}>
                    {article.summaryZh}
                  </p>
                </Link>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="data-value text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(article.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  {article.rawItem.sourceName && (
                    <>
                      <span style={{ color: 'var(--border-default)' }}>·</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{article.rawItem.sourceName}</span>
                    </>
                  )}
                  {article.rawItem.url && (
                    <>
                      <span style={{ color: 'var(--border-default)' }}>·</span>
                      <a href={article.rawItem.url} target="_blank" rel="noopener noreferrer" className="text-xs transition-colors" style={{ color: 'var(--accent-cyan)' }}>
                        原文
                      </a>
                    </>
                  )}
                  {article.companies.map(ac => (
                    <span key={ac.companyId} className="badge badge-violet">{ac.company.name}</span>
                  ))}
                  {tags.map(tag => (
                    <span key={tag} className="badge badge-muted">{tag}</span>
                  ))}
                </div>
              </article>
            )
          })}
          {articles.length === 0 && (
            <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>暂无已发布的资讯</div>
          )}
        </div>
      </div>
    </div>
  )
}
