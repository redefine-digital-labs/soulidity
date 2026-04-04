'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { useMySouls } from '@/lib/hooks/use-souls'
import { useAuth } from '@/components/providers/auth-provider'
import { Tag } from '@/components/ui/tag'
import { EmptyState } from '@/components/ui/empty-state'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import type { MySoulsResponse } from '@/lib/soulidity/types'

const tabs = [
  { id: 'owned', label: 'Owned' },
  { id: 'authored', label: 'Authored' },
  { id: 'granted', label: 'Granted' },
  { id: 'collections', label: 'Collections' },
  { id: 'grants', label: 'Grant Records' },
] as const

type TabId = typeof tabs[number]['id']

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function SoulRow({ soul }: { soul: MySoulsResponse['owned'][number] }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 bg-card2 rounded-[10px] border border-border sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-bold text-sm">{soul.name}</div>
          <Tag color={soul.listingStatus === 'listed' ? 'gold' : 'muted'}>{soul.listingStatus}</Tag>
          {soul.activeGrantCount > 0 && <Tag color="teal">{soul.activeGrantCount} active grant{soul.activeGrantCount > 1 ? 's' : ''}</Tag>}
          {soul.skillsOnChainId && <Tag color="purple">skills</Tag>}
        </div>
        <div className="text-muted text-xs mt-1">
          Creator {formatAddress(soul.creatorAddress)}
          {soul.collectionOnChainId && <span className="ml-2 text-teal">Collection bound</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gold font-semibold">
          {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Not listed'}
        </span>
        <Link
          href={`/souls/${encodeURIComponent(soul.onChainId)}`}
          className="bg-transparent text-foreground border border-border font-semibold text-xs px-3 py-1.5 rounded-lg hover:border-purple transition"
        >
          View
        </Link>
      </div>
    </div>
  )
}

export default function MySoulsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('owned')
  const { user, loading, getAuthHeaders } = useAuth()
  const { login, ready } = usePrivy()
  const { data: myData, isLoading } = useMySouls(user?.id ?? null, getAuthHeaders)

  if (loading || !ready) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="h-8 w-32 rounded bg-card2 animate-pulse mb-6" />
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[84px] rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-12">
        <EmptyState
          icon="🪪"
          label="Sign in to load your Soulidity portfolio"
          sublabel="Owned Souls, collections, and grant records are fetched from authenticated routes."
          actionLabel="Sign In"
          onAction={() => {
            void login()
          }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 relative z-10">
      <div className="mb-6">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Portfolio</p>
        <h1 className="font-display text-2xl font-bold">My Souls</h1>
      </div>

      <div className="flex overflow-x-auto border-b border-border mb-6" style={{ scrollbarWidth: 'none' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-semibold cursor-pointer border-b-2 -mb-px transition ${
              activeTab === tab.id
                ? 'text-purple border-purple'
                : 'text-muted border-transparent hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[84px] rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && myData && activeTab === 'owned' && (
        myData.owned.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {myData.owned.map((soul) => <SoulRow key={soul.id} soul={soul} />)}
          </div>
        ) : (
          <EmptyState icon="🫥" label="No owned Souls yet" sublabel="Purchased or freshly minted Souls will appear here." />
        )
      )}

      {!isLoading && myData && activeTab === 'authored' && (
        myData.authored.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {myData.authored.map((soul) => <SoulRow key={soul.id} soul={soul} />)}
          </div>
        ) : (
          <EmptyState icon="✍️" label="No authored Souls yet" sublabel="Create, import, or personal-join a Soul to populate this tab." />
        )
      )}

      {!isLoading && myData && activeTab === 'granted' && (
        myData.granted.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {myData.granted.map((soul) => <SoulRow key={soul.id} soul={soul} />)}
          </div>
        ) : (
          <EmptyState icon="🫱" label="No granted Souls" sublabel="Souls shared to this wallet via SoulGrant will appear here." />
        )
      )}

      {!isLoading && myData && activeTab === 'collections' && (
        myData.collections.length > 0 ? (
          <div className="flex flex-col gap-3">
            {myData.collections.map((collection) => (
              <div key={collection.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-bold text-sm">{collection.name}</div>
                      <Tag color={collection.listingStatus === 'listed' ? 'gold' : collection.tradeable ? 'muted' : 'danger'}>
                        {collection.listingStatus === 'listed' ? 'listed' : collection.tradeable ? 'held' : 'non-tradeable'}
                      </Tag>
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {collection.soulCount} Souls · Holder {formatAddress(collection.currentHolderAddress)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gold font-semibold">
                      {collection.listedPriceAtomic ? formatAtomicAmountForDisplay(collection.listedPriceAtomic) : 'Not listed'}
                    </span>
                    <Link
                      href={`/collections/${encodeURIComponent(collection.onChainId)}`}
                      className="bg-transparent text-foreground border border-border font-semibold text-xs px-3 py-1.5 rounded-lg hover:border-purple transition"
                    >
                      View
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="📦" label="No collection rights yet" sublabel="Collection rights held by this account will show here." />
        )
      )}

      {!isLoading && myData && activeTab === 'grants' && (
        myData.grants.length > 0 ? (
          <div className="flex flex-col gap-3">
            {myData.grants.map((grant) => (
              <div key={grant.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{grant.status}</span>
                      <Tag color={grant.status === 'active' ? 'success' : grant.status === 'revoked' ? 'danger' : grant.status === 'expired' ? 'gold' : 'muted'}>
                        {grant.status}
                      </Tag>
                      {grant.scopes.map((scope) => (
                        <Tag key={`${grant.id}:${scope}`} color="teal">{scope}</Tag>
                      ))}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {formatAddress(grant.issuedByAddress)} → {formatAddress(grant.granteeAddress)}
                    </div>
                  </div>
                  <div className="text-xs text-muted">
                    {grant.endedAt
                      ? `Ended ${new Date(grant.endedAt).toLocaleString()}`
                      : grant.expiresAt
                        ? `Expires ${new Date(grant.expiresAt).toLocaleString()}`
                        : 'No expiry'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="🔐" label="No grant records yet" sublabel="Issued and received SoulGrant records are mirrored here." />
        )
      )}
    </div>
  )
}
