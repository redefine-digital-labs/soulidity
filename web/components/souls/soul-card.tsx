'use client'

import Link from 'next/link'
import type { SoulAssetSummary } from '@web/lib/souls/types'
import { SoulPricing } from '@web/components/souls/soul-pricing'

export function SoulCard({ soul }: { soul: SoulAssetSummary }) {
  const previewImage = soul.previewImages[0] ?? soul.imageUrl

  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="glass-card overflow-hidden transition-all hover:translate-y-[-2px]"
    >
      <div
        className="aspect-[4/3] w-full bg-cover bg-center"
        style={{ backgroundImage: `url("${previewImage}")` }}
      />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {soul.name}
            </h3>
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
              {soul.category}
            </p>
          </div>
          <SoulPricing listedPriceSui={soul.listedPriceSui} listingStatus={soul.listingStatus} />
        </div>
        <p className="text-sm line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
          {soul.description}
        </p>
        <div className="flex flex-wrap gap-2">
          {soul.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 rounded-full text-[11px]"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}
