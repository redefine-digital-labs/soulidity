'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@web/components/auth-provider'
import { SoulCard } from '@web/components/souls/soul-card'
import { SoulCardFeatured } from '@web/components/souls/soul-card-featured'
import { SoulCardCompact } from '@web/components/souls/soul-card-compact'
import { SkeletonCard } from '@web/components/souls/skeleton-card'
import { EmptyState } from '@web/components/souls/empty-state'
import { useSoulsList } from '@web/lib/souls/queries'

function useSoulCategories() {
  return useQuery<string[]>({
    queryKey: ['soul-categories'],
    queryFn: async () => {
      const res = await fetch('/api/souls/categories')
      if (!res.ok) throw new Error('Failed to fetch categories')
      return res.json()
    },
    staleTime: 60_000,
  })
}

function LockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function LoadingSkeleton() {
  return (
    <>
      {/* Hero skeleton */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <SkeletonCard variant="tall" />
        <div className="flex flex-col gap-4">
          <SkeletonCard variant="compact" />
          <SkeletonCard variant="compact" />
          <SkeletonCard variant="compact" />
        </div>
      </div>
      {/* Search bar skeleton */}
      <div className="skeleton h-12 w-full rounded-xl" />
      {/* Grid skeleton */}
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} variant={i % 5 === 4 ? 'tall' : 'standard'} />
        ))}
      </div>
    </>
  )
}

export default function SoulsPage() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [activeCategory, setActiveCategory] = useState('')

  const { data, isLoading, error, refetch } = useSoulsList({ q, page, category: activeCategory })
  const { data: categories } = useSoulCategories()
  const isLoggedIn = !!user

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat)
    setPage(1)
  }

  const handleSearch = (value: string) => {
    setQ(value)
    setPage(1)
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p
              className="text-[11px] uppercase tracking-[0.16em]"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}
            >
              Soul Market
            </p>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '2.5rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              One-of-one Souls
            </h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {categories && categories.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap scrollbar-none">
                <button
                  type="button"
                  className={`filter-pill ${activeCategory === '' ? 'filter-pill-active' : ''}`}
                  onClick={() => handleCategoryChange('')}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`filter-pill ${activeCategory === cat ? 'filter-pill-active' : ''}`}
                    onClick={() => handleCategoryChange(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {isLoggedIn && (
              <Link href="/souls/publish" className="btn btn-primary hidden md:inline-flex">
                Publish Soul
              </Link>
            )}
          </div>
        </div>

        {/* Loading state */}
        {isLoading && <LoadingSkeleton />}

        {/* Error state */}
        {!isLoading && error && (
          <div
            className="glass-panel p-6 flex items-center justify-between gap-4"
            style={{
              background: 'var(--accent-rose-dim)',
              borderColor: 'rgba(225, 29, 72, 0.15)',
            }}
          >
            <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>
              Failed to load Souls. Please try again.
            </p>
            <button
              type="button"
              className="btn btn-surface text-sm"
              onClick={() => refetch()}
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && data && (
          <>
            {/* Hero zone — only when 4+ items and no active search */}
            {!q && data.items.length >= 4 && (
              <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: '2fr 1fr' }}>
                <SoulCardFeatured soul={data.items[0]} />
                <div className="flex flex-col gap-3">
                  {data.items.slice(1, 4).map((soul) => (
                    <SoulCardCompact key={soul.onChainId} soul={soul} />
                  ))}
                </div>
              </div>
            )}

            {/* Search bar */}
            <div className="glass-panel px-4 py-3 flex items-center gap-3">
              <SearchIcon />
              <input
                value={q}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search Souls by name, description, or tag…"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => handleSearch('')}
                  className="text-xs px-2 py-1 rounded-lg transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Browse grid */}
            {data.items.length === 0 ? (
              q ? (
                <div className="glass-panel p-12 flex flex-col items-center text-center gap-4">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    No Souls match <span style={{ color: 'var(--text-primary)' }}>&ldquo;{q}&rdquo;</span>
                  </p>
                  <button
                    type="button"
                    className="btn btn-surface"
                    onClick={() => handleSearch('')}
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <EmptyState
                  icon={<LockIcon />}
                  heading="Nothing here yet"
                  description="Be the first to publish a Soul."
                  ctaLabel={isLoggedIn ? 'Publish Soul' : undefined}
                  ctaHref={isLoggedIn ? '/souls/publish' : undefined}
                />
              )
            ) : (
              <>
                {/* Determine which items go into grid (skip hero items when shown) */}
                {(() => {
                  const gridItems = !q && data.items.length >= 4 ? data.items.slice(4) : data.items
                  if (gridItems.length === 0) return null
                  return (
                    <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 stagger-children">
                      {gridItems.map((soul, i) => (
                        <SoulCard
                          key={soul.onChainId}
                          soul={soul}
                          variant={i % 5 === 4 ? 'tall' : 'standard'}
                        />
                      ))}
                    </div>
                  )
                })()}

                {/* Pagination */}
                {data.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="btn btn-surface min-w-[44px] min-h-[44px]"
                    >
                      Prev
                    </button>
                    <span
                      className="text-sm px-2"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {data.page} / {data.totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page >= data.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="btn btn-surface min-w-[44px] min-h-[44px]"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Mobile FAB — only when logged in */}
      {isLoggedIn && (
        <Link
          href="/souls/publish"
          className="fixed bottom-6 right-6 flex items-center justify-center rounded-full shadow-lg md:hidden"
          aria-label="Publish Soul"
          style={{
            width: 56,
            height: 56,
            background: 'var(--accent-cyan)',
            color: '#ffffff',
            boxShadow: '0 4px 20px rgba(8, 145, 178, 0.35)',
          }}
        >
          <PlusIcon />
        </Link>
      )}
    </div>
  )
}
