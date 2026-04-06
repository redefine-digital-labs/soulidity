'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { useMySouls } from '@/lib/hooks/use-souls'
import { useAuth } from '@/components/providers/auth-provider'
import { Tag } from '@/components/ui/tag'
import { EmptyState } from '@/components/ui/empty-state'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { buttonStyles } from '@/components/ui/button'
import { GrantModal } from '@/components/souls/grant-modal'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'
import { CollectionSection } from '@/components/collections/collection-section'
import type { MySoulEntry, SoulCollectionAssetSummary, SoulGrantRecord } from '@/lib/soulidity/types'

const tabs = [
  { id: 'owned', label: 'Owned' },
  { id: 'collections', label: 'Collections' },
  { id: 'listings', label: 'Listings' },
  { id: 'activity', label: 'Activity' },
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

export default function MySoulsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('owned')
  const [grantModalSoul, setGrantModalSoul] = useState<MySoulEntry | null>(null)
  const { user, loading, getAuthHeaders } = useAuth()
  const { login, ready } = usePrivy()
  const { data: myData, isLoading } = useMySouls(user?.id ?? null, getAuthHeaders)

  const ownedCount = myData?.owned.length ?? 0
  const listingsCount = (myData?.owned.filter((s) => s.listingStatus === 'listed' || s.listingStatus === 'floor-violation').length ?? 0)
    + (myData?.collections.filter((c) => c.listingStatus === 'listed').length ?? 0)

  if (loading || !ready) {
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
          onAction={() => { void login() }}
        />
      </PageContainer>
    )
  }

  const listings = myData?.owned.filter((s) => s.listingStatus === 'listed' || s.listingStatus === 'floor-violation') ?? []
  const listedCollections = myData?.collections.filter((c) => c.listingStatus === 'listed') ?? []

  const collectionsCount = myData?.collections.length ?? 0

  const tabsWithCounts = tabs.map((tab) => {
    const count = tab.id === 'owned'
      ? ownedCount
      : tab.id === 'collections'
        ? collectionsCount
        : tab.id === 'listings'
          ? listingsCount
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

      <div className="mt-5 mb-6">
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

      {!isLoading && myData && activeTab === 'owned' && (
        myData.owned.length > 0 ? (
          <>
            <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em] mb-3">
              Souls you hold
            </p>
            <div className="flex flex-col gap-3">
              {myData.owned.map((soul) => <SoulCard key={soul.id} soul={soul} onGrantClick={() => setGrantModalSoul(soul)} />)}
            </div>
          </>
        ) : (
          <EmptyState icon={'\uD83E\uDEE5'} label="No owned Souls yet" sublabel="Purchased or freshly minted Souls will appear here." />
        )
      )}

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

      {!isLoading && myData && activeTab === 'activity' && (
        myData.grants.length > 0 ? (
          <div className="flex flex-col gap-3">
            {myData.grants.map((grant) => <GrantRow key={grant.id} grant={grant} />)}
          </div>
        ) : (
          <EmptyState icon={'\uD83D\uDD10'} label="No activity yet" sublabel="Grant records and activity will appear here." />
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
