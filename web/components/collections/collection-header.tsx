import { Tag } from '@/components/ui/tag'
import type { ChainCollectionDetail } from '@/lib/collections/collection-detail-model'

function formatAddress(value: string | null | undefined) {
  if (!value) return '\u2014'
  return `${value.slice(0, 6)}\u2026${value.slice(-4)}`
}

interface CollectionHeaderProps {
  collection: ChainCollectionDetail
  actions: React.ReactNode
}

export function CollectionHeader({ collection, actions }: CollectionHeaderProps) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      {/* Left: image + info */}
      <div className="flex min-w-0 flex-1 items-start gap-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border bg-[linear-gradient(135deg,var(--card2),var(--purple-deep))] text-4xl overflow-hidden">
          {collection.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={collection.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">{'\uD83D\uDCE6'}</span>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-bold text-action-label uppercase tracking-[0.1em] mb-1">
            Soul Collection
          </p>
          <h1 className="font-display text-2xl font-bold lg:text-3xl break-words">{collection.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>by {formatAddress(collection.creatorAddress)}</span>
            <span>&middot;</span>
            <span>Launch date unavailable</span>
            <span>&middot;</span>
            <span>
              {collection.maxSoulSupply == null
                ? `${collection.currentSoulSupply} Souls`
                : `${collection.currentSoulSupply} / ${collection.maxSoulSupply} Souls`}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!collection.tradeable && <Tag color="danger">Non-tradeable</Tag>}
            {collection.tradeable && collection.listingStatus === 'listed' && <Tag color="gold">Listed</Tag>}
          </div>
        </div>
      </div>

      {/* Right: actions zone */}
      <div className="min-w-0 shrink-0 lg:text-right">
        {actions}
      </div>
    </div>
  )
}
