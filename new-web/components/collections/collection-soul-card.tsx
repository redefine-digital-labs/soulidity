import Link from 'next/link'
import { Tag } from '@/components/ui/tag'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import type { SoulAssetSummary } from '@/lib/soulidity/types'

function buildHeroStyle(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return {
      background: 'linear-gradient(135deg, var(--card2) 0%, var(--purple-deep) 100%)',
    }
  }
  return {
    backgroundImage: `linear-gradient(135deg, rgba(15,17,26,0.2), rgba(44,20,98,0.65)), url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}

interface CollectionSoulCardProps {
  soul: SoulAssetSummary
  collectionName?: string
}

export function CollectionSoulCard({ soul, collectionName }: CollectionSoulCardProps) {
  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="bg-card border border-border rounded-xl overflow-hidden hover:border-purple hover:-translate-y-0.5 transition block"
    >
      <div className="h-28 flex items-center justify-center relative" style={buildHeroStyle(soul.imageUrl)}>
        {!soul.imageUrl && (
          <span className="text-4xl">{'\uD83E\uDD16'}</span>
        )}
        <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1.5 p-3">
          <Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'} className="text-[10px]">
            {soul.listingStatus === 'listed' ? 'Listed' : 'Held'}
          </Tag>
          {collectionName && (
            <Tag color="purple" className="text-[10px]">{collectionName}</Tag>
          )}
        </div>
      </div>
      <div className="p-4">
        <div className="font-bold text-sm">{soul.name}</div>
        <div className="text-xs text-muted mt-1 line-clamp-2">{soul.description}</div>
        <div className="mt-3 flex items-center justify-end text-xs">
          <span className="text-gold font-semibold">
            {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Held'}
          </span>
        </div>
      </div>
    </Link>
  )
}
