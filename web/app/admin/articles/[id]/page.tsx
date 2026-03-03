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

  if (error) return <div className="max-w-4xl mx-auto p-6 text-red-500">Article not found</div>
  if (!article) return <div className="max-w-4xl mx-auto p-6 animate-pulse">Loading...</div>

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Edit Article</h1>
      <ArticleEditor article={article} />
    </div>
  )
}
