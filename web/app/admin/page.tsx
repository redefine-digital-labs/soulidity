'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Tag } from '@/components/ui/tag'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { EmptyState } from '@/components/ui/empty-state'
import type { TagColor } from '@/components/ui/tag'
import { useAdminFetch } from './_hooks/use-admin-fetch'

interface Stats {
  raw_new: number
  articles_draft: number
  articles_rejected: number
  published_today: number
  companies_total: number
}

interface Article {
  id: string
  titleZh: string | null
  status: string
  createdAt: string
  tags: string | null
}

const STATUS_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'published', label: '已发布' },
  { id: 'rejected', label: '已拒绝' },
]

const STATUS_COLOR: Record<string, TagColor> = {
  draft: 'gold',
  published: 'teal',
  rejected: 'danger',
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: TagColor
}) {
  const textColors: Record<TagColor, string> = {
    gold: 'text-gold',
    purple: 'text-action-label',
    danger: 'text-danger',
    teal: 'text-teal',
    muted: 'text-muted',
    success: 'text-success',
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className={`text-3xl font-bold ${textColors[color]}`}>{value}</div>
      <div className="mt-1.5 text-[13px] text-muted">{label}</div>
    </div>
  )
}

export default function AdminDashboardPage() {
  const adminFetch = useAdminFetch()
  const [stats, setStats] = useState<Stats | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [filter, setFilter] = useState('all')
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingArticles, setLoadingArticles] = useState(true)

  useEffect(() => {
    adminFetch('/api/admin/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStats(d)
      })
      .finally(() => setLoadingStats(false))
  }, [adminFetch])

  const handleFilterChange = useCallback((nextFilter: string) => {
    setFilter(nextFilter)
    setLoadingArticles(true)
  }, [])

  useEffect(() => {
    const url =
      filter === 'all'
        ? '/api/admin/articles?limit=50'
        : `/api/admin/articles?status=${filter}&limit=50`
    adminFetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setArticles(Array.isArray(d) ? d : []))
      .finally(() => setLoadingArticles(false))
  }, [filter, adminFetch])

  return (
    <PageContainer>
      <SectionHeader label="Admin" title="仪表盘" />

      {/* Stats grid */}
      {loadingStats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="card" className="h-24" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-8">
          <StatCard label="待审核原始条目" value={stats.raw_new} color="gold" />
          <StatCard label="草稿文章" value={stats.articles_draft} color="purple" />
          <StatCard label="已拒绝" value={stats.articles_rejected} color="danger" />
          <StatCard label="今日已发布" value={stats.published_today} color="teal" />
          <StatCard label="收录项目" value={stats.companies_total} color="muted" />
        </div>
      ) : null}

      {/* Articles */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">文章列表</h2>
          <FilterTabs
            tabs={STATUS_FILTERS}
            activeId={filter}
            onChange={handleFilterChange}
          />
        </div>

        {loadingArticles ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="card" className="h-16" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <EmptyState icon="📄" label="暂无文章" />
        ) : (
          <div className="flex flex-col gap-2">
            {articles.map((a) => {
              const tags: string[] = (() => {
                try {
                  return a.tags ? JSON.parse(a.tags) : []
                } catch {
                  return []
                }
              })()
              return (
                <Link
                  key={a.id}
                  href={`/admin/articles/${a.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-purple transition-colors"
                >
                  <Tag color={STATUS_COLOR[a.status] ?? 'muted'} className="shrink-0">
                    {a.status === 'draft'
                      ? '草稿'
                      : a.status === 'published'
                        ? '已发布'
                        : a.status === 'rejected'
                          ? '已拒绝'
                          : a.status}
                  </Tag>
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground font-medium">
                    {a.titleZh ?? '(无标题)'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {tags.slice(0, 3).map((t) => (
                      <Tag key={t} color="muted" className="hidden sm:inline-flex">
                        {t}
                      </Tag>
                    ))}
                    <span className="text-xs text-muted">
                      {new Date(a.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
