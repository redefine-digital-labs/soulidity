import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import type { ChainCollectionDetail } from '@/lib/collections/collection-detail-model'

interface CollectionStatsRowProps {
  collection: ChainCollectionDetail
}

function StatCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-card2 border border-border rounded-lg px-4 py-3 text-center">
      <div className="text-[10px] font-bold text-muted uppercase tracking-[0.08em] mb-1">{label}</div>
      <div className={`text-sm font-bold break-words ${color ?? 'text-foreground'}`}>{value}</div>
      {sub}
    </div>
  )
}

function SoulsCell({ collection }: { collection: ChainCollectionDetail }) {
  const current = collection.currentSoulSupply
  const cap = collection.maxSoulSupply == null ? null : BigInt(collection.maxSoulSupply)
  if (cap == null) {
    return <StatCell label="Souls" value={String(current)} />
  }
  // Only the bounded visual percentage is a Number; supply stays exact u64.
  const pct = Number(BigInt(current) * 10000n / cap) / 100
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
  const floorSource = collection.floorPriceAtomic
  const floorPrice = floorSource
    ? formatAtomicAmountForDisplay(floorSource)
    : '\u2014'
  const volume = collection.stats.soulVolume
    ? formatAtomicAmountForDisplay(collection.stats.soulVolume)
    : '\u2014'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <StatCell label="Soul Floor Policy" value={floorPrice} color="text-gold"
        sub={<p className="mt-1 text-[10px] text-muted">{collection.stats.soulFloorAtomic === null ? 'Member listing minimum unavailable'
          : `${collection.membersComplete ? 'Member minimum' : 'Verified subset minimum'}: ${formatAtomicAmountForDisplay(collection.stats.soulFloorAtomic)}`}</p>} />
      <StatCell label="Soul Volume" value={volume} color="text-gold" />
      <SoulsCell collection={collection} />
      <StatCell label="Soul Holders" value={collection.stats.soulHolders === null ? 'Unavailable' : String(collection.stats.soulHolders)} />
      <StatCell label="Royalty Rate" value={`${collection.extraRoyaltyBps / 100}%`} color="text-teal" />
    </div>
  )
}
