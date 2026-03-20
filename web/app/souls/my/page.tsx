'use client'

import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'
import { useMySouls } from '@web/lib/souls/queries'
import { SoulCard } from '@web/components/souls/soul-card'
import { PassStatus } from '@web/components/souls/pass-status'
import Link from 'next/link'

export default function MySoulsPage() {
  const { user, getAuthHeaders } = useAuth()
  const [tab, setTab] = useState<'published' | 'purchased'>('published')
  const { data, isLoading } = useMySouls(user?.id ?? null, getAuthHeaders)

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12 text-center">
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Login to view your Souls
        </p>
        <a
          href="/login"
          className="btn btn-primary"
        >
          Login
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
        My Souls
      </h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setTab('published')}
          className="pb-3 text-sm font-semibold transition-colors"
          style={{
            color: tab === 'published' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            borderBottom: tab === 'published' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          Published
        </button>
        <button
          onClick={() => setTab('purchased')}
          className="pb-3 text-sm font-semibold transition-colors"
          style={{
            color: tab === 'purchased' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            borderBottom: tab === 'purchased' ? '2px solid var(--accent-cyan)' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          Purchased
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Loading...</div>
      ) : tab === 'published' ? (
        <div>
          {data?.published.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                You haven&apos;t published any Souls yet
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Publishing is temporarily disabled until the on-chain create/release flow is connected to the indexer.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data?.published.map((soul) => (
                <div key={soul.id}>
                  <SoulCard soul={soul} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data?.passes.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                No passes yet
              </p>
              <Link href="/souls" className="btn btn-primary">
                Browse Souls
              </Link>
            </div>
          ) : (
            data?.passes.map((pass) => (
              <div key={pass.id} className="glass-card p-4">
                <div className="flex items-start justify-between mb-3">
                  <Link
                    href={`/souls/${pass.series.id}`}
                    className="font-semibold text-sm transition-colors hover:text-[var(--accent-cyan)]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {pass.series.name}
                  </Link>
                  <span className="badge badge-cyan text-xs">{pass.series.category}</span>
                </div>
                <PassStatus pass={pass} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
