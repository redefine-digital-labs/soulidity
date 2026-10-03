'use client'

import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CollectionRowCard, type CollectionAction } from '@/components/collections/collection-row-card'
import { ListCollectionModal, EditCollectionPriceModal, DelistCollectionModal } from '@/components/collections/collection-listing-modals'
import type { CollectionPublicSnapshot } from '@soulidity/sdk'

interface CollectionSectionProps {
  collections: readonly CollectionPublicSnapshot[]
  viewerAddress: string
  identityKey: string
}

export function CollectionSection({ collections, viewerAddress, identityKey }: CollectionSectionProps) {
  const queryClient = useQueryClient()
  const [activeModal, setActiveModal] = useState<{
    type: CollectionAction
    collectionId: string
    identity: string
  } | null>(null)
  const identity = useRef(identityKey)
  useLayoutEffect(() => { identity.current = identityKey }, [identityKey])
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const selected = activeModal?.identity === identityKey
    ? collections.find(collection => collection.collectionId === activeModal.collectionId && collection.currentHolderAddress === viewerAddress) ?? null : null
  const subject = selected ? { onChainId: selected.collectionId, name: selected.name,
    listedPriceAtomic: selected.priceAtomic, listingObjectOnChainId: selected.listingId } : null

  const createdAndHeld = collections.filter(
    (c) => c.relationship === 'CREATED_HELD',
  )
  const sold = collections.filter(
    (c) => c.relationship === 'CREATED_SOLD',
  )
  const acquired = collections.filter(
    (c) => c.relationship === 'ACQUIRED',
  )

  function handleAction(type: CollectionAction, collection: CollectionPublicSnapshot) {
    if (!mounted.current || identity.current !== identityKey || collection.currentHolderAddress !== viewerAddress) return
    setActiveModal({ type, collectionId: collection.collectionId, identity: identityKey })
  }

  function closeModal() {
    if (!mounted.current || identity.current !== identityKey) return
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
              <CollectionRowCard key={c.collectionId} collection={c} section="created" onAction={handleAction} />
            ))}
            {sold.map((c) => (
              <CollectionRowCard key={c.collectionId} collection={c} section="sold" onAction={handleAction} />
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
              <CollectionRowCard key={c.collectionId} collection={c} section="acquired" onAction={handleAction} />
            ))}
          </div>
        </section>
      )}

      {/* Modals */}
      {subject && activeModal?.type === 'list' && (
        <ListCollectionModal key={`${identityKey}:${subject.onChainId}`} collection={subject} open onClose={closeModal} />
      )}
      {subject && activeModal?.type === 'edit-price' && (
        <EditCollectionPriceModal key={`${identityKey}:${subject.onChainId}`} collection={subject} open onClose={closeModal} />
      )}
      {subject && activeModal?.type === 'delist' && (
        <DelistCollectionModal key={`${identityKey}:${subject.onChainId}`} collection={subject} open onClose={closeModal} />
      )}
    </div>
  )
}
