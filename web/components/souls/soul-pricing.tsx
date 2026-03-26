'use client'

import { formatAtomicUsdcForDisplay } from '@web/lib/souls/price-format'

interface SoulPricingProps {
  oneTime: string | null
  subscription: string | null
  periodDays: number | null
  compact?: boolean
}

export function SoulPricing({ oneTime, subscription, periodDays, compact }: SoulPricingProps) {
  if (oneTime == null && subscription == null) {
    return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Free</span>
  }

  if (compact) {
    return (
      <div className="flex gap-2 text-xs">
        {oneTime != null && (
          <span style={{ color: 'var(--accent-cyan)' }}>{formatAtomicUsdcForDisplay(oneTime)}</span>
        )}
        {subscription != null && periodDays != null && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {formatAtomicUsdcForDisplay(subscription)}/{periodDays}d
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {oneTime != null && (
        <div className="flex justify-between text-sm">
          <span style={{ color: 'var(--text-secondary)' }}>One-time</span>
          <span className="font-semibold" style={{ color: 'var(--accent-cyan)' }}>{formatAtomicUsdcForDisplay(oneTime)}</span>
        </div>
      )}
      {subscription != null && periodDays != null && (
        <div className="flex justify-between text-sm">
          <span style={{ color: 'var(--text-secondary)' }}>Subscription</span>
          <span className="font-semibold" style={{ color: 'var(--accent-cyan)' }}>
            {formatAtomicUsdcForDisplay(subscription)} / {periodDays} days
          </span>
        </div>
      )}
    </div>
  )
}
