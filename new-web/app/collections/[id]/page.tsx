'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useCollectionDetail, useCollectionActions } from '@/lib/hooks/use-collections'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { CollectionHeader } from '@/components/collections/collection-header'
import { CollectionHeaderActions, resolveCollectionViewVariant } from '@/components/collections/collection-header-actions'
import { CollectionStatsRow } from '@/components/collections/collection-stats-row'
import { CollectionLoreSection } from '@/components/collections/collection-lore-section'
import { CollectionSoulCard } from '@/components/collections/collection-soul-card'
import { ListCollectionModal, EditCollectionPriceModal, DelistCollectionModal } from '@/components/collections/collection-listing-modals'
import type { CollectionAction } from '@/components/collections/collection-row-card'

export default function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, getAuthHeaders } = useAuth()
  const { data: collection, isLoading, error } = useCollectionDetail(id, getAuthHeaders, user?.id)
  const { pending: actionPending, error: actionError, buyCollection } = useCollectionActions(collection ?? null)
  const queryClient = useQueryClient()
  const [activeModal, setActiveModal] = useState<CollectionAction | null>(null)
  const [buySuccess, setBuySuccess] = useState(false)

  async function handleBuy() {
    try {
      await buyCollection()
      queryClient.invalidateQueries({ queryKey: ['collection', id] })
      queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      setBuySuccess(true)
      setTimeout(() => setBuySuccess(false), 4000)
    } catch { /* error already set in hook */ }
  }

  function handleModalClose() {
    setActiveModal(null)
    queryClient.invalidateQueries({ queryKey: ['collection', id] })
    queryClient.invalidateQueries({ queryKey: ['my-souls'] })
    queryClient.invalidateQueries({ queryKey: ['collections'] })
  }

  if (isLoading) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8 space-y-6">
        <div className="h-6 w-32 rounded bg-card2 animate-pulse" />
        <div className="flex gap-5">
          <div className="h-24 w-24 rounded-xl bg-card2 animate-pulse shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-24 rounded bg-card2 animate-pulse" />
            <div className="h-8 w-64 rounded bg-card2 animate-pulse" />
            <div className="h-4 w-48 rounded bg-card2 animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-card2 animate-pulse" />
          ))}
        </div>
        <div className="h-32 rounded-xl bg-card2 animate-pulse" />
      </div>
    )
  }

  if (error || !collection) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <EmptyState
          icon={'\uD83D\uDCE6'}
          label="Collection not found"
          sublabel="The Soulidity projection does not have this collection yet."
          actionLabel="Back to Market"
          onAction={() => { window.location.href = '/market' }}
        />
      </div>
    )
  }

  const variant = resolveCollectionViewVariant(collection)

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 relative z-10 space-y-6">
      {/* Header with actions */}
      <CollectionHeader
        collection={collection}
        actions={
          <CollectionHeaderActions
            collection={collection}
            variant={variant}
            onAction={(type) => setActiveModal(type)}
            onBuy={handleBuy}
            buyPending={actionPending === 'purchase'}
            buyError={actionError}
            buySuccess={buySuccess}
          />
        }
      />

      {/* Stats row */}
      <CollectionStatsRow collection={collection} />

      {/* Lore / Setting */}
      <CollectionLoreSection description={collection.description} />

      {/* Souls in this collection */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl font-bold">Souls in this collection</h2>
          <span className="text-xs text-muted">{collection.souls.length} Souls</span>
        </div>

        {collection.souls.length === 0 ? (
          <EmptyState
            icon={'\uD83E\uDEE5'}
            label="No Souls mirrored yet"
            sublabel="Souls will appear here after mint or sync."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collection.souls.map((soul) => (
              <CollectionSoulCard key={soul.id} soul={soul} collectionName={collection.name} />
            ))}
          </div>
        )}
      </section>

      {/* Back to Market */}
      <Link href="/market" className="text-muted text-xs hover:text-foreground transition inline-block">
        &larr; Back to Market
      </Link>

      {/* Owner modals */}
      {activeModal === 'list' && (
        <ListCollectionModal collection={collection} open onClose={handleModalClose} />
      )}
      {activeModal === 'edit-price' && (
        <EditCollectionPriceModal collection={collection} open onClose={handleModalClose} />
      )}
      {activeModal === 'delist' && (
        <DelistCollectionModal collection={collection} open onClose={handleModalClose} />
      )}
    </div>
  )
}
