'use client'

interface PlanSelectorProps {
  hasOneTime: boolean
  hasSubscription: boolean
  selected: 'onetime' | 'subscription'
  onChange: (plan: 'onetime' | 'subscription') => void
}

export function PlanSelector({ hasOneTime, hasSubscription, selected, onChange }: PlanSelectorProps) {
  if (!hasOneTime && !hasSubscription) return null
  if (hasOneTime && !hasSubscription) return null // Only one option, no selector needed
  if (!hasOneTime && hasSubscription) return null

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange('onetime')}
        className="glass-card px-4 py-2 text-xs font-semibold transition-opacity"
        style={{
          color: selected === 'onetime' ? 'var(--accent-cyan)' : 'var(--text-muted)',
          opacity: selected === 'onetime' ? 1 : 0.7,
        }}
      >
        One-time
      </button>
      <button
        type="button"
        onClick={() => onChange('subscription')}
        className="glass-card px-4 py-2 text-xs font-semibold transition-opacity"
        style={{
          color: selected === 'subscription' ? 'var(--accent-cyan)' : 'var(--text-muted)',
          opacity: selected === 'subscription' ? 1 : 0.7,
        }}
      >
        Subscription
      </button>
    </div>
  )
}
