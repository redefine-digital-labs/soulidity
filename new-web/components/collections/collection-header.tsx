import { Tag } from '@/components/ui/tag'
import type { CollectionDetailResponse } from '@/lib/soulidity/types'

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function formatAddress(value: string | null | undefined) {
  if (!value) return '\u2014'
  return `${value.slice(0, 6)}\u2026${value.slice(-4)}`
}

interface CollectionHeaderProps {
  collection: CollectionDetailResponse
  actions: React.ReactNode
}

export function CollectionHeader({ collection, actions }: CollectionHeaderProps) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      {/* Left: image + info */}
      <div className="flex items-start gap-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-border bg-[linear-gradient(135deg,var(--card2),var(--purple-deep))] text-4xl overflow-hidden">
          {collection.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={collection.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">{'\uD83D\uDCE6'}</span>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-bold text-purple uppercase tracking-[0.1em] mb-1">
            Soul Collection
          </p>
          <h1 className="font-display text-2xl font-bold lg:text-3xl">{collection.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>by {formatAddress(collection.creatorAddress)}</span>
            <span>&middot;</span>
            <span>Launched {formatDate(collection.createdAt)}</span>
            <span>&middot;</span>
            <span>{collection.soulCount} Souls</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!collection.tradeable && <Tag color="danger">Non-tradeable</Tag>}
            {collection.tradeable && collection.listingStatus === 'listed' && <Tag color="gold">Listed</Tag>}
          </div>
        </div>
      </div>

      {/* Right: actions zone */}
      <div className="shrink-0 lg:text-right">
        {actions}
      </div>
    </div>
  )
}
