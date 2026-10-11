'use client'

import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useCollectionDetail } from '@/lib/hooks/use-collections'
import { useCollectionBuy } from '@/lib/hooks/use-collection-buy'
import { CollectionPurchasePanel } from '@/components/collections/collection-purchase-panel'
import { useToast } from '@/components/ui/toast'
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
  const [page, setPage] = useState(1)
  const result = useCollectionDetail(id, page)
  return <CollectionDetailContent key={result.identityKey} routeId={id} result={result} page={page} setPage={setPage} />
}

function CollectionReadStatus({ name, source }: { name: string; source: ReturnType<typeof useCollectionDetail>['detail'] | ReturnType<typeof useCollectionDetail>['members'] }) {
  return <div aria-label={`${name} scan`} className="rounded-xl border border-border bg-card2 p-3 text-xs space-y-2">
    <p>{name}: {source.progress.coverage} · {source.progress.pages} verified pages{source.progress.busy ? ' · Reading chain…' : ''}</p>
    <p className="text-muted">Candidate coverage and later current reads are non-atomic observations, not transaction authorization.</p>
    {source.error && <p role="alert" className="text-danger break-words">{source.error.message}</p>}
    <div className="flex flex-wrap gap-3">
      {source.progress.busy ? <button onClick={source.pause}>Pause {name}</button>
        : !['COMPLETE', 'LIMIT_REACHED'].includes(source.coverage) && <button onClick={() => void (source.lifetime ? source.resume() : source.refresh())}>Continue {name}</button>}
      <button onClick={() => void source.refresh()}>Refresh {name}</button>
    </div>
    {source.coverage === 'LIMIT_REACHED' && <p>Discovery limit reached. These results are incomplete.</p>}
  </div>
}

function CollectionDetailContent({ result, routeId, page, setPage }: { result: ReturnType<typeof useCollectionDetail>; routeId: string; page: number; setPage: (page: number) => void }) {
  const { data: collection, isLoading, error, detail, members } = result
  const id = routeId
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [activeModal, setActiveModal] = useState<CollectionAction | null>(null)
  const [buySuccess, setBuySuccess] = useState(false)
  const [buyOpen, setBuyOpen] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const purchase = useCollectionBuy({ onChainId: id, name: collection?.name ?? 'Collection',
    listedPriceAtomic: collection?.listedPriceAtomic ?? null, listingObjectOnChainId: collection?.listingObjectOnChainId ?? null }, () => {
    if (!mounted.current) return
    showToast('Original Collection purchase confirmed on chain.', 'success'); setBuySuccess(true)
    void queryClient.invalidateQueries({ queryKey: ['collection', id] })
    void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
    void queryClient.invalidateQueries({ queryKey: ['collections'] })
  })
  const purchasePanel = <CollectionPurchasePanel key={purchase.identityKey} purchase={purchase}
    offered={collection?.purchaseAvailable ?? false} expanded={buyOpen} onExpand={() => setBuyOpen(true)} />

  function handleModalClose() {
    if (!mounted.current) return
    setActiveModal(null)
    queryClient.invalidateQueries({ queryKey: ['collection', id] })
    queryClient.invalidateQueries({ queryKey: ['my-souls'] })
    queryClient.invalidateQueries({ queryKey: ['collections'] })
  }

  if (isLoading) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8 space-y-6">
        <CollectionReadStatus name="Collection" source={detail} />
        {purchasePanel}
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
        <CollectionReadStatus name="Collection" source={detail} />
        {purchasePanel}
        <EmptyState
          icon={'\uD83D\uDCE6'}
          label="Collection read unavailable"
          sublabel={error?.message ?? 'The chain read has not established this Collection yet. Continue or refresh the read.'}
          actionLabel="Back to Market"
          onAction={() => { window.location.href = '/market' }}
        />
      </div>
    )
  }

  const variant = resolveCollectionViewVariant(collection)

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 relative z-10 space-y-6">
      <CollectionReadStatus name="Collection" source={detail} />
      {/* Header with actions */}
      <CollectionHeader
        collection={collection}
        actions={
          <CollectionHeaderActions
            collection={collection}
            variant={variant}
            onAction={(type) => setActiveModal(type)}
            onBuy={() => setBuyOpen(true)}
            buyPending={purchase.pending}
            buyError={purchase.error}
            buySuccess={buySuccess}
          />
        }
      />

      {purchasePanel}

      {/* Stats row */}
      <CollectionStatsRow collection={collection} />

      {/* Lore / Setting */}
      <CollectionLoreSection description={collection.description} />

      {/* Souls in this collection */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="font-display text-xl font-bold">Souls in this collection</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {collection.maxSoulSupply == null
                ? `${collection.currentSoulSupply} Souls`
                : `${collection.currentSoulSupply} / ${collection.maxSoulSupply} Souls`}
            </span>
            {collection.isCreator && (
              (() => {
                if (collection.atCapacity) {
                  return (
                    <span className="rounded-full border border-border bg-card2/60 px-3 py-1 text-[11px] font-semibold text-muted">
                      Supply reached
                    </span>
                  )
                }
                return (
                  <Link
                    href={`/create?collectionId=${encodeURIComponent(collection.onChainId)}`}
                    className="rounded-full border border-purple/40 bg-purple/12 px-3 py-1 text-[11px] font-semibold text-action-label hover:bg-purple/20"
                  >
                    + Add Soul
                  </Link>
                )
              })()
            )}
          </div>
        </div>

        <CollectionReadStatus name="Member Souls" source={members} />
        {collection.memberSupplyMismatch && <p role="status" className="my-3 text-xs text-muted">The discovered members differ from the current supply. Chain state may have changed during the scan; refresh both reads before relying on aggregate counts.</p>}

        {collection.souls.length === 0 ? (
          <EmptyState
            icon={'\uD83E\uDEE5'}
            label={collection.membersComplete ? 'No Souls yet' : 'No member Souls verified yet'}
            sublabel={
              collection.membersComplete && collection.isCreator
                ? 'Mint your first Soul and bind it to this collection from the create flow.'
                : 'Continue or refresh member discovery. An incomplete read is not an empty Collection.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collection.souls.map((soul) => (
              <CollectionSoulCard key={soul.onChainId} soul={soul} collectionName={collection.name} />
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
          <span>{collection.memberCount} verified members · page {collection.page} of {collection.pages}{collection.membersComplete ? '' : ' · incomplete totals'}</span>
          <button disabled={collection.page <= 1} onClick={() => setPage(Math.max(1, collection.page - 1))}>Previous members</button>
          <button disabled={collection.page >= collection.pages} onClick={() => setPage(collection.page + 1)}>Next members</button>
          {page !== collection.page && <button onClick={() => setPage(1)}>First members</button>}
        </div>
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
