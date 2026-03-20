'use client'

interface SoulPricingProps {
  oneTime: number | null
  subscription: number | null
  periodDays: number | null
  compact?: boolean
}

function formatUsdc(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function SoulPricing({ oneTime, subscription, periodDays, compact }: SoulPricingProps) {
  if (oneTime == null && subscription == null) {
    return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Free</span>
  }

  if (compact) {
    return (
      <div className="flex gap-2 text-xs">
        {oneTime != null && (
          <span style={{ color: 'var(--accent-cyan)' }}>{formatUsdc(oneTime)}</span>
        )}
        {subscription != null && periodDays != null && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {formatUsdc(subscription)}/{periodDays}d
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
          <span className="font-semibold" style={{ color: 'var(--accent-cyan)' }}>{formatUsdc(oneTime)}</span>
        </div>
      )}
      {subscription != null && periodDays != null && (
        <div className="flex justify-between text-sm">
          <span style={{ color: 'var(--text-secondary)' }}>Subscription</span>
          <span className="font-semibold" style={{ color: 'var(--accent-cyan)' }}>
            {formatUsdc(subscription)} / {periodDays} days
          </span>
        </div>
      )}
    </div>
  )
}
