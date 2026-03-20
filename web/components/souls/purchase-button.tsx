'use client'

import { useAuth } from '@web/components/auth-provider'

interface PurchaseButtonProps {
  planType: 'onetime' | 'subscription'
}

export function PurchaseButton({ planType }: PurchaseButtonProps) {
  const { user } = useAuth()
  if (!user) {
    return (
      <a
        href="/login"
        className="glass-card px-6 py-3 text-sm font-semibold block text-center"
        style={{ color: 'var(--accent-cyan)' }}
      >
        Login to purchase
      </a>
    )
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled
        className="glass-card px-6 py-3 text-sm font-semibold w-full transition-all"
        style={{
          color: 'var(--text-muted)',
          opacity: 0.5,
        }}
      >
        {planType === 'onetime' ? 'Buy Now' : 'Subscribe'} (Coming Soon)
      </button>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Wallet settlement and on-chain minting are still being wired for Souls. Purchase actions stay
        disabled until the full flow is ready.
      </p>
    </div>
  )
}
