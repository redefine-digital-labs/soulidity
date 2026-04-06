import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import type { CollectionDetailResponse } from '@/lib/soulidity/types'

interface CollectionStatsRowProps {
  collection: CollectionDetailResponse
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-card2 border border-border rounded-lg px-4 py-3 text-center">
      <div className="text-[10px] font-bold text-muted uppercase tracking-[0.08em] mb-1">{label}</div>
      <div className={`text-sm font-bold ${color ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

export function CollectionStatsRow({ collection }: CollectionStatsRowProps) {
  // Prefer the collection's own floor price; fall back to the cheapest listed soul
  const floorSource = collection.floorPriceAtomic ?? collection.stats.soulFloorAtomic
  const floorPrice = floorSource
    ? formatAtomicAmountForDisplay(floorSource)
    : '\u2014'
  const volume = collection.stats.soulVolume
    ? formatAtomicAmountForDisplay(collection.stats.soulVolume)
    : '\u2014'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <StatCell label="Soul Floor" value={floorPrice} color="text-gold" />
      <StatCell label="Soul Volume" value={volume} color="text-gold" />
      <StatCell label="Souls" value={String(collection.soulCount)} />
      <StatCell label="Soul Holders" value={String(collection.stats.soulHolders)} />
      <StatCell label="Royalty Rate" value={`${(collection.extraRoyaltyBps / 100).toFixed(0)}%`} color="text-teal" />
    </div>
  )
}
