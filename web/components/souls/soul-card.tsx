'use client'

import Link from 'next/link'
import type { SoulAssetSummary } from '@web/lib/souls/types'
import { SoulPricing } from '@web/components/souls/soul-pricing'
import { toSafeBackgroundImage } from '@web/lib/souls/soul-detail-utils'

type SoulCardProps = {
  soul: SoulAssetSummary
  variant?: 'standard' | 'tall'
}

/** Validate the URL is safe (https or safe data image) before using it in an img src. */
function toSafeImageSrc(value: string | null): string | null {
  if (!value) return null
  // toSafeBackgroundImage validates the URL is either a safe https URL or a safe raster data URL
  const safe = toSafeBackgroundImage(value)
  if (!safe) return null
  // Extract the URL from url("...") wrapper produced by toSafeBackgroundImage
  const match = /^url\("(.+)"\)$/.exec(safe)
  return match ? match[1] : null
}

export function SoulCard({ soul, variant = 'standard' }: SoulCardProps) {
  const rawPreviewImage = soul.previewImages[0] ?? soul.imageUrl
  const previewImage = toSafeImageSrc(rawPreviewImage)
  const isTall = variant === 'tall'

  return (
    <Link
      href={`/souls/${encodeURIComponent(soul.onChainId)}`}
      className="glass-card overflow-hidden transition-all hover:translate-y-[-2px] flex flex-col"
    >
      <div className={`${isTall ? 'aspect-[3/4]' : 'aspect-[4/3]'} w-full relative overflow-hidden`}>
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
        <span className={`status-badge ${soul.listingStatus === 'listed' ? 'status-badge-listed' : 'status-badge-held'}`}>
          {soul.listingStatus === 'listed' ? 'Listed' : 'Held'}
        </span>
        {isTall && (
          <div
            className="absolute inset-x-0 bottom-0 p-4"
            style={{
              background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)',
            }}
          >
            <h3
              className="text-base font-semibold truncate"
              style={{ color: '#ffffff', fontFamily: 'var(--font-display)' }}
            >
              {soul.name}
            </h3>
            <p className="text-xs uppercase tracking-[0.12em] mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {soul.category}
            </p>
          </div>
        )}
      </div>
      {!isTall && (
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
            <SoulPricing listedPriceAtomic={soul.listedPriceAtomic} listingStatus={soul.listingStatus} />
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
      )}
      {isTall && (
        <div className="px-4 py-3 flex items-center justify-between">
          <SoulPricing listedPriceAtomic={soul.listedPriceAtomic} listingStatus={soul.listingStatus} />
          <div className="flex flex-wrap gap-1.5">
            {soul.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-[10px]"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </Link>
  )
}
