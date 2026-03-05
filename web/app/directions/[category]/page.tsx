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
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-4xl mx-auto p-6">
        {/* Breadcrumb */}
        <nav className="text-sm text-gray-500 mb-4">
          <Link href="/directions" className="hover:text-gray-700">
            养成方向
          </Link>
          <span className="mx-2">&gt;</span>
          <span className="text-gray-900">
            {categoryMeta
              ? `${categoryMeta.icon} ${categoryMeta.nameZh}`
              : decodeURIComponent(category)}
          </span>
        </nav>

        <h1 className="text-2xl font-bold mb-6">
          {categoryMeta
            ? `${categoryMeta.icon} ${categoryMeta.nameZh}`
            : decodeURIComponent(category)}
        </h1>

        {/* Sort controls */}
        <div className="flex gap-2 mb-6">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              className={`px-3 py-1 rounded text-sm ${
                sort === opt.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Direction cards */}
        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : directions.length === 0 ? (
          <div className="text-center text-gray-400 py-8">该分类暂无方向</div>
        ) : (
          <div className="space-y-3">
            {directions.map(d => (
              <Link
                key={d.id}
                href={`/directions/${encodeURIComponent(category)}/${d.slug}`}
                className="block bg-white rounded-lg p-4 shadow-sm border hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{d.icon}</span>
                      <span className="font-medium text-gray-900">
                        {d.nameZh}
                      </span>
                    </div>
                    {d.descriptionZh && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-1">
                        {d.descriptionZh}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-sm text-gray-500">
                    <div className="text-center">
                      <div className="font-bold text-gray-900">
                        {d.userCount.toLocaleString()}
                      </div>
                      <div className="text-xs">使用</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-gray-900">
                        {d.rating.toFixed(1)}
                      </div>
                      <div className="text-xs">评分</div>
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
