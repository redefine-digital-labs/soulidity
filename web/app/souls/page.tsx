'use client'

import { useState } from 'react'
import { useSoulsList } from '@web/lib/souls/queries'
import { SoulCard } from '@web/components/souls/soul-card'

const CATEGORIES = ['All', 'Trading', 'Research', 'Social', 'DeFi', 'NFT', 'Infrastructure', 'Other']

export default function SoulsPage() {
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useSoulsList({
    page,
    category: category || undefined,
    q: search || undefined,
  })

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Soul Market
        </h1>
        <span className="badge badge-muted text-xs">Publishing temporarily disabled until on-chain flow is wired</span>
      </div>

      {/* Search */}
      <div className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(searchInput)
            setPage(1)
          }}
        >
          <input
            type="text"
            placeholder="Search souls..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input-dark"
            style={{ maxWidth: '400px' }}
          />
        </form>
      </div>

      {/* Categories */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {CATEGORIES.map((cat) => {
          const active = cat === 'All' ? !category : category === cat
          return (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat === 'All' ? '' : cat)
                setPage(1)
              }}
              className={`filter-pill ${active ? 'filter-pill-active' : ''}`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Loading...</div>
      ) : data?.items.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>No souls found</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.items.map((soul) => <SoulCard key={soul.id} soul={soul} />)}
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8 items-center">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-surface text-sm"
              >
                Prev
              </button>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {page} / {data.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="btn btn-surface text-sm"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
