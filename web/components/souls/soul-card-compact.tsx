'use client'

import Link from 'next/link'
import type { SoulAssetSummary } from '@web/lib/souls/types'
import { SoulPricing } from '@web/components/souls/soul-pricing'

export function SoulCardCompact({ soul }: { soul: SoulAssetSummary }) {
  const previewImage = soul.previewImages[0] ?? soul.imageUrl

  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="glass-panel p-3 flex items-center gap-3 transition-colors"
      style={{ '--hover-bg': 'var(--bg-elevated)' } as React.CSSProperties}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-surface)'
      }}
    >
      <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
        {previewImage ? (
          <img
            src={previewImage}
            alt={soul.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            {soul.name}
          </p>
          <span
            className={`badge shrink-0 ${soul.listingStatus === 'listed' ? 'badge-cyan' : 'badge-emerald'}`}
          >
            {soul.listingStatus === 'listed' ? 'Listed' : 'Held'}
          </span>
        </div>
        <p
          className="text-xs uppercase tracking-[0.12em]"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}
        >
          {soul.category}
        </p>
        <span className="data-value text-sm" style={{ color: 'var(--accent-cyan)' }}>
          <SoulPricing listedPriceAtomic={soul.listedPriceAtomic} listingStatus={soul.listingStatus} />
        </span>
      </div>
    </Link>
  )
}
