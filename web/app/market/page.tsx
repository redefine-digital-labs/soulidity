'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'

interface ListingItem {
  id: string
  priceMist: string
  priceUsdCents: number | null
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

function useSuiPrice() {
  const [price, setPrice] = useState<number | null>(null)
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.sui?.usd) setPrice(data.sui.usd) })
      .catch(() => {})
  }, [])
  return price
}

function formatUSD(mist: string, suiPrice: number | null): string | null {
  if (!suiPrice) return null
  const sui = Number(BigInt(mist)) / 1e9
  const usd = sui * suiPrice
  return usd < 0.01 ? '< $0.01' : `$${usd.toFixed(2)}`
}

function formatUsdCents(cents: number | null): string | null {
  if (cents === null) return null
  return `$${(cents / 100).toFixed(2)}`
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

  const suiPrice = useSuiPrice()
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-gradient">OpenClaw 模板市场</span>
          </h1>
          <p className="text-base mb-1" style={{ color: 'var(--text-secondary)' }}>
            发现、购买、部署 — 用模板加速你的 AI Agent 构建
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {loading ? '加载中...' : `${total} 个模板可用`}
          </p>
          <div className="flex gap-3 mt-3">
            <Link href="/market/publish" className="glass-card px-4 py-2 text-sm font-semibold" style={{ color: 'var(--accent-cyan)' }}>
              发布模板
            </Link>
            <Link href="/market/my" className="glass-card px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              我的购买
            </Link>
          </div>
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
                    <div className="text-right">
                      <span className="font-semibold block" style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                        {formatUsdCents(listing.priceUsdCents) ?? formatUSD(listing.priceMist, suiPrice) ?? `${formatSUI(listing.priceMist)} SUI`}
                      </span>
                      {(listing.priceUsdCents !== null || suiPrice) && (
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {formatSUI(listing.priceMist)} SUI
                        </span>
                      )}
                    </div>
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
