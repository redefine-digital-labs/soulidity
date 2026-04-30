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
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SoulCoverImage } from '@/components/souls/soul-cover-image'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'
import type { SoulCollectionAssetSummary, SoulAssetSummary } from '@/lib/soulidity/types'

// Tag colors removed — tags now use uniform 'muted' styling

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

// Seeded gradient so the same Soul always renders the same avatar fallback.
function avatarGradientFor(seed: string) {
  let h = 5381
  for (let i = 0; i < seed.length; i += 1) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  const hue2 = (hue + 55) % 360
  return `conic-gradient(from ${(h >> 3) % 360}deg at 38% 32%, hsl(${hue}, 62%, 54%), hsl(${hue2}, 52%, 44%), hsl(${hue}, 62%, 54%))`
}

function avatarInitial(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return '✦'
  return trimmed.charAt(0).toUpperCase()
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

function CollectionStateRibbon({ collection }: { collection: SoulCollectionAssetSummary }) {
  if (!collection.tradeable) {
    return (
      <div className="flex items-center gap-2 border-b border-muted/30 bg-[rgba(155,142,196,0.12)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
        <span aria-hidden="true">🔒</span>
        Non-tradeable · permanent
      </div>
    )
  }
  if (collection.listingStatus === 'listed' && collection.listedPriceAtomic) {
    return (
      <div className="flex items-center justify-between border-b border-gold/40 bg-gold/12 px-4 py-2 text-[11px] font-bold tracking-[0.06em] text-gold">
        <span className="uppercase">Cap listed</span>
        <span className="font-mono text-[12px] normal-case">{formatAtomicAmountForDisplay(collection.listedPriceAtomic)}</span>
      </div>
    )
  }
  const heldByCreator =
    collection.currentHolderAddress.toLowerCase() === collection.creatorAddress.toLowerCase()
  return (
    <div className="flex items-center gap-2 border-b border-teal/35 bg-teal/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-teal">
      <span aria-hidden="true">◆</span>
      {heldByCreator ? 'Held by creator' : 'Held by collector'}
    </div>
  )
}

function CollectionCard({ collection }: { collection: SoulCollectionAssetSummary }) {
  return (
    <Link
      href={`/collections/${encodeURIComponent(collection.onChainId)}`}
      className="card card-hover group overflow-hidden cursor-pointer"
    >
      <CollectionStateRibbon collection={collection} />
      <SoulCoverImage imageUrl={collection.imageUrl} className="aspect-[4/5]" />
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{collection.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-[1.5] text-muted">{collection.description}</p>
        </div>
        <div className="grid gap-2 rounded-lg border border-border bg-card2 p-3 text-xs text-muted">
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

function SoulCardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="aspect-[4/5] animate-pulse bg-card2" />
      <div className="space-y-2.5 p-3.5">
        <div className="flex gap-1.5">
          <div className="h-4 w-12 animate-pulse rounded-full bg-card2" />
          <div className="h-4 w-14 animate-pulse rounded-full bg-card2" />
        </div>
        <div className="h-4 w-32 animate-pulse rounded bg-card2" />
        <div className="h-3 w-full animate-pulse rounded bg-card2" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-card2" />
        <div className="h-5 w-20 animate-pulse rounded bg-card2" />
      </div>
    </div>
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
  const [hotTags, setHotTags] = useState<Array<{ tag: string; count: number }>>([])
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

  useEffect(() => {
    fetch('/api/souls/tags')
      .then((r) => r.json())
      .then((data) => setHotTags(data.tags ?? []))
      .catch(() => {})
  }, [])

  const filterTabs = [
    { id: 'all', label: 'All' },
    ...hotTags.slice(0, 8).map((t) => ({ id: t.tag, label: t.tag })),
  ]

  const { data: soulsData, isLoading: soulsLoading } = useSoulsList({
    page: 1,
    tag: activeFilter === 'all' ? '' : activeFilter,
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
            { id: 'souls', label: 'Souls' },
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
                <SoulCardSkeleton key={index} />
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
                    <SoulCoverImage
                      imageUrl={soul.imageUrl}
                      className="aspect-[4/5]"
                      fallbackStyle={{ backgroundImage: avatarGradientFor(soul.onChainId) }}
                      fallback={
                        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/10 bg-[rgba(13,10,30,0.55)] font-display text-[28px] font-extrabold tracking-[-0.02em] text-white backdrop-blur-sm">
                          {avatarInitial(soul.name)}
                        </div>
                      }
                    >
                      {soul.collectionOnChainId && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-border bg-[rgba(13,10,30,0.72)] px-2 py-[3px] text-[10.5px] font-semibold text-muted backdrop-blur-sm">
                          from collection ↗
                        </span>
                      )}
                    </SoulCoverImage>
                    <div className="space-y-2.5 p-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {soul.tags.slice(0, 3).map((tag) => (
                          <Tag key={tag} color="muted">{tag}</Tag>
                        ))}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">{soul.name}</h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-[1.5] text-muted">{soul.description}</p>
                      </div>
                      {soul.listedPriceAtomic && (
                        <div>
                          <p className="font-display text-[16px] font-extrabold leading-none tracking-[-0.01em] text-gold">
                            {formatAtomicAmountForDisplay(soul.listedPriceAtomic)}
                          </p>
                          <p className="mt-1 font-mono text-[10.5px] text-muted">+ network fee at checkout</p>
                        </div>
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
