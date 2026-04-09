'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useCollectionsList } from '@/lib/hooks/use-collections'
import { useSoulsList, type SoulsSortOption } from '@/lib/hooks/use-souls'
import { useAuth } from '@/components/providers/auth-provider'
import { useBookmarkStatus, useToggleBookmark } from '@/lib/hooks/use-social'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { Input, Select } from '@/components/ui/input'
import { Tag, type TagColor } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'
import type { SoulCollectionAssetSummary, SoulAssetSummary } from '@/lib/soulidity/types'

const filterTabs = [
  { id: 'all', label: 'All' },
  { id: 'trading', label: 'Trading' },
  { id: 'research', label: 'Research' },
  { id: 'social', label: 'Social' },
  { id: 'defi', label: 'DeFi' },
  { id: 'nft', label: 'NFT' },
  { id: 'infra', label: 'Infrastructure' },
]

const tagColors: Record<string, TagColor> = {
  trading: 'gold',
  research: 'teal',
  social: 'gold',
  defi: 'gold',
  nft: 'purple',
  art: 'purple',
  infrastructure: 'teal',
  imported: 'teal',
  native: 'success',
  'personal-join': 'purple',
}

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function resolveTagColor(value: string) {
  return tagColors[value.toLowerCase()] ?? 'muted'
}

