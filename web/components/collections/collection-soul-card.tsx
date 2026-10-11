import Link from 'next/link'
import { Tag } from '@/components/ui/tag'
import { SoulCoverImage } from '@/components/souls/soul-cover-image'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

interface CollectionSoulCardProps {
  soul: ChainSoulDetail
  collectionName?: string
}

export function CollectionSoulCard({ soul, collectionName }: CollectionSoulCardProps) {
  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="min-w-0 bg-card border border-border rounded-xl overflow-hidden hover:border-purple hover:-translate-y-0.5 transition block"
    >
      <SoulCoverImage
        soul={soul}
        imageUrl={soul.imageUrl}
        className="aspect-[4/5]"
        fallback={<span className="text-4xl">{'🤖'}</span>}
        hasOverlay
      >
        <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-1.5 p-3">
          <Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'} className="text-[10px]">
            {soul.listingStatus === 'listed' ? 'Listed' : soul.listingStatus === 'floor-violation' ? 'Below collection floor' : 'Held'}
          </Tag>
          {collectionName && (
            <Tag color="purple" className="text-[10px] max-w-full break-all whitespace-normal">{collectionName}</Tag>
          )}
        </div>
      </SoulCoverImage>
      <div className="p-4">
        <div className="font-bold text-sm break-words">{soul.name}</div>
        <div className="text-xs text-muted mt-1 line-clamp-2 break-words">{soul.description}</div>
        <div className="mt-3 flex items-center justify-end text-xs">
          <span className="text-gold font-semibold break-all">
            {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Held'}
          </span>
        </div>
      </div>
    </Link>
  )
}
