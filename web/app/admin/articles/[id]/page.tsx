'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArticleEditor } from '@web/components/article-editor'

export default function ArticlePage() {
  const params = useParams()
  const id = params.id as string
  const [article, setArticle] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/articles/${id}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then(setArticle)
      .catch(() => setError(true))
  }, [id])

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="glass-panel p-8 text-center" style={{ color: 'var(--accent-rose)' }}>
          Article not found
        </div>
      </div>
    )
  }

  if (!article) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="glass-panel p-8 text-center animate-pulse" style={{ color: 'var(--text-muted)' }}>
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">Edit Article</span>
        </h1>
      </div>
      <div className="glass-panel p-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
        <ArticleEditor article={article} />
      </div>
    </div>
  )
}
