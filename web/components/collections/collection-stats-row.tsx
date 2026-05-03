import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import type { CollectionDetailResponse } from '@/lib/soulidity/types'

interface CollectionStatsRowProps {
  collection: CollectionDetailResponse
}

function StatCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-card2 border border-border rounded-lg px-4 py-3 text-center">
      <div className="text-[10px] font-bold text-muted uppercase tracking-[0.08em] mb-1">{label}</div>
      <div className={`text-sm font-bold ${color ?? 'text-foreground'}`}>{value}</div>
      {sub}
    </div>
  )
}

function SoulsCell({ collection }: { collection: CollectionDetailResponse }) {
  const current = collection.currentSoulSupply
  const cap = collection.maxSoulSupply == null ? null : Number(collection.maxSoulSupply)
  // Defensive: pre-cap-launch DB rows could carry maxSoulSupply === "0".
  // Treat that as a fully-saturated capacity (not a divide-by-zero NaN).
  if (cap == null) {
    return <StatCell label="Souls" value={String(current)} />
  }
  const safeCap = cap === 0 ? 1 : cap
  const pct = Math.min(100, Math.max(0, (current / safeCap) * 100))
  const value = `${current} / ${cap}`
  return (
    <StatCell
      label="Souls"
      value={value}
      sub={
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border/60">
          <div
            className="h-full bg-purple"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
      }
    />
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
      <SoulsCell collection={collection} />
      <StatCell label="Soul Holders" value={String(collection.stats.soulHolders)} />
      <StatCell label="Royalty Rate" value={`${(collection.extraRoyaltyBps / 100).toFixed(0)}%`} color="text-teal" />
    </div>
  )
}
