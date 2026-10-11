'use client'

import { useLayoutEffect, useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useLogin } from '@/lib/hooks/use-login'
import { useMySouls } from '@/lib/hooks/use-souls'
import { usePrivateBookmarks } from '@/lib/hooks/use-private-bookmarks'
import { useBookmarkRows } from '@/lib/hooks/use-bookmark-rows'
import { PrivateBookmarkControls } from '@/components/bookmarks/private-bookmark-controls'
import { Tag } from '@/components/ui/tag'
import { EmptyState } from '@/components/ui/empty-state'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { FilterTabs } from '@/components/nav/filter-tabs'
import { buttonStyles } from '@/components/ui/button'
import { GrantModal } from '@/components/souls/grant-modal'
import { SoulCoverImage } from '@/components/souls/soul-cover-image'
import { NativeBatchListingPanel, batchSelectionId, type NativeBatchSelection } from '@/components/souls/native-batch-listing-panel'
import { OwnedEquipmentSelection } from '@/components/souls/owned-equipment-selection'
import { MAX_MARKET_BATCH_LIST_ROWS } from '@/lib/animacraft/market-batch-list-types'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { CollectionSection } from '@/components/collections/collection-section'
import { ListCollectionModal, EditCollectionPriceModal, DelistCollectionModal } from '@/components/collections/collection-listing-modals'
import type { CollectionAction } from '@/components/collections/collection-row-card'
import type { CollectionPublicSnapshot, SoulGrantStatus } from '@soulidity/sdk'
import type { PortfolioSoul } from '@/lib/soulidity/soul-portfolio-model'
import { formatChainTimestamp } from '@/lib/soulidity/soul-detail-model'
import { soulActivityGrantsCsv, type ChainSoulGrantActivity, type ChainSoulPurchaseActivity } from '@/lib/soulidity/soul-activity-model'
import type { MySoulsSection, MySoulsProgress } from '@/lib/soulidity/browser-my-souls'

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

const fallbackSoulEmojis = ['🤖', '🦊', '👾', '🛰️', '📡', '⚙️', '🌸', '🧿']

