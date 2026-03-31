'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'
import { SoulCard } from '@web/components/souls/soul-card'
import { SoulRow } from '@web/components/souls/soul-row'
import { MySoulsTabs } from '@web/components/souls/my-souls-tabs'
import { EmptyState } from '@web/components/souls/empty-state'
import { useMySouls } from '@web/lib/souls/queries'

type TabId = 'authored' | 'owned' | 'allowlisted'

function PencilIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15.232 5.232l3.536 3.536M9 11l6.536-6.536a2 2 0 012.828 2.828L11.828 13.828a2 2 0 01-.924.534l-3.9.975.975-3.9A2 2 0 019 11z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BagIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function MySoulsPage() {
  const { user, loading: authLoading, getAuthHeaders } = useAuth()
  const { data, isLoading, error } = useMySouls(user?.id ?? null, getAuthHeaders)
  const [activeTab, setActiveTab] = useState<TabId>('authored')

  const tabs = [
    { id: 'authored', label: 'Authored', count: data?.authored.length ?? 0 },
    { id: 'owned', label: 'Owned', count: data?.owned.length ?? 0 },
    { id: 'allowlisted', label: 'Allowlisted', count: data?.allowlisted.length ?? 0 },
  ]

  const loading = authLoading || isLoading

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-8">

        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p
              className="text-[11px] uppercase tracking-[0.16em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Soul Studio
            </p>
            <h1
              className="text-[2.5rem] font-extrabold leading-tight"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              My Souls
            </h1>
          </div>
          {user && (
            <Link href="/souls/publish" className="btn btn-primary">
              Publish Soul
            </Link>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        )}

        {/* Not signed in */}
        {!loading && !user && (
          <EmptyState
            icon={<UserIcon />}
            heading="Sign in to view your Soul collection"
            description="Connect your Privy account to see the Souls you have authored, own, or have been granted access to."
          />
        )}

        {/* Error */}
        {!loading && user && (error || !data) && (
          <div style={{ color: 'var(--accent-rose)' }}>Failed to load your Souls.</div>
        )}

        {/* Tabs + content */}
        {!loading && user && data && (
          <div className="flex flex-col gap-6">
            <MySoulsTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(id) => setActiveTab(id as TabId)}
            />

            <div role="tabpanel">

              {/* Authored */}
              {activeTab === 'authored' && (
                data.authored.length > 0 ? (
                  <>
                    {/* Desktop: rows */}
                    <div className="hidden md:flex flex-col gap-2 stagger-children">
                      {data.authored.map((soul) => (
                        <SoulRow key={soul.onChainId} soul={soul} />
                      ))}
                    </div>
                    {/* Mobile: cards */}
                    <div className="grid gap-6 md:hidden">
                      {data.authored.map((soul) => (
                        <SoulCard key={soul.onChainId} soul={soul} />
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<PencilIcon />}
                    heading="You haven't published any Souls yet."
                    description="Share your knowledge, tools, or creative work as a Soul on the marketplace."
                    ctaLabel="Publish your first Soul"
                    ctaHref="/souls/publish"
                  />
                )
              )}

              {/* Owned */}
              {activeTab === 'owned' && (
                data.owned.length > 0 ? (
                  <>
                    <div className="hidden md:flex flex-col gap-2 stagger-children">
                      {data.owned.map((soul) => (
                        <SoulRow key={soul.onChainId} soul={soul} />
                      ))}
                    </div>
                    <div className="grid gap-6 md:hidden">
                      {data.owned.map((soul) => (
                        <SoulCard key={soul.onChainId} soul={soul} />
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<BagIcon />}
                    heading="You don't own any Souls yet."
                    description="Browse the marketplace to find and purchase Souls from other creators."
                    ctaLabel="Browse Souls"
                    ctaHref="/souls"
                  />
                )
              )}

              {/* Allowlisted */}
              {activeTab === 'allowlisted' && (
                data.allowlisted.length > 0 ? (
                  <>
                    <div className="hidden md:flex flex-col gap-2 stagger-children">
                      {data.allowlisted.map((soul) => (
                        <SoulRow key={soul.onChainId} soul={soul} />
                      ))}
                    </div>
                    <div className="grid gap-6 md:hidden">
                      {data.allowlisted.map((soul) => (
                        <SoulCard key={soul.onChainId} soul={soul} />
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={<KeyIcon />}
                    heading="No one has granted you access yet."
                    description="Soul owners can grant your wallet address access to their content without transferring ownership. Souls you have been allowlisted on will appear here."
                  />
                )
              )}

            </div>
          </div>
        )}

      </main>
    </div>
  )
}
