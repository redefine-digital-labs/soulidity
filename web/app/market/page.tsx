'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface ListingItem {
  id: string
  priceMist: string
  bundle: {
    id: string
    name: string
    description: string
    category: string
    tags: string[]
    previewImages: string[]
    version: string
    seller: { id: string; tgName: string | null; avatar: string | null }
  }
}

const PAGE_SIZE = 20

function formatSUI(mist: string): string {
  const sui = Number(BigInt(mist)) / 1e9
  return sui < 0.01 ? '< 0.01' : sui.toFixed(2)
}

export default function MarketPage() {
  const [listings, setListings] = useState<ListingItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    fetch(`/api/market/listings?${params}`)
      .then(r => r.ok ? r.json() : { listings: [], total: 0 })
      .then(data => { setListings(data.listings); setTotal(data.total) })
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(() => { setPage(1) }, [search])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">模板市场</span>
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {loading ? '加载中...' : `共 ${total} 个模板`}
          </p>
        </div>

        <div className="mb-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索模板名称或描述..."
            className="input-dark"
            style={{ maxWidth: '20rem' }}
          />
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : listings.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>暂无模板</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {listings.map(listing => (
                <Link
                  key={listing.id}
                  href={`/market/${listing.id}`}
                  className="glass-card p-5 transition-all hover:scale-[1.02] hover:shadow-lg"
                  style={{ textDecoration: 'none' }}
                >
                  {listing.bundle.previewImages[0] && (
                    <img
                      src={listing.bundle.previewImages[0]}
                      alt=""
                      className="w-full h-32 object-cover rounded-md mb-3"
                    />
                  )}
                  <h2 className="font-semibold mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {listing.bundle.name}
                  </h2>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-muted)' }}>
                    {listing.bundle.description.length > 80
                      ? listing.bundle.description.slice(0, 80) + '...'
                      : listing.bundle.description}
                  </p>
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="badge badge-cyan">{listing.bundle.category}</span>
                    <span className="font-semibold" style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                      {formatSUI(listing.priceMist)} SUI
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  disabled={page === 1}
                  className="glass-card px-3 py-1.5 text-sm transition-opacity disabled:opacity-30"
                  style={{ color: 'var(--text-primary)' }}
                >上一页</button>
                <span className="text-sm px-3" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
                <button
                  onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  disabled={page === totalPages}
                  className="glass-card px-3 py-1.5 text-sm transition-opacity disabled:opacity-30"
                  style={{ color: 'var(--text-primary)' }}
                >下一页</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
