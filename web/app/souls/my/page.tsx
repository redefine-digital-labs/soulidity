'use client'

import { useState, type KeyboardEvent } from 'react'
import { useAuth } from '@web/components/auth-provider'
import { useMySouls } from '@web/lib/souls/queries'
import { SoulCard } from '@web/components/souls/soul-card'
import { PassStatus } from '@web/components/souls/pass-status'
import Link from 'next/link'

type MySoulsTab = 'published' | 'purchased'

const MY_SOULS_TABS: MySoulsTab[] = ['published', 'purchased']

function getNextMySoulsTab(current: MySoulsTab, key: string): MySoulsTab | null {
  const currentIndex = MY_SOULS_TABS.indexOf(current)
  if (currentIndex === -1) {
    return null
  }

  if (key === 'ArrowRight') {
    return MY_SOULS_TABS[(currentIndex + 1) % MY_SOULS_TABS.length]
  }
  if (key === 'ArrowLeft') {
    return MY_SOULS_TABS[(currentIndex - 1 + MY_SOULS_TABS.length) % MY_SOULS_TABS.length]
  }
  if (key === 'Home') {
    return MY_SOULS_TABS[0]
  }
  if (key === 'End') {
    return MY_SOULS_TABS[MY_SOULS_TABS.length - 1]
  }

  return null
}

export default function MySoulsPage() {
  const { user, getAuthHeaders } = useAuth()
  const [tab, setTab] = useState<MySoulsTab>('published')
  const { data, isLoading } = useMySouls(user?.id ?? null, getAuthHeaders)

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: MySoulsTab) {
    const nextTab = getNextMySoulsTab(currentTab, event.key)
    if (!nextTab) {
      return
    }

    event.preventDefault()
    setTab(nextTab)
    document.getElementById(`my-souls-tab-${nextTab}`)?.focus()
  }

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
      <div
        role="tablist"
        aria-label="Soul 列表"
        className="flex gap-4 mb-6"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <button
          id="my-souls-tab-published"
          type="button"
          role="tab"
          aria-selected={tab === 'published'}
          aria-controls="my-souls-panel-published"
          tabIndex={tab === 'published' ? 0 : -1}
          onClick={() => setTab('published')}
          onKeyDown={(event) => handleTabKeyDown(event, 'published')}
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
          id="my-souls-tab-purchased"
          type="button"
          role="tab"
          aria-selected={tab === 'purchased'}
          aria-controls="my-souls-panel-purchased"
          tabIndex={tab === 'purchased' ? 0 : -1}
          onClick={() => setTab('purchased')}
          onKeyDown={(event) => handleTabKeyDown(event, 'purchased')}
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
        <div
          role="status"
          aria-live="polite"
          className="text-center py-12"
          style={{ color: 'var(--text-muted)' }}
        >
          Loading...
        </div>
      ) : (
        <>
          <div
            id="my-souls-panel-published"
            role="tabpanel"
            aria-labelledby="my-souls-tab-published"
            hidden={tab !== 'published'}
          >
            {tab === 'published' ? (
              data?.published.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                    You haven&apos;t published any Souls yet
                  </p>
                  <Link href="/souls/publish" className="btn btn-primary text-sm mt-2 inline-flex">
                    Publish your first Soul
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {data?.published.map((soul) => (
                    <div key={soul.id}>
                      <SoulCard soul={soul} />
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </div>
          <div
            id="my-souls-panel-purchased"
            role="tabpanel"
            aria-labelledby="my-souls-tab-purchased"
            hidden={tab !== 'purchased'}
          >
            {tab === 'purchased' ? (
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
                          href={`/souls/${encodeURIComponent(pass.series.onChainId || pass.series.id)}`}
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
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
