'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLogin } from '@/lib/hooks/use-login'
import { useMySouls } from '@/lib/hooks/use-souls'
import { useAuth } from '@/components/providers/auth-provider'
import { useBookmarks } from '@/lib/hooks/use-social'
import { Tag } from '@/components/ui/tag'
import { EmptyState } from '@/components/ui/empty-state'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { buttonStyles } from '@/components/ui/button'
import { GrantModal } from '@/components/souls/grant-modal'
import { SoulCoverImage } from '@/components/souls/soul-cover-image'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import { CollectionSection } from '@/components/collections/collection-section'
import type { MySoulEntry, SoulCollectionAssetSummary, SoulGrantRecord, SoulGrantStatus, SoulAssetSummary } from '@/lib/soulidity/types'

const tabs = [
  { id: 'owned', label: 'Owned' },
  { id: 'collections', label: 'Collections' },
  { id: 'listings', label: 'Listings' },
  { id: 'activity', label: 'Activity' },
  { id: 'bookmarks', label: 'Bookmarks' },
] as const

type TabId = typeof tabs[number]['id']

function formatAddress(value: string | null | undefined) {
  if (!value) return '\u2014'
  return `${value.slice(0, 6)}\u2026${value.slice(-4)}`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const fallbackSoulEmojis = ['🤖', '🦊', '👾', '🛰️', '📡', '⚙️', '🌸', '🧿']

function getFallbackSoulEmoji(soul: MySoulEntry) {
  const name = soul.name.toLowerCase()
  if (name.includes('akira') || name.includes('kaze') || name.includes('fox') || name.includes('kitsune')) return '🦊'
  if (name.includes('alpha') || name.includes('scout') || name.includes('agent') || name.includes('cyber')) return '🤖'
  if (name.includes('beast') || name.includes('dragon')) return '👾'
  const hash = Array.from(soul.name).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return fallbackSoulEmojis[hash % fallbackSoulEmojis.length]
}

/* ------------------------------------------------------------------ */
/*  Soul Card — unified for Owned + Listings tabs                      */
/* ------------------------------------------------------------------ */

function SoulCard({ soul, onGrantClick }: { soul: MySoulEntry; onGrantClick: () => void }) {
  const isListed = soul.listingStatus === 'listed' || soul.listingStatus === 'floor-violation'
  const isFloorViolation = soul.listingStatus === 'floor-violation'
  const hasActiveGrant = soul.activeGrantCount > 0
  const detailHref = `/souls/${encodeURIComponent(soul.onChainId)}`
  const sellHref = `/souls/${encodeURIComponent(soul.onChainId)}/sell`
  const provenanceVerb = soul.provenanceKind === 'native'
    ? 'created'
    : soul.provenanceKind === 'imported'
      ? 'imported'
      : 'expanded'

  return (
    <div className="overflow-hidden rounded-xl">
      {/* Main row */}
      <div className="flex flex-col gap-4 rounded-t-xl border border-b-0 border-border bg-card2 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <Link href={detailHref} className="flex min-w-0 items-center gap-3 cursor-pointer">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-[linear-gradient(135deg,var(--card2),var(--purple-deep))] text-xl">
            {soul.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={soul.imageUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <span aria-hidden="true">{getFallbackSoulEmoji(soul)}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-foreground">{soul.name}</div>
            <div className="mt-0.5 text-xs text-muted">
              Soul &middot; {provenanceVerb}
              {isListed && <> &middot; listed {formatDate(soul.updatedAt)}</>}
              {!isListed && <> {formatDate(soul.createdAt)}</>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              {soul.provenanceKind === 'native' && (
                <span className="text-purple">{'\u2726'} Created from scratch</span>
              )}
              {soul.provenanceKind === 'imported' && (
                <>
                  <span className="text-teal">{'\u2191'} Imported</span>
                  {soul.collectionName && (
                    <span className="text-teal">{'\uD83D\uDD17'} In Collection: {soul.collectionName}</span>
                  )}
                </>
              )}
              {soul.provenanceKind === 'personal-join' && (
                <span className="text-teal">{'\uD83D\uDD17'} Personal Join &middot; {soul.collectionName ?? 'Unknown'}</span>
              )}
            </div>
          </div>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Tag color={hasActiveGrant ? 'teal' : 'muted'} className="text-[10px]">
            {hasActiveGrant ? 'Grant Active' : 'No Grant'}
          </Tag>
          <button onClick={onGrantClick} className={buttonStyles({ variant: 'primary', size: 'sm' })}>
            {hasActiveGrant ? '\uD83D\uDD10 Manage Grant' : '\uD83D\uDD13 Grant Access'}
          </button>
          {isListed ? (
            <>
              <Tag color={isFloorViolation ? 'danger' : 'success'}>{isFloorViolation ? 'Below Floor' : 'Listed'}</Tag>
              <span className="text-sm font-semibold text-gold">
                {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : '\u2014'}
              </span>
              <Link href={detailHref} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
                {isFloorViolation ? 'Update Price' : 'Delist'}
              </Link>
            </>
          ) : (
            <Link href={sellHref} className={buttonStyles({ variant: 'gold', size: 'sm' })}>
              Sell
            </Link>
          )}
        </div>
      </div>

      {/* Listing bar — shown first when listed */}
      {isListed && (
        <div className={`flex flex-col gap-1 border border-b-0 border-t-0 px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between ${
          isFloorViolation
            ? 'border-danger/25 bg-danger/[0.06]'
            : 'border-success/25 bg-success/[0.06]'
        }`}>
          <span className={`font-semibold ${isFloorViolation ? 'text-danger' : 'text-success'}`}>
            {isFloorViolation ? '\u26A0 Below collection floor' : '\uD83D\uDDA5 Active listing'}
          </span>
          <span className="text-muted">
            {isFloorViolation
              ? 'Listed on Sui but hidden from marketplace \u00b7 delist or update price'
              : 'Listed on Sui \u00b7 visible in Market \u00b7 delist anytime before sale'}
          </span>
        </div>
      )}

      {/* Grant / provenance info bar */}
      {soul.provenanceKind === 'personal-join' ? (
        <div className="flex items-center gap-2 rounded-b-xl border border-t-0 border-teal/25 bg-teal/[0.08] px-4 py-2 text-[11px]">
          <span className="font-semibold text-teal">{'\uD83D\uDD17'} Wrap+Link Soul</span>
          <span className="text-muted">
            Original NFT: {soul.collectionName ?? 'Unknown'} &middot; Token {soul.originRef ? `#${soul.originRef}` : '\u2014'} &middot; Unchanged on Sui
          </span>
        </div>
      ) : hasActiveGrant && soul.activeGrantDetails.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-teal/25 bg-teal/[0.08] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-teal">{'\uD83D\uDD10'} Active grant:</span>
            <span className="truncate font-mono text-foreground">{formatAddress(soul.activeGrantDetails[0].granteeAddress)}</span>
          </div>
          <span className="text-muted">
            Authorized {formatDate(soul.activeGrantDetails[0].createdAt)}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-purple/20 bg-purple/[0.06] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:gap-2">
          <span className="text-muted">No agent authorized yet.</span>
          <button onClick={onGrantClick} className="font-semibold text-purple hover:text-foreground cursor-pointer text-left">
            Authorize an agent to access this Soul&apos;s data {'\u2192'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Listed Collection Card                                             */
/* ------------------------------------------------------------------ */

function ListedCollectionCard({ collection }: { collection: SoulCollectionAssetSummary }) {
  const detailHref = `/collections/${encodeURIComponent(collection.onChainId)}`

  return (
    <div className="overflow-hidden rounded-xl">
      <div className="flex flex-col gap-4 rounded-t-xl border border-b-0 border-border bg-card2 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <Link href={detailHref} className="flex min-w-0 items-center gap-3 cursor-pointer">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-[linear-gradient(135deg,var(--card2),var(--purple-deep))] text-xl">
            {collection.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={collection.imageUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <span aria-hidden="true">{'\uD83D\uDCE6'}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-foreground">{collection.name}</div>
            <div className="mt-0.5 text-xs text-muted">
              Soul Collection &middot; listed {formatDate(collection.updatedAt)}
            </div>
            <div className="mt-0.5 text-[11px] text-teal">
              Royalty rights &middot; {(collection.extraRoyaltyBps / 100).toFixed(0)}% on all Soul resales
            </div>
          </div>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Tag color="success">Listed</Tag>
          <span className="text-sm font-semibold text-gold">
            {collection.listedPriceAtomic ? formatAtomicAmountForDisplay(collection.listedPriceAtomic) : '\u2014'}
          </span>
          <Link href={detailHref} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
            Delist
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-success/25 bg-success/[0.06] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-success">{'\uD83D\uDDA5'} Active listing</span>
        <span className="text-muted">Soul Collection &middot; royalty rights on {collection.soulCount} Souls &middot; delist anytime</span>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/*  Grant Row                                                          */
/* ------------------------------------------------------------------ */

function GrantRow({ grant }: { grant: SoulGrantRecord }) {
  return (
    <div className="card rounded-xl p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Tag color={grant.status === 'active' ? 'success' : grant.status === 'revoked' ? 'danger' : grant.status === 'expired' ? 'gold' : 'muted'}>
              {grant.status}
            </Tag>
            {grant.scopes.map((scope) => (
              <Tag key={`${grant.id}:${scope}`} color="teal">{scope}</Tag>
            ))}
          </div>
          <div className="text-xs text-muted mt-1">
            {formatAddress(grant.issuedByAddress)} {'\u2192'} {formatAddress(grant.granteeAddress)}
          </div>
        </div>
        <div className="text-xs text-muted">
          {grant.endedAt
            ? `Ended ${formatDate(grant.endedAt)}`
            : grant.expiresAt
              ? `Expires ${formatDate(grant.expiresAt)}`
              : 'No expiry'}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const GRANT_STATUS_FILTERS = ['all', 'active', 'expired', 'revoked', 'superseded', 'invalidated'] as const satisfies readonly ('all' | SoulGrantStatus)[]
type GrantStatusFilter = (typeof GRANT_STATUS_FILTERS)[number]

function sumListedValueAtomic(entries: Array<{ listedPriceAtomic: string | null }>): string | null {
  try {
    const total = entries.reduce((acc, s) => {
      if (!s.listedPriceAtomic) return acc
      return acc + BigInt(s.listedPriceAtomic)
    }, 0n)
    return total === 0n ? null : total.toString()
  } catch {
    return null
  }
}

function PortfolioStrip({ data }: { data: NonNullable<ReturnType<typeof useMySouls>['data']> }) {
  // Must track the same active sale set as the Listings tab (listed + floor-violation Souls,
  // plus listed collection caps). Otherwise a seller with only a listed collection cap sees
  // "0 listed / —" while the Listings tab shows an active sale.
  const listedSouls = data.owned.filter((s) => s.listingStatus === 'listed' || s.listingStatus === 'floor-violation')
  const listedCollections = data.collections.filter((c) => c.listingStatus === 'listed')
  const listedTotalAtomic = sumListedValueAtomic([...listedSouls, ...listedCollections])
  const listedCount = listedSouls.length + listedCollections.length
  const activeGrants = data.owned.reduce((acc, s) => acc + (s.activeGrantCount ?? 0), 0)
  const pendingActions = data.owned.filter((s) => s.listingStatus === 'floor-violation').length

  const items = [
    {
      label: 'Listed value',
      value: listedTotalAtomic ? formatAtomicAmountForDisplay(listedTotalAtomic) : '—',
      color: 'text-gold',
      hint: `${listedCount} listed`,
    },
    {
      label: 'Royalty (30d)',
      value: '—',
      color: 'text-foreground',
      hint: 'tracking soon',
    },
    {
      label: 'Active grants',
      value: activeGrants.toLocaleString(),
      color: 'text-purple',
      hint: `${data.owned.length} Souls`,
    },
    {
      label: 'Pending sigs',
      value: pendingActions.toLocaleString(),
      color: pendingActions > 0 ? 'text-danger' : 'text-muted',
      hint: pendingActions > 0 ? 'needs review' : 'all clear',
    },
  ]

  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border bg-[rgba(26,16,64,0.55)] px-3.5 py-3 backdrop-blur-[8px]"
        >
          <div className={'font-display text-[22px] font-extrabold leading-none tracking-[-0.02em] ' + item.color}>
            {item.value}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] uppercase tracking-[0.08em] text-muted">
            <span className="font-semibold">{item.label}</span>
            <span className="normal-case tracking-normal text-muted/70">{item.hint}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function grantsToCsv(grants: SoulGrantRecord[]): string {
  const header = ['id', 'status', 'scopes', 'grantee', 'issuedBy', 'createdAt', 'expiresAt', 'endedAt']
  const rows = grants.map((g) => [
    g.id,
    g.status,
    g.scopes.join('|'),
    g.granteeAddress,
    g.issuedByAddress,
    g.createdAt ?? '',
    g.expiresAt ?? '',
    g.endedAt ?? '',
  ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(','))
  return [header.join(','), ...rows].join('\n')
}

function downloadGrantsCsv(grants: SoulGrantRecord[]) {
  if (typeof window === 'undefined') return
  const csv = grantsToCsv(grants)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `soulidity-grants-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function MySoulsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('owned')
  const [grantModalSoul, setGrantModalSoul] = useState<MySoulEntry | null>(null)
  const [activeGrantsOnly, setActiveGrantsOnly] = useState(false)
  const [grantStatusFilter, setGrantStatusFilter] = useState<GrantStatusFilter>('all')
  const { user, loading, getAuthHeaders } = useAuth()
  const login = useLogin()
  const { data: myData, isLoading } = useMySouls(user?.id ?? null, getAuthHeaders)
  const { data: bookmarksData, isLoading: bookmarksLoading } = useBookmarks()

  const ownedCount = myData?.owned.length ?? 0
  const listingsCount = (myData?.owned.filter((s) => s.listingStatus === 'listed' || s.listingStatus === 'floor-violation').length ?? 0)
    + (myData?.collections.filter((c) => c.listingStatus === 'listed').length ?? 0)

  if (loading) {
    return (
      <PageContainer>
        <div className="h-8 w-32 rounded bg-card2 animate-pulse mb-6" />
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[120px] rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      </PageContainer>
    )
  }

  if (!user) {
    return (
      <PageContainer>
        <EmptyState
          icon={'\uD83E\uDEAA'}
          label="Sign in to load your Soulidity portfolio"
          sublabel="Owned Souls, collections, and grant records are fetched from authenticated routes."
          actionLabel="Sign In"
          onAction={login}
        />
      </PageContainer>
    )
  }

  const listings = myData?.owned.filter((s) => s.listingStatus === 'listed' || s.listingStatus === 'floor-violation') ?? []
  const listedCollections = myData?.collections.filter((c) => c.listingStatus === 'listed') ?? []

  const collectionsCount = myData?.collections.length ?? 0
  const bookmarksCount = bookmarksData?.bookmarks.length ?? 0

  const tabsWithCounts = tabs.map((tab) => {
    const count = tab.id === 'owned'
      ? ownedCount
      : tab.id === 'collections'
        ? collectionsCount
        : tab.id === 'listings'
          ? listingsCount
          : tab.id === 'bookmarks'
            ? bookmarksCount
            : null
    return { id: tab.id, label: count != null ? `${tab.label} (${count})` : tab.label }
  })

  return (
    <PageContainer>
      <SectionHeader
        label="Dashboard"
        title="My Souls"
        subtitle="Manage the souls you currently hold"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/profile" className={buttonStyles({ variant: 'outline', size: 'sm' }) + ' text-xs'}>
              {'\u270F\uFE0F'} Edit Public Profile
            </Link>
            <Link href="/create" className={buttonStyles({ variant: 'primary' })}>
              + Create Soul
            </Link>
          </div>
        }
      />

      {myData && <div className="mt-5"><PortfolioStrip data={myData} /></div>}

      <div className="mb-6">
        <FilterTabs
          tabs={tabsWithCounts}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as TabId)}
        />
      </div>

      {isLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[120px] rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && myData && activeTab === 'owned' && (() => {
        if (myData.owned.length === 0) {
          return <EmptyState icon={'\uD83E\uDEE5'} label="No owned Souls yet" sublabel="Purchased or freshly minted Souls will appear here." />
        }
        const filteredOwned = activeGrantsOnly
          ? myData.owned.filter((s) => s.activeGrantCount > 0)
          : myData.owned
        return (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em]">
                Souls you hold
              </p>
              <button
                type="button"
                onClick={() => setActiveGrantsOnly((v) => !v)}
                className={
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ' +
                  (activeGrantsOnly
                    ? 'border-purple bg-purple/12 text-purple'
                    : 'border-border bg-transparent text-muted hover:border-purple hover:text-purple')
                }
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                Active grants only
                {activeGrantsOnly && (
                  <span className="ml-1 rounded-full bg-purple/20 px-1.5 py-0.5 text-[10px] font-bold">
                    {myData.owned.filter((s) => s.activeGrantCount > 0).length}
                  </span>
                )}
              </button>
            </div>
            {filteredOwned.length > 0 ? (
              <div className="flex flex-col gap-3">
                {filteredOwned.map((soul) => <SoulCard key={soul.id} soul={soul} onGrantClick={() => setGrantModalSoul(soul)} />)}
              </div>
            ) : (
              <EmptyState
                icon={'\uD83D\uDD10'}
                label="No Souls match the active grants filter"
                sublabel="None of your owned Souls currently have active grants."
                actionLabel="Show all Souls"
                onAction={() => setActiveGrantsOnly(false)}
              />
            )}
          </>
        )
      })()}

      {!isLoading && myData && activeTab === 'collections' && (
        myData.collections.length > 0 ? (
          <CollectionSection collections={myData.collections} currentUserId={user?.id ?? null} />
        ) : (
          <EmptyState icon={'\uD83D\uDCE6'} label="No collection rights yet" sublabel="Collection rights held by this account will show here." />
        )
      )}

      {!isLoading && myData && activeTab === 'listings' && (
        listings.length > 0 || listedCollections.length > 0 ? (
          <div className="space-y-6">
            {listings.length > 0 && (
              <>
                <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em]">
                  Souls listed for sale
                </p>
                <div className="flex flex-col gap-3">
                  {listings.map((soul) => <SoulCard key={soul.id} soul={soul} onGrantClick={() => setGrantModalSoul(soul)} />)}
                </div>
              </>
            )}
            {listedCollections.length > 0 && (
              <>
                <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em]">
                  Soul Collections listed for sale
                </p>
                <div className="flex flex-col gap-3">
                  {listedCollections.map((c) => <ListedCollectionCard key={c.id} collection={c} />)}
                </div>
              </>
            )}
          </div>
        ) : (
          <EmptyState icon={'\uD83C\uDFF7\uFE0F'} label="No active listings" sublabel="List a Soul for sale and it will appear here." />
        )
      )}

      {!isLoading && myData && activeTab === 'activity' && (() => {
        if (myData.grants.length === 0) {
          return <EmptyState icon={'\uD83D\uDD10'} label="No activity yet" sublabel="Grant records and activity will appear here." />
        }
        const filteredGrants = grantStatusFilter === 'all'
          ? myData.grants
          : myData.grants.filter((g) => g.status === grantStatusFilter)
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {GRANT_STATUS_FILTERS.map((status) => {
                  const count = status === 'all'
                    ? myData.grants.length
                    : myData.grants.filter((g) => g.status === status).length
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setGrantStatusFilter(status)}
                      className={
                        'rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition-colors ' +
                        (grantStatusFilter === status
                          ? 'border-purple bg-purple/12 text-purple'
                          : 'border-border bg-transparent text-muted hover:border-purple hover:text-purple')
                      }
                    >
                      {status} <span className="ml-0.5 font-mono opacity-70">{count}</span>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => downloadGrantsCsv(filteredGrants)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:border-purple hover:text-purple"
                title="Download CSV of filtered grants"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                Export CSV
              </button>
            </div>
            {filteredGrants.length > 0 ? (
              <div className="flex flex-col gap-3">
                {filteredGrants.map((grant) => <GrantRow key={grant.id} grant={grant} />)}
              </div>
            ) : (
              <EmptyState
                icon={'\uD83D\uDD10'}
                label={`No ${grantStatusFilter} grants`}
                sublabel="Try a different status filter to see more grant records."
                actionLabel="Show all grants"
                onAction={() => setGrantStatusFilter('all')}
              />
            )}
          </div>
        )
      })()}

      {activeTab === 'bookmarks' && (
        bookmarksLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[200px] rounded-xl bg-card animate-pulse" />
            ))}
          </div>
        ) : !bookmarksData || bookmarksData.bookmarks.length === 0 ? (
          <EmptyState
            icon={'\uD83D\uDD16'}
            label="No bookmarks yet"
            sublabel="Bookmark Souls from the marketplace to save them here."
          />
        ) : (
          <>
            <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em] mb-3">
              Bookmarked Souls
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bookmarksData.bookmarks.map((soul: SoulAssetSummary) => (
                <Link
                  key={soul.id}
                  href={`/souls/${encodeURIComponent(soul.onChainId)}`}
                  className="overflow-hidden rounded-xl border border-border bg-card hover:border-purple hover:-translate-y-0.5 transition block"
                >
                  <SoulCoverImage
                    imageUrl={soul.imageUrl}
                    className="aspect-[4/5]"
                    fallback={<span className="text-3xl">🤖</span>}
                  />
                  <div className="p-3 space-y-1.5">
                    <div className="text-sm font-bold text-foreground truncate">{soul.name}</div>
                    <div className="text-xs text-muted line-clamp-2 leading-relaxed">{soul.description}</div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] uppercase text-muted tracking-wide">{soul.tags[0] ?? 'Soul'}</span>
                      <span className="text-xs font-bold text-gold">
                        {soul.listedPriceAtomic ? formatAtomicAmountForDisplay(soul.listedPriceAtomic) : 'Held'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )
      )}

      {grantModalSoul && (
        <GrantModal
          soul={grantModalSoul}
          open
          onClose={() => setGrantModalSoul(null)}
        />
      )}
    </PageContainer>
  )
}
