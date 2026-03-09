import { StatsBar } from '@web/components/stats-bar'
import { ArticleList } from '@web/components/article-list'

export default function DashboardPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        Dashboard
      </h1>
      <div className="animate-fade-up">
        <StatsBar />
      </div>
      <div className="mt-8 animate-fade-up" style={{ animationDelay: '100ms' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>Articles</h2>
        <ArticleList />
      </div>
    </div>
  )
}
