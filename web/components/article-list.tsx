'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createSupabaseBrowser } from '@web/lib/supabase/client'

interface Article {
  id: string
  titleZh: string
  status: string
  tags: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-green-100 text-green-700',
  published: 'bg-purple-100 text-purple-700',
}

export function ArticleList() {
  const [articles, setArticles] = useState<Article[]>([])
  const [filter, setFilter] = useState<string>('')

  const fetchArticles = useCallback(() => {
    const url = filter ? `/api/articles?status=${filter}` : '/api/articles'
    fetch(url).then(r => r.json()).then(setArticles)
  }, [filter])

  useEffect(() => {
    fetchArticles()
  }, [fetchArticles])

  // Real-time subscription
  useEffect(() => {
    const supabase = createSupabaseBrowser()
    const channel = supabase
      .channel('articles-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'articles' },
        () => { fetchArticles() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchArticles])

  const filters = ['', 'draft', 'reviewed', 'published']

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-sm ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {f || 'All'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {articles.map(article => (
          <Link
            key={article.id}
            href={`/articles/${article.id}`}
            className="block bg-white rounded-lg p-4 shadow-sm border hover:border-gray-300 transition"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{article.titleZh}</div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${STATUS_COLORS[article.status] ?? 'bg-gray-100'}`}>
                {article.status}
              </span>
            </div>
            <div className="mt-2 text-xs text-gray-400">
              {new Date(article.createdAt).toLocaleString()}
              {article.tags && ` \u00b7 ${JSON.parse(article.tags).join(', ')}`}
            </div>
          </Link>
        ))}
        {articles.length === 0 && (
          <div className="text-center text-gray-400 py-8">No articles</div>
        )}
      </div>
    </div>
  )
}
