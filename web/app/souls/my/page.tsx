'use client'

import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'
import { SoulCard } from '@web/components/souls/soul-card'
import { useMySouls } from '@web/lib/souls/queries'

export default function MySoulsPage() {
  const { user, loading: authLoading, getAuthHeaders } = useAuth()
  const { data, isLoading, error } = useMySouls(user?.id ?? null, getAuthHeaders)

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              Soul Studio
            </p>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              My Souls
            </h1>
          </div>
          <Link href="/souls/publish" className="px-4 py-2 rounded-xl font-medium" style={{ background: 'var(--accent-cyan)', color: '#02131a' }}>
            Publish Soul
          </Link>
        </div>

        {authLoading || isLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : !user ? (
          <div className="glass-panel p-8 text-center" style={{ color: 'var(--text-muted)' }}>
            Sign in to view your Souls.
          </div>
        ) : error || !data ? (
          <div style={{ color: 'var(--accent-rose)' }}>Failed to load your Souls.</div>
        ) : (
          <>
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Authored</h2>
              {data.authored.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {data.authored.map((soul) => <SoulCard key={soul.onChainId} soul={soul} />)}
                </div>
              ) : (
                <div className="glass-panel p-6" style={{ color: 'var(--text-muted)' }}>You have not published any Souls yet.</div>
              )}
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Owned</h2>
              {data.owned.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {data.owned.map((soul) => <SoulCard key={soul.onChainId} soul={soul} />)}
                </div>
              ) : (
                <div className="glass-panel p-6" style={{ color: 'var(--text-muted)' }}>You do not own any Souls yet.</div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
