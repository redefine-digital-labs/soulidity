'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AccessDownloadButton } from '@web/components/souls/access-download-button'
import { PurchaseButton } from '@web/components/souls/purchase-button'
import { ReadmePanel } from '@web/components/souls/readme-panel'
import { PriceBreakdown } from '@web/components/souls/price-breakdown'
import { StickyPurchaseBar } from '@web/components/souls/sticky-purchase-bar'
import { useAuth } from '@web/components/auth-provider'
import { useSoulDetail } from '@web/lib/souls/queries'
import { toSafeBackgroundImage } from '@web/lib/souls/soul-detail-utils'
import { buildListHeldSoulTx, buildCancelListingTx } from '@web/lib/souls/tx-builder'
import { parseSoulPaymentAmountToAtomic } from '@web/lib/souls/pricing-input'
import { mirrorRouteRequest, formatMirrorSyncError } from '@web/lib/souls/mirror-sync'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { formatAtomicSoulPaymentForDisplay } from '@web/lib/souls/price-format'

function requireCurrentKioskCapOnChainId(currentKioskCapOnChainId: string | null) {
  if (!currentKioskCapOnChainId) {
    throw new Error('Soul kiosk permissions are still syncing')
  }
  return currentKioskCapOnChainId
}

export default function SoulDetailPage() {
  const params = useParams()
  const soulId = params.id as string
  const { user, getAuthHeaders } = useAuth()
  const { signAndExecute } = usePrivySuiSign()
  const { data: soul, isLoading, error, refetch } = useSoulDetail(soulId, getAuthHeaders, user?.id)

  const [listPrice, setListPrice] = useState('')
  const [listSubmitting, setListSubmitting] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const [ownerSectionOpen, setOwnerSectionOpen] = useState(false)
  const [purchaseSuccess, setPurchaseSuccess] = useState(false)

  useEffect(() => {
    if (soul?.isOwner && soul.listingStatus === 'held') {
      setOwnerSectionOpen(true)
    }
  }, [soul?.isOwner, soul?.listingStatus])

  const previewImage = useMemo(() => soul?.previewImages[0] ?? soul?.imageUrl ?? null, [soul])
  const previewBackgroundImage = useMemo(() => toSafeBackgroundImage(previewImage), [previewImage])

  async function handleListForSale() {
    if (listSubmitting) return
    if (!soul || !user?.primarySuiAddress) return
    const priceAtomic = parseSoulPaymentAmountToAtomic(listPrice)
    if (!priceAtomic) {
      setListError('Enter a valid USDC price')
      return
    }
    setListSubmitting(true)
    setListError(null)
    try {
      const tx = buildListHeldSoulTx({
        currentKioskId: soul.currentKioskId,
        currentKioskCapOnChainId: requireCurrentKioskCapOnChainId(soul.currentKioskCapOnChainId),
        soulObjectId: soul.onChainId,
        priceAtomic,
      })
      const result = await signAndExecute(tx)
      const headers = await getAuthHeaders()
      await mirrorRouteRequest({
        input: '/api/souls/publish',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            txDigest: result.digest,
            soulOnChainId: soul.onChainId,
          }),
        },
      })
      setListPrice('')
      await refetch()
    } catch (listSyncError) {
      setListError(formatMirrorSyncError(listSyncError))
    } finally {
      setListSubmitting(false)
    }
  }

  async function handleCancelListing() {
    if (cancelSubmitting) return
    if (!soul || !soul.listingObjectOnChainId) return
    setCancelSubmitting(true)
    setCancelError(null)
    try {
      const tx = buildCancelListingTx({
        currentKioskId: soul.currentKioskId,
        currentKioskCapOnChainId: requireCurrentKioskCapOnChainId(soul.currentKioskCapOnChainId),
        listingObjectId: soul.listingObjectOnChainId,
      })
      const result = await signAndExecute(tx)
      const headers = await getAuthHeaders()
      await mirrorRouteRequest({
        input: `/api/souls/${encodeURIComponent(soul.onChainId)}/delist`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ txDigest: result.digest }),
        },
      })
      await refetch()
    } catch (cancelSyncError) {
      setCancelError(formatMirrorSyncError(cancelSyncError))
    } finally {
      setCancelSubmitting(false)
    }
  }

  async function handlePurchaseSuccess() {
    setPurchaseSuccess(true)
    setTimeout(() => {
      setPurchaseSuccess(false)
      void refetch()
    }, 1500)
  }

  const showStickyBar =
    !!soul
    && soul.listingStatus === 'listed'
    && !soul.isOwner
    && !!soul.listingObjectOnChainId
    && !!soul.listedPriceAtomic

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Back navigation */}
        <Link
          href="/souls"
          className="inline-flex items-center gap-1.5 text-sm mb-6"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Souls
        </Link>

        {isLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : error || !soul ? (
          <div style={{ color: 'var(--accent-rose)' }}>Failed to load Soul.</div>
        ) : (
          <>
            {/* Desktop: 2-column grid. Mobile: single column */}
            <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
              {/* LEFT COLUMN */}
              <div className="flex flex-col gap-6">
                {/* Preview image */}
                <div className="relative">
                  {previewBackgroundImage ? (
                    <img
                      src={previewImage ?? ''}
                      alt={soul.name}
                      className="w-full object-cover"
                      style={{ aspectRatio: '4/3', borderRadius: 'var(--radius)' }}
                    />
                  ) : (
                    <div
                      className="glass-panel w-full flex items-center justify-center"
                      style={{ aspectRatio: '4/3', minHeight: '200px' }}
                    >
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No preview</span>
                    </div>
                  )}
                  {/* Status badge overlay */}
                  <span
                    className={`status-badge ${soul.listingStatus === 'listed' ? 'status-badge-listed' : 'status-badge-held'}`}
                  >
                    {soul.listingStatus === 'listed' ? 'Listed' : 'Held'}
                  </span>
                </div>

                {/* README panel — desktop only in left column */}
                {soul.readme ? (
                  <div className="hidden lg:block">
                    <ReadmePanel readme={soul.readme} />
                  </div>
                ) : null}
              </div>

              {/* RIGHT COLUMN — sticky on desktop */}
              <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
                {/* Identity block */}
                <div className="flex flex-col gap-3">
                  <p
                    className="text-[11px] uppercase tracking-[0.16em] font-medium"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {soul.category}
                  </p>
                  <h1
                    className="font-bold leading-tight"
                    style={{ fontSize: '28px', fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
                  >
                    {soul.name}
                  </h1>
                  {soul.description ? (
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {soul.description}
                    </p>
                  ) : null}
                  {soul.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {soul.tags.map((tag) => (
                        <span key={tag} className="badge badge-muted">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <hr className="divider" />

                {/* Access / Price block */}
                {(soul.isOwner || soul.isAllowlisted) ? (
                  <div className="flex flex-col gap-3">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Access content
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Download and decrypt the sealed Soul bundle in your browser.
                    </p>
                    <AccessDownloadButton soulObjectId={soul.onChainId} />
                  </div>
                ) : soul.listingStatus === 'listed'
                  && !soul.isOwner
                  && soul.listingObjectOnChainId
                  && soul.listedPriceAtomic
                  && soul.purchasePlatformFeeAtomic
                  && soul.purchaseCreatorRoyaltyAtomic ? (
                  <div className="relative flex flex-col gap-4">
                    <PriceBreakdown
                      listedPriceAtomic={soul.listedPriceAtomic}
                      purchasePlatformFeeAtomic={soul.purchasePlatformFeeAtomic}
                      purchaseCreatorRoyaltyAtomic={soul.purchaseCreatorRoyaltyAtomic}
                      purchaseTotalAtomic={soul.purchaseTotalAtomic ?? null}
                    />
                    <PurchaseButton
                      soulObjectId={soul.onChainId}
                      listingObjectId={soul.listingObjectOnChainId}
                      sellerKioskId={soul.currentKioskId}
                      listedPriceAtomic={soul.listedPriceAtomic}
                      purchasePlatformFeeAtomic={soul.purchasePlatformFeeAtomic}
                      purchaseCreatorRoyaltyAtomic={soul.purchaseCreatorRoyaltyAtomic}
                      purchaseTotalAtomic={soul.purchaseTotalAtomic}
                      quotedPriceAtomic={soul.quotedPriceAtomic}
                      onPurchased={handlePurchaseSuccess}
                    />
                    {/* Purchase success overlay */}
                    {purchaseSuccess ? (
                      <div
                        className="absolute inset-0 flex items-center justify-center rounded-[var(--radius)] animate-scale-in"
                        style={{ background: 'rgba(5, 150, 105, 0.12)', border: '1px solid rgba(5, 150, 105, 0.25)' }}
                      >
                        <p
                          className="text-sm font-semibold"
                          style={{ color: 'var(--accent-emerald)' }}
                        >
                          Soul is yours
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : !soul.isOwner ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Not for sale</p>
                ) : null}

                <hr className="divider" />

                {/* Sealed content panel */}
                <div className="sealed-panel flex flex-col gap-2">
                  <div className="sealed-panel-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Sealed Content
                  </div>
                  <div className="sealed-panel-row">
                    <span className="sealed-panel-key">Bundle</span>
                    <span className="sealed-panel-val">Encrypted</span>
                  </div>
                  <div className="sealed-panel-row">
                    <span className="sealed-panel-key">Storage</span>
                    <span className="sealed-panel-val">Walrus</span>
                  </div>
                  <div className="sealed-panel-row">
                    <span className="sealed-panel-key">Access</span>
                    <span className="sealed-panel-val">
                      {soul.isOwner ? 'Owner' : soul.isAllowlisted ? 'Allowlisted' : 'Owner or Allowlisted'}
                    </span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {soul.isOwner || soul.isAllowlisted
                      ? 'You have access. Content downloads directly to your browser.'
                      : 'Purchase unlocks Seal decryption. Content downloads directly to your browser.'}
                  </p>
                </div>

                {/* Owner management — listed state */}
                {soul.isOwner && soul.listingStatus === 'listed' ? (
                  <>
                    <hr className="divider" />
                    <div className="flex flex-col gap-3">
                      <div>
                        <h2
                          className="text-base font-semibold"
                          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                        >
                          Listing active
                        </h2>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          Cancel the listing to manage allowlist access or change the price.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCancelListing}
                        aria-label="Cancel Soul listing"
                        disabled={cancelSubmitting}
                        className="btn btn-danger w-full"
                      >
                        {cancelSubmitting ? 'Cancelling…' : 'Cancel listing'}
                      </button>
                      {cancelError ? (
                        <p className="text-xs" style={{ color: 'var(--accent-rose)' }}>{cancelError}</p>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {/* Owner management — held state (collapsible) */}
                {soul.isOwner && soul.listingStatus === 'held' ? (
                  <>
                    <hr className="divider" />
                    <div className="glass-panel overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOwnerSectionOpen((prev) => !prev)}
                        className="w-full flex items-center justify-between p-4 text-left"
                        style={{ color: 'var(--text-primary)' }}
                        aria-expanded={ownerSectionOpen}
                      >
                        <div>
                          <h2
                            className="text-base font-semibold"
                            style={{ fontFamily: 'var(--font-display)' }}
                          >
                            Owner management
                          </h2>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            List for sale
                          </p>
                        </div>
                        <svg
                          className="shrink-0 transition-transform duration-200"
                          style={{
                            transform: ownerSectionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                            color: 'var(--text-muted)',
                          }}
                          width="20" height="20" viewBox="0 0 20 20" fill="none"
                          aria-hidden="true"
                        >
                          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>

                      {ownerSectionOpen ? (
                        <div className="px-4 pb-4 flex flex-col gap-6">
                          {/* List for sale */}
                          <div className="flex flex-col gap-3">
                            <div>
                              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                List for sale
                              </h3>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                Set a USDC price and list this Soul NFT for sale.
                              </p>
                            </div>
                            <input
                              value={listPrice}
                              onChange={(event) => setListPrice(event.target.value)}
                              aria-label="Price in USDC for listing"
                              placeholder="Price in USDC (e.g. 1.5)"
                              inputMode="decimal"
                              className="input-dark"
                            />
                            <button
                              type="button"
                              onClick={handleListForSale}
                              aria-label="List this Soul for sale"
                              disabled={listSubmitting || listPrice.trim().length === 0}
                              className="btn btn-primary w-full"
                            >
                              {listSubmitting ? 'Listing…' : 'List for sale'}
                            </button>
                            {listError ? (
                              <p className="text-xs" style={{ color: 'var(--accent-rose)' }}>{listError}</p>
                            ) : null}
                          </div>

                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </aside>
            </div>

            {/* README panel — mobile (below right column) */}
            {soul.readme ? (
              <div className="lg:hidden mt-6">
                <ReadmePanel readme={soul.readme} />
              </div>
            ) : null}
          </>
        )}
      </main>

      {/* Sticky purchase bar — mobile only */}
      {showStickyBar && soul?.listedPriceAtomic ? (
        <StickyPurchaseBar
          price={formatAtomicSoulPaymentForDisplay(soul.listedPriceAtomic)}
          onPurchase={() => {
            // Trigger is handled by PurchaseButton in the right column.
            // The sticky bar is informational on mobile; the real action button
            // is in the scrollable content above.
          }}
          purchasing={false}
          disabled={true}
        />
      ) : null}

    </div>
  )
}
