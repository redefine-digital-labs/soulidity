'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface Direction {
  id: string
  name: string
  nameZh: string
  slug: string
  descriptionZh: string | null
  icon: string
  userCount: number
  rating: number
  category: { name: string; nameZh: string; icon: string }
}

type SortKey = 'userCount' | 'rating' | 'newest'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'userCount', label: '最多使用' },
  { key: 'rating', label: '最高评分' },
  { key: 'newest', label: '最新' },
]

export default function CategoryDirectionsPage() {
  const params = useParams<{ category: string }>()
  const category = params.category
  const [directions, setDirections] = useState<Direction[]>([])
  const [sort, setSort] = useState<SortKey>('userCount')
  const [loading, setLoading] = useState(true)

  const fetchDirections = useCallback(() => {
    setLoading(true)
    fetch(`/api/directions?category=${encodeURIComponent(category)}&sort=${sort}`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        setDirections(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [category, sort])

  useEffect(() => {
    fetchDirections()
  }, [fetchDirections])

  const categoryMeta = directions[0]?.category

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <nav className="text-sm mb-6 animate-fade-up" style={{ color: 'var(--text-muted)' }}>
          <Link href="/directions" className="transition-colors hover:text-[var(--accent-cyan)]">
            养成方向
          </Link>
          <span className="mx-2">&gt;</span>
          <span style={{ color: 'var(--text-primary)' }}>
            {categoryMeta
              ? `${categoryMeta.icon} ${categoryMeta.nameZh}`
              : decodeURIComponent(category)}
          </span>
        </nav>

        <h1 className="text-2xl font-bold mb-8 animate-fade-up" style={{ fontFamily: 'var(--font-display)', animationDelay: '50ms' }}>
          <span className="text-gradient">
            {categoryMeta
              ? `${categoryMeta.icon} ${categoryMeta.nameZh}`
              : decodeURIComponent(category)}
          </span>
        </h1>

        {/* Sort controls */}
        <div className="flex gap-2 mb-8 animate-fade-up" style={{ animationDelay: '100ms' }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              className={`filter-pill ${sort === opt.key ? 'filter-pill-active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Direction cards */}
        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>加载中...</div>
        ) : directions.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>该分类暂无方向</div>
        ) : (
          <div className="space-y-3 stagger-children">
            {directions.map(d => (
              <Link
                key={d.id}
                href={`/directions/${encodeURIComponent(category)}/${d.slug}`}
                className="glass-card glow-cyan block p-5 group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{d.icon}</span>
                      <span className="font-medium group-hover:text-[var(--accent-cyan)] transition-colors" style={{ color: 'var(--text-primary)' }}>
                        {d.nameZh}
                      </span>
                    </div>
                    {d.descriptionZh && (
                      <p className="text-sm mt-1 line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                        {d.descriptionZh}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-5 shrink-0 text-sm">
                    <div className="text-center">
                      <div className="data-value font-bold" style={{ color: 'var(--accent-cyan)' }}>
                        {d.userCount.toLocaleString()}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>使用</div>
                    </div>
                    <div className="text-center">
                      <div className="data-value font-bold" style={{ color: 'var(--accent-amber)' }}>
                        {d.rating.toFixed(1)}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>评分</div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
