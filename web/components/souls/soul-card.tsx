'use client'

import Link from 'next/link'
import type { SoulSeriesListItem } from '@web/lib/souls/types'
import { SoulPricing } from './soul-pricing'

export function SoulCard({ soul }: { soul: SoulSeriesListItem }) {
  const latestVersion = soul.releases[0]?.version || '-'
  const previewImg = soul.previewImages[0]

  return (
    <Link href={`/souls/${soul.id}`} className="glass-card p-4 block transition-all hover:shadow-lg">
      {previewImg && (
        <div className="aspect-video rounded-md overflow-hidden mb-3" style={{ background: 'var(--bg-elevated)' }}>
          <img src={previewImg} alt={soul.name} className="w-full h-full object-cover" />
        </div>
      )}
      <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
        {soul.name}
      </h3>
      <p className="text-xs line-clamp-2 mb-2" style={{ color: 'var(--text-muted)' }}>
        {soul.description}
      </p>
      <div className="flex items-center justify-between">
        <span className="badge badge-cyan text-xs">{soul.category}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>v{latestVersion}</span>
      </div>
      <div className="mt-2">
        <SoulPricing
          oneTime={soul.oneTimePriceUsdc}
          subscription={soul.subPriceUsdc}
          periodDays={soul.subPeriodDays}
          compact
        />
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        {soul._count.passSnapshots} holders
      </div>
    </Link>
  )
}
