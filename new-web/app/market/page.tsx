'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCollectionsList } from '@/lib/hooks/use-collections'
import { useSoulsList } from '@/lib/hooks/use-souls'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { Input } from '@/components/ui/input'
import { Tag, type TagColor } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'

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

export default function MarketPage() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [marketView, setMarketView] = useState<'souls' | 'collections'>('souls')

  const categoryMap: Record<string, string> = {
    all: '', trading: 'trading', research: 'research', social: 'social',
    defi: 'defi', nft: 'nft', infra: 'infrastructure',
  }
  const { data: soulsData, isLoading: soulsLoading } = useSoulsList({
    page: 1,
    category: categoryMap[activeFilter] || '',
    q: searchQuery,
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
        <div className="relative max-w-[320px]">
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
              actionLabel="Clear search"
              onAction={() => {
                setSearchQuery('')
                setActiveFilter('all')
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSouls.map((soul) => (
                <Link
                  key={soul.id}
                  href={`/souls/${encodeURIComponent(soul.onChainId)}`}
                  className="card card-hover group overflow-hidden cursor-pointer"
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
              ))}
            </div>
          )}
        </>
      )}

      {marketView === 'collections' && (
        <>
          {collectionsLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-[280px] rounded-xl bg-card animate-pulse" />
              ))}
            </div>
          ) : visibleCollections.length === 0 ? (
            <EmptyState
              icon="📦"
              label="No live collection rights"
              sublabel="Tradable collection rights will show up here after the holder lists them."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCollections.map((collection) => (
                <Link
                  key={collection.id}
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
              ))}
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
