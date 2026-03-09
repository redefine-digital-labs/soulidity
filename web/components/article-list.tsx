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

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-blue',
  published: 'badge-violet',
  rejected: 'badge-rose',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  rejected: '已拒绝',
}

export function ArticleList() {
  const [articles, setArticles] = useState<Article[]>([])
  const [filter, setFilter] = useState<string>('')

  const fetchArticles = useCallback(() => {
    const url = filter ? `/api/articles?status=${filter}` : '/api/articles'
    fetch(url).then(r => r.json()).then(setArticles)
  }, [filter])

  useEffect(() => { fetchArticles() }, [fetchArticles])

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    const channel = supabase
      .channel('articles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, () => { fetchArticles() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchArticles])

  const filters = ['', 'draft', 'published', 'rejected']

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`filter-pill ${filter === f ? 'filter-pill-active' : ''}`}>
            {STATUS_LABEL[f] ?? '全部'}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {articles.map(article => (
          <Link key={article.id} href={`/admin/articles/${article.id}`} className="glass-card glow-cyan p-4 block group">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium truncate group-hover:text-[var(--accent-cyan)] transition-colors" style={{ color: 'var(--text-primary)' }}>{article.titleZh}</div>
              </div>
              <span className={`badge ${STATUS_BADGE[article.status] ?? 'badge-muted'} shrink-0`}>{STATUS_LABEL[article.status] ?? article.status}</span>
            </div>
            <div className="mt-2 text-xs data-value" style={{ color: 'var(--text-muted)' }}>
              {new Date(article.createdAt).toLocaleString()}
              {article.tags && ` · ${JSON.parse(article.tags).join(', ')}`}
            </div>
          </Link>
        ))}
        {articles.length === 0 && (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>暂无文章</div>
        )}
      </div>
    </div>
  )
}