function buildHeroStyle(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return {
      background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)',
    }
  }

  return {
    backgroundImage: `linear-gradient(135deg, rgba(15,17,26,0.18), rgba(44,20,98,0.58)), url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}

// ── Bookmark Button ──
function BookmarkButton({ soul }: { soul: SoulAssetSummary }) {
  const { user } = useAuth()
  const { data } = useBookmarkStatus(soul.id)
  const toggleBookmark = useToggleBookmark()
  const [optimistic, setOptimistic] = useState<boolean | undefined>(undefined)

  if (!user) return null

  const isBookmarked = optimistic !== undefined ? optimistic : (data?.bookmarked ?? false)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !isBookmarked
    setOptimistic(next)
    toggleBookmark.mutate(soul.id, {
      onError: () => setOptimistic(!next),
      onSuccess: () => setOptimistic(undefined),
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={toggleBookmark.isPending}
      aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this Soul'}
      className="flex items-center justify-center w-7 h-7 rounded-lg text-base transition hover:scale-110"
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
    >
      {isBookmarked ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gold">
          <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-muted hover:text-gold">
          <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

function CollectionCard({ collection }: { collection: SoulCollectionAssetSummary }) {
  return (
    <Link
      href={`/collections/${encodeURIComponent(collection.onChainId)}`}
      className="card card-hover group overflow-hidden cursor-pointer"
    >
      <div className="h-[132px] p-4 flex items-end" style={buildHeroStyle(collection.imageUrl)}>
        <Tag color={collection.listingStatus === 'listed' ? 'gold' : collection.tradeable ? 'muted' : 'danger'}>
          {collection.listingStatus === 'listed' ? 'Listed' : collection.tradeable ? 'Held' : 'Non-tradeable'}
        </Tag>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{collection.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-[1.5] text-muted">{collection.description}</p>
        </div>
        <div className="grid gap-2 rounded-lg border border-border bg-card2 p-3 text-xs text-muted">
          <div className="flex items-center justify-between">
            <span>Listed price</span>
            <span className="font-semibold text-gold">
              {collection.listedPriceAtomic ? formatAtomicAmountForDisplay(collection.listedPriceAtomic) : 'Not listed'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Souls</span>
            <span className="font-semibold text-foreground">{collection.soulCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Holder</span>
            <span className="font-semibold text-foreground">{formatAddress(collection.currentHolderAddress)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

const USDC_DECIMALS = 6

function humanPriceToAtomic(value: string): string {
  if (!value.trim()) return ''
  try {
    return parseDisplayAmountToAtomic(value, { decimals: USDC_DECIMALS }).toString()
  } catch {
    return ''
  }
}

export default function MarketPage() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [marketView, setMarketView] = useState<'souls' | 'collections'>('souls')
  const [collectionTab, setCollectionTab] = useState<'for-sale' | 'all'>('all')
  const [sort, setSort] = useState<SoulsSortOption>('newest')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [creator, setCreator] = useState('')
  const [debouncedCreator, setDebouncedCreator] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search query 300ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery])

  // Debounce creator filter 300ms
  const creatorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (creatorDebounceRef.current) clearTimeout(creatorDebounceRef.current)
    creatorDebounceRef.current = setTimeout(() => {
      setDebouncedCreator(creator)
    }, 300)
    return () => {
      if (creatorDebounceRef.current) clearTimeout(creatorDebounceRef.current)
    }
  }, [creator])

  const categoryMap: Record<string, string> = {
    all: '', trading: 'trading', research: 'research', social: 'social',
    defi: 'defi', nft: 'nft', infra: 'infrastructure',
  }

  const { data: soulsData, isLoading: soulsLoading } = useSoulsList({
    page: 1,
    category: categoryMap[activeFilter] || '',
    q: debouncedQuery,
    sort,
    minPrice: humanPriceToAtomic(minPrice),
    maxPrice: humanPriceToAtomic(maxPrice),
    creator: debouncedCreator,
  })
  const { data: collectionsData, isLoading: collectionsLoading } = useCollectionsList({
    page: 1,
    q: searchQuery,
  })

  const visibleSouls = (soulsData?.items ?? []).filter((soul) => soul.listingStatus === 'listed')

  const visibleCollections = collectionsData?.items ?? []

  return (
    <PageContainer className="space-y-8">
      <SectionHeader
        label="Soul Market"
        title="Digital Entity Marketplace"
        subtitle="Browse and collect AI agents & original characters on-chain"
        action={
          <div className="mt-2 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
            <Link href="/my-souls" className={buttonStyles({ variant: 'outline' })}>My Souls</Link>
            <Link href="/create" className={buttonStyles({ variant: 'primary' })}>+ Create Soul</Link>
          </div>
        }
      />

      <div className="space-y-4">
        {/* Search + Advanced toggle row */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-[360px]">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" strokeLinecap="round" />
            </svg>
            <Input
              type="text"
              placeholder="Search souls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9"
            />
          </div>

          {/* Sort dropdown */}
          <div className="relative w-full sm:w-[200px]">
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as SoulsSortOption)}
              className="w-full text-xs"
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="popular">Most Popular</option>
            </Select>
            <svg className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Advanced filters toggle */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-[20px] border border-border bg-transparent px-3.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-purple hover:text-purple cursor-pointer select-none"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M3 6h18M7 12h10M11 18h2" strokeLinecap="round" />
            </svg>
            Filters
            {(minPrice || maxPrice || creator) && (
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-purple text-[9px] font-bold text-white">
                {[minPrice, maxPrice, creator].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        {/* Advanced filters panel */}
        {showAdvanced && (
          <div className="rounded-xl border border-border bg-card2 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              {/* Price range */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Price Range (USDC)</span>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Min"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      className="w-[100px] py-2 text-xs"
                    />
                  </div>
                  <span className="text-xs text-muted">—</span>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Max"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="w-[100px] py-2 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Creator filter */}
              <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Creator</span>
                <Input
                  type="text"
                  placeholder="Address or name..."
                  value={creator}
                  onChange={(e) => setCreator(e.target.value)}
                  className="py-2 text-xs"
                />
              </div>

              {/* Clear button */}
              {(minPrice || maxPrice || creator) && (
                <button
                  onClick={() => { setMinPrice(''); setMaxPrice(''); setCreator('') }}
                  className="inline-flex items-center gap-1.5 self-end rounded-lg border border-border bg-transparent px-3 py-2 text-xs text-muted transition-colors hover:border-purple hover:text-purple cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        <FilterTabs
          tabs={[
            { id: 'souls', label: 'Individual Souls' },
            { id: 'collections', label: '+ Collections' },
          ]}
          activeId={marketView}
          onChange={(id) => setMarketView(id as 'souls' | 'collections')}
        />

        {marketView === 'souls' && (
          <FilterTabs tabs={filterTabs} activeId={activeFilter} onChange={setActiveFilter} />
        )}
      </div>

      {marketView === 'souls' && (
        <>
          {soulsLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-[320px] rounded-xl bg-card animate-pulse" />
              ))}
            </div>
          ) : visibleSouls.length === 0 ? (
            <EmptyState
              icon="🔍"
              label={searchQuery ? `No listed Souls for "${searchQuery}"` : 'No live Soul listings'}
              sublabel="Listed Soulidity assets will appear here once a kiosk listing is mirrored."
              actionLabel="Clear filters"
              onAction={() => {
                setSearchQuery('')
                setActiveFilter('all')
                setMinPrice('')
                setMaxPrice('')
                setCreator('')
                setSort('newest')
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSouls.map((soul) => (
                <div key={soul.id} className="card card-hover group overflow-hidden relative">
                  <Link
                    href={`/souls/${encodeURIComponent(soul.onChainId)}`}
                    className="block cursor-pointer"
                  >
                    <div className="flex h-[140px] items-center justify-center" style={buildHeroStyle(soul.imageUrl)}>
                      {!soul.imageUrl && <span className="text-4xl">🤖</span>}
                    </div>
                    <div className="space-y-2.5 p-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Tag color={resolveTagColor(soul.category)}>{soul.category}</Tag>
                        <Tag color="muted">Soul</Tag>
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">{soul.name}</h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-[1.5] text-muted">{soul.description}</p>
                      </div>
                      {soul.listedPriceAtomic && (
                        <p className="text-sm font-bold text-gold">{formatAtomicAmountForDisplay(soul.listedPriceAtomic)}</p>
                      )}
                    </div>
                  </Link>
                  <div className="absolute top-2 right-2">
                    <BookmarkButton soul={soul} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {marketView === 'collections' && (
        <>
          <FilterTabs
            tabs={[
              { id: 'all', label: `All Collections` },
              { id: 'for-sale', label: `Caps for Sale` },
            ]}
            activeId={collectionTab}
            onChange={(id) => setCollectionTab(id as 'for-sale' | 'all')}
          />

          {collectionsLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-[280px] rounded-xl bg-card animate-pulse" />
              ))}
            </div>
          ) : (() => {
            const filtered = collectionTab === 'for-sale'
              ? visibleCollections.filter((c) => c.listingStatus === 'listed')
              : visibleCollections
            return filtered.length === 0 ? (
              <EmptyState
                icon="📦"
                label={
                  searchQuery
                    ? `No collections matching "${searchQuery}"`
                    : collectionTab === 'for-sale'
                      ? 'No collection caps listed for sale yet'
                      : 'No collections yet'
                }
                sublabel={
                  collectionTab === 'for-sale'
                    ? 'Collection caps will appear here when holders list them for sale.'
                    : 'Soul collections will appear here once created.'
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((collection) => (
                  <CollectionCard key={collection.id} collection={collection} />
                ))}
              </div>
            )
          })()}
        </>
      )}
    </PageContainer>
  )
}
