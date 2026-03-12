'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PublicNav } from '@web/components/public-nav'
import { WalletConnect } from '@web/components/market/wallet-connect'
import { PurchaseButton } from '@web/components/market/purchase-button'

interface ListingDetail {
  id: string
  priceMist: string
  _count: { orders: number }
  bundle: {
    id: string
    name: string
    description: string
    readme: string | null
    category: string
    tags: string[]
    previewImages: string[]
    version: string
    contentHash: string
    seller: { id: string; tgName: string | null; avatar: string | null; level: number }
  }
}

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

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [listing, setListing] = useState<ListingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const suiPrice = useSuiPrice()

  useEffect(() => {
    fetch(`/api/market/listings/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setListing(data?.listing || null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        </div>
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="min-h-screen">
        <PublicNav />
        <div className="max-w-4xl mx-auto px-6 py-10">
          <p style={{ color: 'var(--text-muted)' }}>模板未找到</p>
        </div>
      </div>
    )
  }

  const b = listing.bundle

  return (
    <div className="min-h-screen">
      <PublicNav />
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left: info */}
          <div className="md:col-span-2 animate-fade-up">
            <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {b.name}
            </h1>
            <div className="flex items-center gap-3 mb-6">
              <span className="badge badge-cyan">{b.category}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>v{b.version}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{listing._count.orders} 次购买</span>
            </div>

            {b.previewImages.length > 0 && (
              <div className="flex gap-3 mb-6 overflow-x-auto">
                {b.previewImages.map((img, i) => (
                  <img key={i} src={img} alt="" className="h-40 rounded-lg object-cover" />
                ))}
              </div>
            )}

            <div className="glass-card p-6 mb-6">
              <p style={{ color: 'var(--text-secondary)' }}>{b.description}</p>
            </div>

            {b.readme && (
              <div className="glass-card p-6">
                <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>详细说明</h3>
                <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {b.readme}
                </div>
              </div>
            )}
          </div>

          {/* Right: purchase card */}
          <div className="animate-fade-up" style={{ animationDelay: '100ms' }}>
            <div className="glass-card p-6 sticky top-24">
              <div className="text-2xl font-bold mb-0.5" style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                {formatUSD(listing.priceMist, suiPrice) ?? `${formatSUI(listing.priceMist)} SUI`}
              </div>
              {suiPrice && (
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {formatSUI(listing.priceMist)} SUI
                </p>
              )}
              <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>一次购买，永久下载</p>

              <div className="mb-4">
                <WalletConnect />
              </div>

              <PurchaseButton
                listingId={listing.id}
                priceMist={listing.priceMist}
                onSuccess={() => router.push('/market/my')}
              />

              <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>卖家</p>
                <div className="flex items-center gap-2">
                  {b.seller.avatar ? (
                    <img src={b.seller.avatar} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {(b.seller.tgName || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{b.seller.tgName || '匿名'}</span>
                </div>
              </div>

              <div className="mt-4 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                SHA-256: {b.contentHash.slice(0, 16)}...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
