'use client'

import type { SoulPassSnapshot } from '@web/lib/souls/types'

export function PassStatus({ pass }: { pass: SoulPassSnapshot }) {
  const isExpired =
    pass.passType === 'subscription' &&
    pass.expiresAt != null &&
    new Date(pass.expiresAt) < new Date()

  return (
    <div className="glass-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Your Pass
        </span>
        <span
          className="badge text-xs"
          style={{
            background: isExpired ? 'var(--accent-rose-dim)' : 'var(--accent-cyan-dim)',
            color: isExpired ? 'var(--accent-rose)' : 'var(--accent-cyan)',
          }}
        >
          {isExpired ? 'Expired' : pass.passType === 'perpetual' ? 'Perpetual' : 'Active'}
        </span>
      </div>

      {pass.passType === 'subscription' && pass.expiresAt && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {isExpired ? 'Expired' : 'Expires'}: {new Date(pass.expiresAt).toLocaleDateString()}
        </p>
      )}

      {pass.agentGrant && (
        <div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Agent Grant:</p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {pass.agentGrant.slice(0, 8)}...{pass.agentGrant.slice(-6)}
          </p>
        </div>
      )}
    </div>
  )
}
