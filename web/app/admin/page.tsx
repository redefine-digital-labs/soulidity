import { StatsBar } from '@web/components/stats-bar'
import { ArticleList } from '@web/components/article-list'

export default function DashboardPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">CryptoOpenClaw Dashboard</h1>
      <StatsBar />
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Articles</h2>
        <ArticleList />
      </div>
    </div>
  )
}
