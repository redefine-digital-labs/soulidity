'use client'

import Link from 'next/link'
import type { SoulAssetSummary } from '@web/lib/souls/types'
import { SoulPricing } from '@web/components/souls/soul-pricing'

export function SoulCardFeatured({ soul }: { soul: SoulAssetSummary }) {
  const previewImage = soul.previewImages[0] ?? soul.imageUrl

  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="glass-card overflow-hidden transition-all hover:translate-y-[-4px] flex flex-col"
    >
      <div className="aspect-[4/5] w-full relative overflow-hidden">
        {previewImage ? (
          <img
            src={previewImage}
            alt={`${soul.name} — featured`}
            className="w-full h-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="w-full h-full" style={{ background: 'var(--bg-elevated)' }} />
        )}
        <span
          className={`status-badge ${soul.listingStatus === 'listed' ? 'status-badge-listed' : 'status-badge-held'}`}
        >
          {soul.listingStatus === 'listed' ? 'Listed' : 'Held'}
        </span>
      </div>
      <div className="p-5 flex flex-col gap-2">
        <p
          className="text-[11px] uppercase tracking-[0.14em]"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}
        >
          {soul.category}
        </p>
        <h2
          className="leading-tight"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          {soul.name}
        </h2>
        <span
          className="data-value text-sm font-semibold mt-1"
          style={{ color: 'var(--accent-cyan)' }}
        >
          <SoulPricing listedPriceAtomic={soul.listedPriceAtomic} listingStatus={soul.listingStatus} />
        </span>
      </div>
    </Link>
  )
}
