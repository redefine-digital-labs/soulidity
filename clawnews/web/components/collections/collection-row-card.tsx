'use client'

import Link from 'next/link'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import type { SoulCollectionAssetSummary } from '@soulidity/sdk'

export type CollectionAction = 'list' | 'edit-price' | 'delist'

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

interface CollectionRowCardProps {
  collection: SoulCollectionAssetSummary
  section: 'created' | 'acquired' | 'sold'
  onAction: (type: CollectionAction, collection: SoulCollectionAssetSummary) => void
}

export function CollectionRowCard({ collection, section, onAction }: CollectionRowCardProps) {
  const detailHref = `/collections/${encodeURIComponent(collection.onChainId)}`
  const isListed = collection.listingStatus === 'listed'

  return (
    <div className="overflow-hidden rounded-xl">
      {/* Main row */}
      <div className={`flex flex-col gap-4 ${isListed ? 'rounded-t-xl border-b-0' : 'rounded-xl'} border border-border bg-card2 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between`}>
        <Link href={detailHref} className="flex min-w-0 items-center gap-3 cursor-pointer">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-[linear-gradient(135deg,var(--card2),var(--purple-deep))] text-xl">
            {collection.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={collection.imageUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <span aria-hidden="true">{'\uD83D\uDCE6'}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="truncate text-sm font-bold text-foreground">{collection.name}</span>
              <Tag color="purple" className="text-[10px]">Soul Collection</Tag>
              {collection.tradeable ? (
                <Tag color="teal" className="text-[10px]">Tradeable</Tag>
              ) : (
                <Tag color="danger" className="text-[10px]">Non-tradeable</Tag>
              )}
              {isListed && <Tag color="gold" className="text-[10px]">Listed</Tag>}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              Launched {formatDate(collection.createdAt)} &middot;{' '}
              {collection.maxSoulSupply == null
                ? `${collection.currentSoulSupply} Souls`
                : `${collection.currentSoulSupply} / ${collection.maxSoulSupply} Souls`}
              {collection.extraRoyaltyBps > 0 && <> &middot; Royalty {(collection.extraRoyaltyBps / 100).toFixed(0)}%</>}
            </div>
          </div>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {/* Royalties earned placeholder */}
          <div className="text-right mr-2">
            <div className="text-[10px] text-muted">Royalties earned</div>
            <div className="text-sm font-semibold text-gold">&mdash;</div>
          </div>

          {/* Action buttons based on state */}
          {!collection.tradeable ? (
            <span className="text-[11px] text-muted italic">Cannot be listed or transferred</span>
          ) : section === 'sold' ? (
            <>
              <span className="text-[11px] text-muted">Royalty now goes to buyer</span>
              <Link href={detailHref} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
                View
              </Link>
            </>
          ) : isListed ? (
            <>
              <span className="text-sm font-semibold text-gold">
                {collection.listedPriceAtomic ? formatAtomicAmountForDisplay(collection.listedPriceAtomic) : '\u2014'}
              </span>
              <button onClick={() => onAction('delist', collection)} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
                Delist
              </button>
              <button onClick={() => onAction('edit-price', collection)} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
                Edit Price
              </button>
            </>
          ) : (
            <button
              onClick={() => onAction('list', collection)}
              className={buttonStyles({ variant: 'gold', size: 'sm' })}
            >
              {section === 'acquired' ? 'List for Resale' : 'List Soul Collection'}
            </button>
          )}
        </div>
      </div>

      {/* Listing info bar */}
      {isListed && (
        <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-success/25 bg-success/[0.06] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-success">{'\uD83D\uDCB0'} Listed on Market</span>
          <span className="text-muted">
            {collection.listedPriceAtomic ? formatAtomicAmountForDisplay(collection.listedPriceAtomic) : ''} &middot; royalty rights on {collection.soulCount} Souls
          </span>
        </div>
      )}
    </div>
  )
}
