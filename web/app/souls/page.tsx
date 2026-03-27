'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PublicNav } from '@web/components/public-nav'
import { SoulCard } from '@web/components/souls/soul-card'
import { useSoulsList } from '@web/lib/souls/queries'

export default function SoulsPage() {
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useSoulsList({ q })

  return (
    <div className="min-h-screen">
      <PublicNav />
      <main className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              Soul Market
            </p>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              One-of-one Souls
            </h1>
          </div>
          <Link href="/souls/publish" className="px-4 py-2 rounded-xl font-medium" style={{ background: 'var(--accent-cyan)', color: '#02131a' }}>
            Publish Soul
          </Link>
        </div>

        <div className="glass-panel p-4">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search Souls"
            className="w-full bg-transparent outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : error ? (
          <div style={{ color: 'var(--accent-rose)' }}>Failed to load Souls.</div>
        ) : data && data.items.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((soul) => (
              <SoulCard key={soul.onChainId} soul={soul} />
            ))}
          </div>
        ) : (
          <div className="glass-panel p-8 text-center" style={{ color: 'var(--text-muted)' }}>
            No Souls listed right now.
          </div>
        )}
      </main>
    </div>
  )
}
