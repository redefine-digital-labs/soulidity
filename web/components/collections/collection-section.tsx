'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CollectionRowCard, type CollectionAction } from '@/components/collections/collection-row-card'
import { ListCollectionModal, EditCollectionPriceModal, DelistCollectionModal } from '@/components/collections/collection-listing-modals'
import type { SoulCollectionAssetSummary } from '@soulidity/sdk'

interface CollectionSectionProps {
  collections: SoulCollectionAssetSummary[]
  currentUserId: string | null
}

export function CollectionSection({ collections, currentUserId }: CollectionSectionProps) {
  const queryClient = useQueryClient()
  const [activeModal, setActiveModal] = useState<{
    type: CollectionAction
    collection: SoulCollectionAssetSummary
  } | null>(null)

  const createdAndHeld = collections.filter(
    (c) => c.creatorMemberId === currentUserId && c.currentHolderMemberId === currentUserId,
  )
  const sold = collections.filter(
    (c) => c.creatorMemberId === currentUserId && c.currentHolderMemberId !== currentUserId,
  )
  const acquired = collections.filter(
    (c) => c.currentHolderMemberId === currentUserId && c.creatorMemberId !== currentUserId,
  )

  function handleAction(type: CollectionAction, collection: SoulCollectionAssetSummary) {
    setActiveModal({ type, collection })
  }

  function closeModal() {
    setActiveModal(null)
    queryClient.invalidateQueries({ queryKey: ['collection'] })
    queryClient.invalidateQueries({ queryKey: ['collections'] })
    queryClient.invalidateQueries({ queryKey: ['my-souls'] })
  }

  const hasCreated = createdAndHeld.length > 0 || sold.length > 0
  const hasAcquired = acquired.length > 0

  return (
    <div className="space-y-6">
      {/* CREATED BY ME */}
      {hasCreated && (
        <section>
          <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em] mb-3">
            Created by me
          </p>
          <div className="flex flex-col gap-3">
            {createdAndHeld.map((c) => (
              <CollectionRowCard key={c.id} collection={c} section="created" onAction={handleAction} />
            ))}
            {sold.map((c) => (
              <CollectionRowCard key={c.id} collection={c} section="sold" onAction={handleAction} />
            ))}
          </div>
        </section>
      )}

      {/* ACQUIRED SOUL COLLECTION RIGHTS */}
      {hasAcquired && (
        <section>
          <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em] mb-3">
            Acquired Soul Collection Rights
          </p>
          <div className="flex flex-col gap-3">
            {acquired.map((c) => (
              <CollectionRowCard key={c.id} collection={c} section="acquired" onAction={handleAction} />
            ))}
          </div>
        </section>
      )}

      {/* Modals */}
      {activeModal?.type === 'list' && (
        <ListCollectionModal collection={activeModal.collection} open onClose={closeModal} />
      )}
      {activeModal?.type === 'edit-price' && (
        <EditCollectionPriceModal collection={activeModal.collection} open onClose={closeModal} />
      )}
      {activeModal?.type === 'delist' && (
        <DelistCollectionModal collection={activeModal.collection} open onClose={closeModal} />
      )}
    </div>
  )
}