function getFallbackSoulEmoji(soul: PortfolioSoul) {
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

function SoulCard({ soul, onGrantClick, batch }: { soul: PortfolioSoul; onGrantClick: () => void;
  batch?:{selected:boolean;disabled:boolean;toggle:()=>void} }) {
  const isListed = soul.listingStatus === 'listed' || soul.listingStatus === 'floor-violation'
  const isFloorViolation = soul.listingStatus === 'floor-violation'
  const hasActiveGrant = BigInt(soul.effectiveGrantCount) > 0n
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
          <SoulCoverImage compact soul={soul} imageUrl={soul.imageUrl}
            className="h-11 w-11 shrink-0 rounded-lg border border-border text-xl"
            fallback={<span aria-hidden="true">{getFallbackSoulEmoji(soul)}</span>} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-foreground">{soul.name}</div>
            <div className="mt-0.5 text-xs text-muted">
              Soul &middot; {provenanceVerb}
              {isListed && <> &middot; listing date not recorded on chain</>}
              {!isListed && <> {formatChainTimestamp(soul.createdAtMs)}</>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              {soul.provenanceKind === 'native' && (
                <span className="text-action-label">{'\u2726'} Created from scratch</span>
              )}
              {soul.provenanceKind === 'imported' && (
                <>
                  <span className="text-teal">{'\u2191'} Imported</span>
                  {soul.collection?.name && (
                    <span className="text-teal">{'\uD83D\uDD17'} In Collection: {soul.collection.name}</span>
                  )}
                </>
              )}
              {soul.provenanceKind === 'personal-join' && (
                <span className="text-teal">{'\uD83D\uDD17'} Personal Join &middot; {soul.collection?.name ?? 'Unknown'}</span>
              )}
            </div>
          </div>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {batch && <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={`Select Soul ${soul.name}`} checked={batch.selected}
              disabled={batch.disabled} onChange={batch.toggle}/>
            Select Soul only
          </label>}
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
            Original NFT: {soul.collection?.name ?? 'Unknown'} &middot; Token {soul.originRef ? `#${soul.originRef}` : '\u2014'} &middot; Unchanged on Sui
          </span>
        </div>
      ) : hasActiveGrant && soul.activeGrantDetails.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-teal/25 bg-teal/[0.08] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-teal">{'\uD83D\uDD10'} Active grant:</span>
            <span className="truncate font-mono text-foreground">{formatAddress(soul.activeGrantDetails[0].granteeAddress)}</span>
          </div>
          <span className="text-muted">
            Authorized {formatChainTimestamp(soul.activeGrantDetails[0].createdAtMs)}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-purple/20 bg-purple/[0.06] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:gap-2">
          <span className="text-muted">No agent authorized yet.</span>
          <button onClick={onGrantClick} className="font-semibold text-action-label hover:text-foreground cursor-pointer text-left">
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

function ListedCollectionCard({ collection, onAction }: { collection: CollectionPublicSnapshot; onAction: (type: CollectionAction) => void }) {
  const detailHref = `/collections/${encodeURIComponent(collection.collectionId)}`

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
              Soul Collection &middot; listing date not recorded on chain
            </div>
            <div className="mt-0.5 text-[11px] text-teal">
              Royalty rights &middot; {collection.extraRoyaltyBps / 100}% on all Soul resales
            </div>
          </div>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Tag color="success">Listed</Tag>
          <span className="text-sm font-semibold text-gold">
            {collection.priceAtomic !== null ? formatAtomicAmountForDisplay(collection.priceAtomic) : '\u2014'}
          </span>
          <button onClick={() => onAction('delist')} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
            Delist
          </button>
          <button onClick={() => onAction('edit-price')} className={buttonStyles({ variant: 'outline', size: 'sm' })}>Edit Price</button>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-b-xl border border-t-0 border-success/25 bg-success/[0.06] px-4 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-success">{'\uD83D\uDDA5'} Active listing</span>
        <span className="text-muted">Soul Collection &middot; royalty rights on {collection.currentSupply} Souls &middot; delist anytime</span>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/*  Grant Row                                                          */
/* ------------------------------------------------------------------ */

function GrantRow({ grant }: { grant: ChainSoulGrantActivity }) {
  return (
    <div className="card rounded-xl p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Tag color={grant.status === 'active' ? 'success' : grant.status === 'revoked' ? 'danger' : grant.status === 'expired' ? 'gold' : 'muted'}>
              {grant.status ?? 'unavailable'}
            </Tag>
            {grant.scopes.map((scope) => (
              <Tag key={`${grant.id}:${scope}`} color="teal">{scope}</Tag>
            ))}
          </div>
          <div className="text-xs text-muted mt-1">
            {formatAddress(grant.issuedByAddress)} {'\u2192'} {formatAddress(grant.granteeAddress)}
          </div>
          <Link href={`/souls/${encodeURIComponent(grant.soulOnChainId)}`} className="mt-1 block text-xs text-action-label">Open Soul {formatAddress(grant.soulOnChainId)}</Link>
          {grant.status === null && <p className="mt-1 text-xs text-muted">Status unknown until the required history scan is complete.</p>}
        </div>
        <div className="text-xs text-muted">
          {grant.endedAtMs !== null
            ? `Ended ${formatChainTimestamp(grant.endedAtMs)}`
            : grant.expiresAtMs !== null
              ? `Expires ${formatChainTimestamp(grant.expiresAtMs)}`
              : 'No expiry'}
        </div>
      </div>
    </div>
  )
}

function PurchaseActivityRow({ purchase }: { purchase: ChainSoulPurchaseActivity }) {
  return (
    <div className="card rounded-xl p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Tag color="success">purchase</Tag>
            <Tag color="gold">{purchase.totalAtomic ? formatAtomicAmountForDisplay(purchase.totalAtomic) : 'Paid'}</Tag>
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {purchase.soulName ?? formatAddress(purchase.soulOnChainId)}
          </div>
          <div className="mt-1 text-xs text-muted">
            TX {formatAddress(purchase.txDigest)}
            {purchase.paidAtomic && <> · List price {formatAtomicAmountForDisplay(purchase.paidAtomic)}</>}
          </div>
        </div>
        <div className="text-xs text-muted">
          {formatChainTimestamp(purchase.createdAtMs)}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const GRANT_STATUS_FILTERS = ['all', 'active', 'expired', 'revoked', 'superseded', 'invalidated', 'unavailable'] as const satisfies readonly ('all' | 'unavailable' | SoulGrantStatus)[]
type GrantStatusFilter = (typeof GRANT_STATUS_FILTERS)[number]

function PortfolioStrip({ data }: { data: NonNullable<ReturnType<typeof useMySouls>['data']> }) {
  // Must track the same active sale set as the Listings tab (listed + floor-violation Souls,
  // plus listed collection caps). Otherwise a seller with only a listed collection cap sees
  // "0 listed / —" while the Listings tab shows an active sale.
  const { listedValueAtomic, listedCount, listedComplete, effectiveGrantCount, ownedComplete, belowFloorCount } = data.totals

  const items = [
    {
      label: 'Listed value',
      value: listedValueAtomic !== null ? formatAtomicAmountForDisplay(listedValueAtomic) : '—',
      color: 'text-value-text',
      hint: `${listedCount}${listedComplete ? '' : '+'} listed${listedComplete ? '' : ' · partial'}`,
    },
    {
      label: 'Royalty (30d)',
      value: '—',
      color: 'text-foreground',
      hint: 'not established by these records',
    },
    {
      label: 'Active grants',
      value: `${effectiveGrantCount}${ownedComplete ? '' : '+'}`,
      color: 'text-action-label',
      hint: `${data.owned.length}${ownedComplete ? '' : '+'} Souls · effective at read`,
    },
    {
      label: 'Below-floor listings',
      value: `${belowFloorCount}${ownedComplete ? '' : '+'}`,
      color: belowFloorCount > 0 ? 'text-danger' : 'text-muted',
      hint: belowFloorCount > 0 ? 'price review needed' : ownedComplete ? 'none observed' : 'scan incomplete',
    },
  ]

  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          data-portfolio-stat={item.label}
          className="rounded-xl border border-border bg-[var(--ui-panel-translucent)] px-3.5 py-3 backdrop-blur-[8px]"
        >
          <div className={'font-display text-[22px] font-extrabold leading-none tracking-[-0.02em] ' + item.color}>
            {item.value}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] uppercase tracking-[0.08em] text-muted">
            <span className="font-semibold">{item.label}</span>
            <span className="normal-case tracking-normal">{item.hint}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function downloadGrantsCsv(grants: readonly ChainSoulGrantActivity[]) {
  if (typeof window === 'undefined') return
  const csv = soulActivityGrantsCsv(grants)
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

function PortfolioScanStatus({ portfolio }: { portfolio: ReturnType<typeof useMySouls> }) {
  const labels: Record<MySoulsSection, string> = { owned: 'Owned Souls', collections: 'Collection rights', activity: 'Activity history' }
  return <section aria-label="Portfolio scan" className="mb-5 space-y-3 rounded-xl border border-border bg-card2 p-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold">Wallet portfolio · verified reads</p>
      <button type="button" className={buttonStyles({ variant: 'outline', size: 'sm' })}
        onClick={() => void portfolio.refresh().catch(() => {})}>Refresh portfolio</button>
    </div>
    <p className="text-muted">Ownership, Collection rights and history are read independently and may change during the scan. Partial counts are marked +.</p>
    {portfolio.error && <p role="alert" className="break-words text-danger">{portfolio.error.message}</p>}
    {portfolio.isLoading && <p role="status">Starting wallet portfolio readers…</p>}
    {portfolio.progress && <div className="grid gap-3 md:grid-cols-3">
      {(Object.keys(labels) as MySoulsSection[]).map(section => {
        const progress: MySoulsProgress = portfolio.progress![section]
        const complete = progress.status === 'COMPLETE', limited = progress.status === 'LIMIT_REACHED'
        return <div key={section} className="space-y-2 rounded-lg border border-border p-3" data-portfolio-source={section}>
          <p className="font-semibold">{labels[section]}</p>
          <p role="status" className="text-muted">{progress.busy ? 'Scanning' : complete ? 'Scan complete' : limited ? 'Read limit reached · incomplete' : progress.error ? 'Scan unavailable · retained results' : 'Paused · incomplete'} · {progress.pages} pages</p>
          {progress.stage && <p className="break-words text-muted">{progress.stage}</p>}
          {progress.checkpoint && <p className="text-muted">Index checkpoint {progress.checkpoint}</p>}
          {progress.error && <p role="alert" className="break-words text-danger">{progress.error}</p>}
          {limited && <p className="text-muted">The bounded reader stopped before full coverage. These results are not a complete portfolio.</p>}
          {progress.busy ? <button type="button" className={buttonStyles({ variant: 'outline', size: 'sm' })}
            onClick={() => portfolio.pause(section)}>Pause {labels[section]}</button>
            : !complete && !limited && <button type="button" className={buttonStyles({ variant: 'outline', size: 'sm' })}
              onClick={() => void portfolio.resume(section).catch(() => {})}>{progress.error ? 'Retry' : 'Continue'} {labels[section]}</button>}
        </div>
      })}
    </div>}
  </section>
}

export default function MySoulsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('owned')
  const [grantSelection, setGrantSelection] = useState<{ identity: string; soulId: string } | null>(null)
  const [collectionSelection, setCollectionSelection] = useState<{ identity: string; collectionId: string; type: CollectionAction } | null>(null)
  const [activeGrantsOnly, setActiveGrantsOnly] = useState(false)
  const [grantStatusFilter, setGrantStatusFilter] = useState<GrantStatusFilter>('all')
  const login = useLogin()
  const portfolio = useMySouls(), { data: myData, isLoading } = portfolio
  const identity = useRef(portfolio.identityKey)
  useLayoutEffect(() => { identity.current = portfolio.identityKey }, [portfolio.identityKey])
  const batchScope = `${portfolio.owner ?? ''}:${portfolio.identityKey}`
  const batchIdentity = useRef(batchScope)
  useLayoutEffect(() => { batchIdentity.current = batchScope }, [batchScope])
  const [batchState,setBatchState] = useState<{scope:string;rows:NativeBatchSelection[]}>({scope:batchScope,rows:[]})
  // Clear on every identity transition, including A → B → A, never on filtering
  // or progressive portfolio pages. A fresh wallet cannot inherit a draft.
  if(batchState.scope!==batchScope)setBatchState({scope:batchScope,rows:[]})
  const batchRows=batchState.scope===batchScope?batchState.rows:[]
  const changeBatch=(rows:NativeBatchSelection[])=>setBatchState(previous=>previous.scope===batchScope?{scope:batchScope,rows}:previous)
  const [equipmentVisible,setEquipmentVisible]=useState<{scope:string;ids:string[]}>({scope:batchScope,ids:[]})
  const changeEquipmentVisible=useCallback((ids:string[])=>{if(batchIdentity.current===batchScope)setEquipmentVisible(previous=>
    previous.scope===batchScope&&previous.ids.join(',')===ids.join(',')?previous:{scope:batchScope,ids})},[batchScope])
  const visibleBatchIds=activeTab==='owned'?[...(myData?.owned??[]).filter(s=>!activeGrantsOnly||BigInt(s.effectiveGrantCount)>0n).map(s=>s.onChainId),
    ...(equipmentVisible.scope===batchScope?equipmentVisible.ids:[])]:[]
  const batchPanel=<NativeBatchListingPanel key="native-batch-listing" owner={portfolio.owner} identityKey={portfolio.identityKey}
    selection={batchRows} visibleIds={visibleBatchIds} onChange={changeBatch}/>
  const bookmarks = usePrivateBookmarks()
  const bookmarkRows = useBookmarkRows(activeTab === 'bookmarks')

  if (!portfolio.connected) {
    return (
      <PageContainer>
        {batchPanel}
        <EmptyState
          icon={'\uD83E\uDEAA'}
          label="Sign in to load your Soulidity portfolio"
          sublabel="Connect your wallet to read held Souls, Collection rights and verified activity from the chain."
          actionLabel="Sign In"
          onAction={login}
        />
      </PageContainer>
    )
  }

  const listings = myData?.owned.filter((s) => s.listingStatus === 'listed' || s.listingStatus === 'floor-violation') ?? []
  const listedCollections = myData?.collections.filter((c) => c.isViewerListing) ?? []
  const grantModalSoul = grantSelection?.identity === portfolio.identityKey
    ? myData?.owned.find(soul => soul.onChainId === grantSelection.soulId) ?? null : null
  const selectedCollection = collectionSelection?.identity === portfolio.identityKey
    ? myData?.collections.find(collection => collection.collectionId === collectionSelection.collectionId && collection.currentHolderAddress === portfolio.owner) ?? null : null
  const collectionSubject = selectedCollection ? { onChainId: selectedCollection.collectionId, name: selectedCollection.name,
    listedPriceAtomic: selectedCollection.priceAtomic, listingObjectOnChainId: selectedCollection.listingId } : null
  const selectGrant = (soul: PortfolioSoul) => setGrantSelection({ identity: portfolio.identityKey, soulId: soul.onChainId })
  const closeCollection = () => {
    if (identity.current !== portfolio.identityKey) return
    setCollectionSelection(null); void portfolio.refresh().catch(() => {})
  }
  const bookmarksCount = bookmarks.entries?.length ?? null

  const tabsWithCounts = tabs.map((tab) => {
    const count = tab.id === 'owned'
      ? myData?.coverage.owned === 'UNSCANNED' ? null : myData?.owned.length ?? null
      : tab.id === 'collections'
        ? myData?.coverage.collections === 'UNSCANNED' ? null : myData?.collections.length ?? null
        : tab.id === 'listings'
          ? myData?.totals.listedCount ?? null
          : tab.id === 'bookmarks'
            ? bookmarksCount
            : null
    const partial = tab.id === 'owned' ? myData?.coverage.owned !== 'COMPLETE'
      : tab.id === 'collections' ? myData?.coverage.collections !== 'COMPLETE'
        : tab.id === 'listings' ? !myData?.totals.listedComplete : false
    return { id: tab.id, label: count != null ? `${tab.label} (${count}${partial ? '+' : ''})` : tab.label }
  })

  return (
    <PageContainer>
      {batchPanel}
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

      {activeTab !== 'bookmarks' && <PortfolioScanStatus portfolio={portfolio} />}

      <div className="mb-6">
        <FilterTabs
          className="ph-no-capture"
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

      {activeTab==='owned'&&portfolio.owner&&<OwnedEquipmentSelection key={batchScope} owner={portfolio.owner} identityKey={portfolio.identityKey}
        selection={batchRows} onChange={changeBatch} onVisibleIds={changeEquipmentVisible}/>}

      {myData && activeTab === 'owned' && (() => {
        if (myData.owned.length === 0) {
          return myData.coverage.owned === 'COMPLETE'
            ? <EmptyState icon={'\uD83E\uDEE5'} label="No owned Souls yet" sublabel="Purchased or freshly minted Souls will appear here." />
            : <p className="text-sm text-muted">No verified owned Souls to display yet. The owned scan is incomplete.</p>
        }
        const filteredOwned = activeGrantsOnly
          ? myData.owned.filter((s) => BigInt(s.effectiveGrantCount) > 0n)
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
                    ? 'border-purple bg-purple/12 text-action-label'
                    : 'border-border bg-transparent text-muted hover:border-purple hover:text-action-label')
                }
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                Active grants only
                {activeGrantsOnly && (
                  <span className="ml-1 rounded-full bg-purple/20 px-1.5 py-0.5 text-[10px] font-bold">
                    {myData.owned.filter((s) => BigInt(s.effectiveGrantCount) > 0n).length}
                  </span>
                )}
              </button>
            </div>
            {filteredOwned.length > 0 ? (
              <div className="flex flex-col gap-3">
                {filteredOwned.map((soul) => <SoulCard key={soul.onChainId} soul={soul} onGrantClick={() => selectGrant(soul)}
                  batch={soul.provenanceKind==='animacraft'&&soul.chainListingStatus==='HELD'&&soul.listingStatus==='unlisted'
                    &&soul.currentOwnerAddress===portfolio.owner?{
                      selected:batchRows.some(row=>batchSelectionId(row)===soul.onChainId),
                      disabled:batchRows.length>=MAX_MARKET_BATCH_LIST_ROWS&&!batchRows.some(row=>batchSelectionId(row)===soul.onChainId),
                      toggle:()=>changeBatch(batchRows.some(row=>batchSelectionId(row)===soul.onChainId)
                        ?batchRows.filter(row=>batchSelectionId(row)!==soul.onChainId)
                        :batchRows.length<MAX_MARKET_BATCH_LIST_ROWS?[...batchRows,{soulId:soul.onChainId,stateId:soul.stateOnChainId,name:soul.name,price:''}]:batchRows),
                    }:undefined}/>)}
              </div>
            ) : (
              <EmptyState
                icon={'\uD83D\uDD10'}
                label="No Souls match the active grants filter"
                sublabel={myData.coverage.owned === 'COMPLETE' ? 'None of your observed owned Souls have effective grants at read time.' : 'No matches in the verified pages so far. The owned scan is incomplete.'}
                actionLabel="Show all Souls"
                onAction={() => setActiveGrantsOnly(false)}
              />
            )}
          </>
        )
      })()}

      {myData && activeTab === 'collections' && (
        myData.collections.length > 0 ? (
          <CollectionSection collections={myData.collections} viewerAddress={portfolio.owner!} identityKey={portfolio.identityKey} />
        ) : (
          myData.coverage.collections === 'COMPLETE'
            ? <EmptyState icon={'\uD83D\uDCE6'} label="No collection rights yet" sublabel="Created, held and previously sold Collection rights will show here." />
            : <p className="text-sm text-muted">No verified Collection rights to display yet. The Collection scan is incomplete.</p>
        )
      )}

      {myData && activeTab === 'listings' && (
        listings.length > 0 || listedCollections.length > 0 ? (
          <div className="space-y-6">
            {listings.length > 0 && (
              <>
                <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em]">
                  Souls listed for sale
                </p>
                <div className="flex flex-col gap-3">
                  {listings.map((soul) => <SoulCard key={soul.onChainId} soul={soul} onGrantClick={() => selectGrant(soul)} />)}
                </div>
              </>
            )}
            {listedCollections.length > 0 && (
              <>
                <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em]">
                  Soul Collections listed for sale
                </p>
                <div className="flex flex-col gap-3">
                  {listedCollections.map((c) => <ListedCollectionCard key={c.collectionId} collection={c}
                    onAction={type => setCollectionSelection({ identity: portfolio.identityKey, collectionId: c.collectionId, type })} />)}
                </div>
              </>
            )}
          </div>
        ) : (
          myData.totals.listedComplete
            ? <EmptyState icon={'\uD83C\uDFF7\uFE0F'} label="No active listings" sublabel="List a Soul or Collection right for sale and it will appear here." />
            : <p className="text-sm text-muted">No verified listings to display yet. Ownership or Collection listing coverage is incomplete.</p>
        )
      )}

      {myData && activeTab === 'activity' && (() => {
        const purchases = myData.purchases ?? []
        if (purchases.length === 0 && myData.grants.length === 0) {
          return myData.coverage.activity === 'COMPLETE'
            ? <EmptyState icon={'\uD83D\uDD10'} label="No activity yet" sublabel="Grant records and purchases will appear here." />
            : <p className="text-sm text-muted">No verified activity to display yet. The history scan is incomplete.</p>
        }
        const filteredGrants = grantStatusFilter === 'all'
          ? myData.grants
          : myData.grants.filter((g) => (g.status ?? 'unavailable') === grantStatusFilter)
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {GRANT_STATUS_FILTERS.map((status) => {
                  const count = status === 'all'
                    ? myData.grants.length
                    : myData.grants.filter((g) => (g.status ?? 'unavailable') === status).length
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setGrantStatusFilter(status)}
                      className={
                        'rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition-colors ' +
                        (grantStatusFilter === status
                          ? 'border-purple bg-purple/12 text-action-label'
                          : 'border-border bg-transparent text-muted hover:border-purple hover:text-action-label')
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:border-purple hover:text-action-label"
                title="Download CSV of filtered grants"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                Export CSV
              </button>
            </div>
            {purchases.length > 0 && (
              <div className="flex flex-col gap-3">
                {purchases.map((purchase) => <PurchaseActivityRow key={purchase.id} purchase={purchase} />)}
              </div>
            )}
            {filteredGrants.length > 0 ? (
              <div className="flex flex-col gap-3">
                {filteredGrants.map((grant) => <GrantRow key={grant.id} grant={grant} />)}
              </div>
            ) : myData.grants.length > 0 ? (
              <EmptyState
                icon={'\uD83D\uDD10'}
                label={`No ${grantStatusFilter} grants`}
                sublabel="Try a different status filter to see more grant records."
                actionLabel="Show all grants"
                onAction={() => setGrantStatusFilter('all')}
              />
            ) : (
              <p className="text-xs text-muted">Grant records will appear here after an authorization is issued.</p>
            )}
          </div>
        )
      })()}

      {activeTab === 'bookmarks' && (
        <div className="ph-no-capture space-y-4">
          <PrivateBookmarkControls />
          {bookmarks.entries !== null && <>
            {bookmarks.entries.length === 0 ? <EmptyState icon={'\uD83D\uDD16'} label="No bookmarks yet"
              sublabel="Bookmark Souls from the marketplace to save them here." /> : <>
              <p className="text-[11px] font-bold text-muted uppercase tracking-[0.08em]">Bookmarked Souls ({bookmarks.entries.length})</p>
              {bookmarkRows.loading && <p role="status" className="text-sm text-muted">Loading public Soul information…</p>}
              {bookmarkRows.error && <div role="alert" className="space-y-2 text-sm text-warning-text">
                <p>{bookmarkRows.error} Your private bookmark entries are retained.</p>
                <button type="button" onClick={() => void bookmarkRows.refresh()} disabled={bookmarkRows.loading}
                  className={buttonStyles({ variant: 'outline', size: 'sm' })}>Retry bookmark page</button>
              </div>}
              {bookmarkRows.page?.partial && <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>Some Soul details are unavailable. You can still open or remove these bookmarks.</span>
                <button type="button" onClick={() => void bookmarkRows.retryFailed()} disabled={bookmarkRows.loading}
                  className={buttonStyles({ variant: 'outline', size: 'sm' })}>Retry unavailable Souls</button>
              </div>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {bookmarkRows.page?.rows.map(row => <div key={row.soulId}
                  className="overflow-hidden rounded-xl border border-border bg-card hover:border-purple transition">
                  {row.status === 'AVAILABLE' ? <Link href={`/souls/${encodeURIComponent(row.soulId)}`} className="block">
                    <SoulCoverImage soul={row.detail} imageUrl={row.detail.imageUrl} className="aspect-[4/5]" fallback={<span className="text-3xl">🤖</span>} />
                    <div className="p-3 space-y-1.5">
                      <div className="text-sm font-bold text-foreground truncate">{row.detail.name}</div>
                      <div className="text-xs text-muted line-clamp-2 leading-relaxed">{row.detail.description}</div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] uppercase text-muted tracking-wide">{row.detail.tags[0] ?? 'Soul'}</span>
                        <span className="text-xs font-bold text-gold">{row.detail.listedPriceAtomic
                          ? formatAtomicAmountForDisplay(row.detail.listedPriceAtomic) : 'Not listed'}</span>
                      </div>
                    </div>
                  </Link> : <div className="space-y-2 p-3 text-sm">
                    <p className="font-semibold">Soul information unavailable</p>
                    <p className="break-all font-mono text-xs text-muted">{row.soulId}</p>
                    <p className="text-xs text-muted">{row.error}</p>
                    <Link href={`/souls/${encodeURIComponent(row.soulId)}`} className="text-value-text underline">Open Soul</Link>
                  </div>}
                  <div className="border-t border-border p-3">
                    <button type="button" aria-label={`Remove bookmark ${row.soulId}`}
                      disabled={bookmarks.busy || bookmarks.loading || bookmarks.pending || !bookmarks.writesEnabled}
                      onClick={() => void bookmarks.setBookmark(row.soulId, false).catch(() => {})}
                      className={buttonStyles({ variant: 'outline', size: 'sm' })}>Remove bookmark</button>
                  </div>
                </div>)}
              </div>
              {bookmarkRows.page && <nav aria-label="Bookmark pages" className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" disabled={bookmarkRows.loading || !bookmarkRows.page.hasPrevious}
                  onClick={() => void bookmarkRows.previous()} className={buttonStyles({ variant: 'outline', size: 'sm' })}>Previous bookmarks</button>
                <span>Page {bookmarkRows.page.page + 1} of {bookmarkRows.page.pageCount}</span>
                <button type="button" disabled={bookmarkRows.loading || !bookmarkRows.page.hasNext}
                  onClick={() => void bookmarkRows.next()} className={buttonStyles({ variant: 'outline', size: 'sm' })}>Next bookmarks</button>
              </nav>}
            </>}
          </>}
        </div>
      )}

      {grantModalSoul && (
        <GrantModal
          key={`${portfolio.identityKey}:${grantModalSoul.onChainId}`}
          soul={grantModalSoul}
          open
          onClose={() => { if (identity.current === portfolio.identityKey) setGrantSelection(null) }}
        />
      )}
      {collectionSubject && collectionSelection?.type === 'list' && <ListCollectionModal key={`${portfolio.identityKey}:${collectionSubject.onChainId}`} collection={collectionSubject} open onClose={closeCollection} />}
      {collectionSubject && collectionSelection?.type === 'edit-price' && <EditCollectionPriceModal key={`${portfolio.identityKey}:${collectionSubject.onChainId}`} collection={collectionSubject} open onClose={closeCollection} />}
      {collectionSubject && collectionSelection?.type === 'delist' && <DelistCollectionModal key={`${portfolio.identityKey}:${collectionSubject.onChainId}`} collection={collectionSubject} open onClose={closeCollection} />}
    </PageContainer>
  )
}
