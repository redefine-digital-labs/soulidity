import { prisma } from '@web/lib/prisma'
import { PublicNav } from '@web/components/public-nav'

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
    <div className="min-h-screen bg-gray-50">
      <PublicNav />

      {/* Article list */}
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Latest News</h1>
        <div className="space-y-3">
          {articles.map(article => {
            const tags: string[] = article.tags ? JSON.parse(article.tags) : []
            return (
              <div key={article.id} className="bg-white rounded-lg p-4 shadow-sm border">
                <div className="font-medium text-gray-900">{article.titleZh}</div>
                <div className="mt-1 text-sm text-gray-600 line-clamp-2">{article.summaryZh}</div>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-gray-400">
                  <span>{new Date(article.createdAt).toLocaleDateString()}</span>
                  {article.rawItem.sourceName && (
                    <>
                      <span>&middot;</span>
                      <span>{article.rawItem.sourceName}</span>
                    </>
                  )}
                  {article.rawItem.url && (
                    <>
                      <span>&middot;</span>
                      <a href={article.rawItem.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Original</a>
                    </>
                  )}
                  {article.companies.map(ac => (
                    <span key={ac.companyId} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">{ac.company.name}</span>
                  ))}
                  {tags.map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            )
          })}
          {articles.length === 0 && (
            <div className="text-center text-gray-400 py-12">No published news yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
