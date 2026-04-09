'use client'

import Link from 'next/link'
import type { SoulAssetSummary } from '@web/lib/souls/types'
import { formatAtomicSoulPaymentForDisplay } from '@web/lib/souls/price-format'

type SoulRowProps = {
  soul: SoulAssetSummary
}

export function SoulRow({ soul }: SoulRowProps) {
  const previewImage = soul.previewImages[0] ?? soul.imageUrl
  const isListed = soul.listingStatus === 'listed'

  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="glass-card flex items-center gap-4 px-4 py-3 transition-all hover:translate-y-[-1px]"
    >
      {/* Thumbnail */}
      <div className="w-[120px] h-[90px] rounded-lg overflow-hidden shrink-0">
        {previewImage ? (
          <img
            src={previewImage}
            alt={`${soul.name} preview`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full" style={{ background: 'var(--bg-elevated)' }} />
        )}
      </div>

      {/* Center: name + category + tags */}
      <div className="flex-1 min-w-0">
        <h3
          className="text-base font-semibold truncate"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {soul.name}
        </h3>
        <p
          className="text-xs uppercase tracking-[0.12em] mt-0.5"
          style={{ color: 'var(--text-muted)' }}
        >
          {[soul.category, ...soul.tags.slice(0, 2)].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Right: status + price */}
      <div className="shrink-0 flex items-center gap-4">
        <span className={`badge ${isListed ? 'badge-cyan' : 'badge-emerald'}`}>
          {isListed ? 'Listed' : 'Held'}
        </span>
        {isListed && soul.listedPriceAtomic && (
          <span
            className="data-value text-sm font-semibold"
            style={{ color: 'var(--accent-cyan)' }}
          >
            {formatAtomicSoulPaymentForDisplay(soul.listedPriceAtomic)}
          </span>
        )}
      </div>

      {/* Chevron */}
      <div className="shrink-0" style={{ color: 'var(--text-muted)' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6 3l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </Link>
  )
}
