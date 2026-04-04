'use client'

import { use } from 'react'
import Link from 'next/link'
import { useCollectionActions, useCollectionDetail } from '@/lib/hooks/use-collections'
import { EmptyState } from '@/components/ui/empty-state'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'

export default function CollectionBuyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: collection, isLoading, error: loadError } = useCollectionDetail(id)
  const { pending, error, buyCollection } = useCollectionActions(collection ?? null)

  if (isLoading) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-8">
        <div className="h-[360px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (loadError || !collection) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="📦"
          label="Collection not available"
          sublabel="The collection right could not be loaded for purchase."
          actionLabel="Back to Market"
          onAction={() => {
            window.location.href = '/market'
          }}
        />
      </div>
    )
  }

  if (collection.listingStatus !== 'listed' || !collection.listingObjectOnChainId || !collection.quote) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🚫"
          label="Collection right is not listed"
          sublabel="Only listed collection rights can be purchased from this route."
          actionLabel="Back to Collection"
          onAction={() => {
            window.location.href = `/collections/${encodeURIComponent(collection.onChainId)}`
          }}
        />
      </div>
    )
  }

  const signing = pending === 'purchase'

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center gap-0 rounded-t-xl mb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-success">✓</div>
          <span className="text-success">Review</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple">2</div>
          <span className="text-foreground font-semibold">Sign & Sync</span>
        </div>
      </div>

      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6">
        <h2 className="font-display text-xl font-bold mb-1">Confirm collection purchase</h2>
        <p className="text-muted text-sm mb-6">This transaction buys the collection right and mirrors the holder change after the digest settles.</p>

        <div className="bg-card2 border border-border rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-lg border border-border bg-card flex items-center justify-center text-lg font-semibold"
              style={collection.imageUrl ? {
                backgroundImage: `linear-gradient(135deg, rgba(15,17,26,0.15), rgba(44,20,98,0.55)), url(${collection.imageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : undefined}
            >
              {!collection.imageUrl ? collection.name.slice(0, 1).toUpperCase() : null}
            </div>
            <div>
              <p className="font-bold text-sm">{collection.name}</p>
              <p className="text-muted text-xs">{collection.soulCount} Souls · {(collection.extraRoyaltyBps / 100).toFixed(2)}% royalty</p>
            </div>
          </div>

          <div className="flex justify-between text-sm py-2 border-b border-border">
            <span className="text-muted">List price</span>
            <span className="font-semibold">{formatAtomicAmountForDisplay(collection.quote.priceAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b border-border">
            <span className="text-muted">Protocol fee</span>
            <span>{formatAtomicAmountForDisplay(collection.quote.platformFeeAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm py-2 font-bold">
            <span>Total</span>
            <span className="text-gold">{formatAtomicAmountForDisplay(collection.quote.totalAtomic)}</span>
          </div>
        </div>

        {error && (
          <p className="text-danger text-xs mb-4 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 text-xs text-muted leading-relaxed">
          Royalty routing is attached to the collection right itself. After purchase, the holder address and kiosk are refreshed from chain before the UI reports success.
        </div>

        <div className="flex gap-2.5">
          <Link
            href={`/collections/${encodeURIComponent(collection.onChainId)}`}
            className="bg-transparent text-foreground border border-border rounded-lg px-4 py-2.5 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <button
            onClick={() => {
              void buyCollection()
            }}
            disabled={signing}
            className="flex-1 bg-gold text-black font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
          >
            {signing ? '⟳ Signing…' : `Buy for ${formatAtomicAmountForDisplay(collection.quote.totalAtomic)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
