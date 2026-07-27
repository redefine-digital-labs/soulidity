'use client'

import { buttonStyles } from '@/components/ui/button'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import type { CollectionDetailResponse } from '@soulidity/sdk'
import type { CollectionAction } from '@/components/collections/collection-row-card'

export type CollectionViewVariant =
  | 'non-tradeable'
  | 'listed'
  | 'not-for-sale'
  | 'owner-listed'
  | 'owner-held'
  | 'creator-sold'

export function resolveCollectionViewVariant(collection: CollectionDetailResponse): CollectionViewVariant {
  if (!collection.tradeable) return 'non-tradeable'
  if (collection.isHolder) {
    return collection.listingStatus === 'listed' ? 'owner-listed' : 'owner-held'
  }
  if (collection.isCreator && !collection.isHolder && collection.listingStatus !== 'listed') return 'creator-sold'
  return collection.listingStatus === 'listed' ? 'listed' : 'not-for-sale'
}

function formatAddress(value: string) {
  return `${value.slice(0, 6)}\u2026${value.slice(-4)}`
}

interface CollectionHeaderActionsProps {
  collection: CollectionDetailResponse
  variant: CollectionViewVariant
  onAction: (type: CollectionAction) => void
  onBuy?: () => void
  buyPending?: boolean
  buyError?: string | null
  buySuccess?: boolean
}

export function CollectionHeaderActions({ collection, variant, onAction, onBuy, buyPending, buyError, buySuccess }: CollectionHeaderActionsProps) {
  const listedPrice = collection.listedPriceAtomic
    ? formatAtomicAmountForDisplay(collection.listedPriceAtomic)
    : null

  switch (variant) {
    case 'non-tradeable':
      return (
        <div className="rounded-xl border border-border bg-card2 px-5 py-4 max-w-xs">
          <div className="flex items-center gap-2 mb-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted shrink-0" aria-hidden="true">
              <path d="M8 1a5 5 0 0 0-5 5v2.5A1.5 1.5 0 0 0 1.5 10v4A1.5 1.5 0 0 0 3 15.5h10a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 13 8.5V6a5 5 0 0 0-5-5zM5 6a3 3 0 1 1 6 0v2.5H5V6z" fill="currentColor"/>
            </svg>
            <span className="text-sm font-bold text-foreground">Non-tradeable</span>
          </div>
          <p className="text-[11px] text-muted leading-relaxed text-left">
            This collection is soulbound to the creator permanently. This Soul Collection cannot be bought or sold.
          </p>
        </div>
      )

    case 'listed':
      return (
        <div className="rounded-xl border border-gold/30 bg-card2 px-5 py-4 max-w-xs">
          {listedPrice && (
            <div className="font-display text-2xl font-bold text-gold mb-2">{listedPrice}</div>
          )}
          <button
            onClick={onBuy}
            disabled={buyPending}
            className={buttonStyles({ variant: 'gold', full: true, className: buyPending ? 'opacity-60 cursor-wait' : '' })}
          >
            {buyPending ? 'Purchasing…' : 'Buy Collection Cap'}
          </button>
          {buySuccess && (
            <p className="mt-2 text-[11px] font-semibold text-teal">Purchase successful — you now own this collection cap.</p>
          )}
          {buyError && (
            <p className="mt-2 text-[11px] font-medium text-danger">{buyError}</p>
          )}
          <p className="mt-2 text-[11px] text-muted leading-relaxed">
            Buying the collection cap transfers royalty participation for all Souls in this collection.
          </p>
        </div>
      )

    case 'not-for-sale':
      return (
        <div className="rounded-xl border border-border bg-card2 px-5 py-4 max-w-xs">
          <p className="text-[10px] font-bold text-action-label uppercase tracking-[0.1em] mb-1">
            Soul Collection
          </p>
          <p className="text-sm font-bold text-foreground mb-1">Not for sale</p>
          <p className="text-[11px] text-muted leading-relaxed">
            The owner hasn&apos;t listed it yet. Check back later.
          </p>
        </div>
      )

    case 'owner-held':
      return (
        <div className="rounded-xl border border-purple/30 bg-card2 px-5 py-4 max-w-xs">
          <p className="text-[10px] font-bold text-action-label uppercase tracking-[0.1em] mb-2">
            Your Collection
          </p>
          <button
            onClick={() => onAction('list')}
            className={buttonStyles({ variant: 'gold', full: true })}
          >
            List Soul Collection
          </button>
          <p className="mt-2 text-[11px] text-muted leading-relaxed">
            List your collection rights on the marketplace. Royalties continue to accrue while listed.
          </p>
        </div>
      )

    case 'owner-listed':
      return (
        <div className="rounded-xl border border-gold/30 bg-card2 px-5 py-4 max-w-xs">
          <p className="text-[10px] font-bold text-gold uppercase tracking-[0.1em] mb-1">
            Your Collection &middot; Listed
          </p>
          {listedPrice && (
            <div className="font-display text-2xl font-bold text-gold mb-3">{listedPrice}</div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onAction('edit-price')}
              className={buttonStyles({ variant: 'outline', size: 'sm' })}
            >
              Edit Price
            </button>
            <button
              onClick={() => onAction('delist')}
              className={buttonStyles({ variant: 'outline', size: 'sm' })}
            >
              Delist
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted leading-relaxed">
            Your listing is active. Royalties continue to accrue until sold.
          </p>
        </div>
      )

    case 'creator-sold':
      return (
        <div className="rounded-xl border border-border bg-card2 px-5 py-4 max-w-xs">
          <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1">
            You created this
          </p>
          <p className="text-xs text-muted mb-1">
            Holder: <span className="text-foreground font-mono">{formatAddress(collection.currentHolderAddress)}</span>
          </p>
          {collection.listingStatus === 'listed' && listedPrice && (
            <p className="text-xs text-muted">
              Listed at <span className="text-gold font-semibold">{listedPrice}</span>
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted leading-relaxed">
            Royalty stream now goes to the current holder.
          </p>
        </div>
      )
  }
}
