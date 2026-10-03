'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { SoulCoverImage } from '@/components/souls/soul-cover-image'
import { useNativeMarketListActions } from '@/lib/hooks/use-native-market-list-actions'
import { NativeListingRecovery } from '@/components/souls/native-listing-recovery'
import { NativeListingQuote } from '@/components/souls/native-listing-quote'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import {
  formatAtomicAmountForDisplay,
  parseDisplayAmountToAtomic,
} from '@soulidity/sdk'

export default function SellPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, getAuthHeaders } = useAuth()
  const { data: soul, isLoading, error } = useSoulDetail(id)
  const isNative = soul?.provenanceKind === 'animacraft'
  const nativeActions = useNativeMarketListActions(isNative && soul
    ? {soulId:soul.onChainId,stateId:soul.stateOnChainId,listingId:soul.listingObjectOnChainId??null} : null)
  const native = isNative ? nativeActions : null
  const equipmentSale = native?.snapshot?.equipmentSale
  const nativeCanList = native?.canList && !!native.snapshot
    && (native.snapshot.equipmentId === null || !!equipmentSale)
  const [price, setPrice] = useState('')

  let priceAtomic: bigint | null = null
  let priceError: string | null = null
  if (price.trim()) {
    try {
      priceAtomic = parseDisplayAmountToAtomic(price)
      if (priceAtomic > 18446744073709551615n) throw new Error('Listing price exceeds the supported maximum')
    } catch (parseError) {
      priceError = parseError instanceof Error ? parseError.message : 'Invalid amount'
    }
  }

  // Floor price enforcement: soul in a collection must list at or above the floor
  const collectionFloor = !native && soul?.collection?.floorPriceAtomic ? BigInt(soul.collection.floorPriceAtomic) : null
  const invalidPrice = priceAtomic != null && priceAtomic <= 0n
  const belowFloor = priceAtomic != null && collectionFloor != null && priceAtomic < collectionFloor

  if (isLoading) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-8">
        <div className="h-[420px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (error || !soul) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🫥"
          label="Soul not found"
          sublabel="The Soulidity projection could not load this asset."
          actionLabel="Back to Market"
          onAction={() => {
            window.location.href = '/market'
          }}
        />
      </div>
    )
  }

  if (!native && !soul.isOwner) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🔒"
          label="Owner action required"
          sublabel="Only the current owner can list this Soul in a kiosk."
          actionLabel="Back to Soul"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}`
          }}
        />
      </div>
    )
  }

  if (!native && (soul.listingStatus === 'listed' || soul.listingStatus === 'floor-violation') && soul.listedPriceAtomic) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🏷️"
          label={soul.listingStatus === 'floor-violation' ? 'Listed below collection floor' : 'Soul already listed'}
          sublabel={
            soul.listingStatus === 'floor-violation'
              ? `Current listing: ${formatAtomicAmountForDisplay(soul.listedPriceAtomic)}. This is below the collection floor price and is hidden from the marketplace. Delist or update the price from the Soul detail page.`
              : `Current listing: ${formatAtomicAmountForDisplay(soul.listedPriceAtomic)}.`
          }
          actionLabel="Open Soul"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}`
          }}
        />
      </div>
    )
  }

  const platformFeeBps = soul.platformFeeBps
  const platformFeePct = platformFeeBps != null ? platformFeeBps / 100 : null
  const creatorRoyaltyPct = soul.creatorRoyaltyBps / 100
  const collectionRoyaltyPct = soul.collection ? soul.collection.extraRoyaltyBps / 100 : 0
  const creatorRoyaltyReturnsToSeller = soul.isCreator && creatorRoyaltyPct > 0
  // Mirrors `market::buy_soul_impl`: collection royalty is paid only when the
  // collection holder differs from the seller. If the seller IS the current
  // collection holder, the royalty stays with them.
  const collectionRoyaltyReturnsToSeller =
    collectionRoyaltyPct > 0
    && soul.collection != null
    && soul.collection.currentHolderAddress.toLowerCase() === soul.currentOwnerAddress.toLowerCase()
  const youReceivePct = platformFeePct != null
    ? (
        100
        - platformFeePct
        - (creatorRoyaltyReturnsToSeller ? 0 : creatorRoyaltyPct)
        - (collectionRoyaltyReturnsToSeller ? 0 : collectionRoyaltyPct)
      ).toFixed(1)
    : null

  const authorizeHref = priceAtomic != null && priceAtomic > 0n && !belowFloor && !priceError && (!native || nativeCanList)
    ? `/souls/${encodeURIComponent(soul.onChainId)}/sell/authorize?price=${encodeURIComponent(price)}`
    : null

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      {/* Stepper bar */}
      <div className="bg-card2 border border-border px-4 sm:px-6 py-2.5 flex items-center gap-3 rounded-t-xl mb-0">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple text-white">1</div>
          <span className="text-foreground font-semibold">Set Price</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-border text-muted">2</div>
          <span className="text-muted">Authorize</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-border text-muted">3</div>
          <span className="text-muted">Listed</span>
        </div>
      </div>

      {/* Main content */}
      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6 space-y-5">
        {/* Title */}
        <div>
          <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1">Sell Soul</p>
          <h2 className="font-display text-xl font-bold">Step 1 — Set Your Price</h2>
        </div>

        {/* Soul preview card */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card2 p-4">
          <SoulCoverImage
            compact
            soul={soul}
            imageUrl={soul.imageUrl}
            className="w-12 h-12 rounded-lg border border-border bg-card shrink-0"
            fallback={<span className="text-lg font-semibold">{soul.name.slice(0, 1).toUpperCase()}</span>}
          />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm">{soul.name}</p>
            <p className="text-xs text-muted capitalize">{soul.tags[0] ?? 'Soul'}</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-success/10 text-success border border-success/30">
            Set price
          </span>
        </div>

        {native && <section aria-label="Selected sale scope" className="rounded-xl border border-border bg-card2 p-4 space-y-2 text-xs">
          <p className="font-semibold">For sale: 1 Animacraft Soul only</p>
          <p className="break-all">Soul ID: {soul.onChainId}</p>
          <p>Equipment is not for sale. Selecting this Soul does not select any equipment for sale.</p>
          {native.snapshot?.equipmentId && (equipmentSale ? <>
            <p>{equipmentSale.removals.length} equipped selections will be removed and the empty equipment binding closed atomically with listing. Owned equipment stays in the seller’s wallet.</p>
            <p>Review the exact removal list on the next step. Cancelling a successful listing does not re-equip anything.</p>
          </> : <p>Complete verified equipment removal plan unavailable. Refresh before listing; no partial removal or listing will be submitted.</p>)}
        </section>}

        {/* Listing price input */}
        <div className="space-y-2">
          <label className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
            Listing Price (USDC) <span className="text-danger">*</span>
          </label>
          <Input
            type="number"
            min="0.000001"
            step="0.000001"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="0.00"
          />
          {priceError && <p className="text-danger text-xs">{priceError}</p>}
          {invalidPrice && <p className="text-danger text-xs">Listing price must be greater than 0</p>}
          {belowFloor && collectionFloor && (
            <p className="text-danger text-xs">
              Minimum price for this collection is {formatAtomicAmountForDisplay(collectionFloor.toString())}
            </p>
          )}
        </div>

        {/* Fee breakdown */}
        {native ? <NativeListingQuote snapshot={native.snapshot} priceAtomic={priceAtomic}/> : <div className="rounded-xl border border-border bg-card2 overflow-hidden">
          {soul.listedPriceAtomic && (
            <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
              <span className="text-muted">Current listing price</span>
              <span className="font-semibold">{formatAtomicAmountForDisplay(soul.listedPriceAtomic)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Platform fee</span>
            <span>{platformFeePct != null ? `${platformFeePct}%` : '—'}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">
              {'Creator royalty'}{' '}
              <span className="text-[10px] text-teal ml-1">on-chain enforced</span>
            </span>
            <span>{creatorRoyaltyPct}%{creatorRoyaltyReturnsToSeller ? ' (returns to you)' : ''}</span>
          </div>
          {collectionRoyaltyPct > 0 && (
            <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
              <span className="text-muted">Collection royalty</span>
              <span>{collectionRoyaltyPct}%{collectionRoyaltyReturnsToSeller ? ' (returns to you)' : ''}</span>
            </div>
          )}
          <div className="flex justify-between text-sm px-4 py-2.5">
            <span className="font-semibold">You receive</span>
            <span className="font-semibold text-success">{youReceivePct != null ? `${youReceivePct}% of sale price` : '—'}</span>
          </div>
        </div>}

        {native && <>
          {!nativeCanList && <p className="text-xs text-muted">{native.snapshot?.equipmentId && !equipmentSale
            ? 'Listing is blocked until the complete equipment removal plan can be verified. Saved transactions remain recoverable below.'
            : native.snapshot?.listed ? 'This Soul is already listed. Open the Soul page to update its price; saved transactions remain recoverable below.'
            : 'Listing requires the current owner, verified release readiness and no pending saved transaction.'}</p>}
          <NativeListingRecovery actions={native}/>
        </>}

        {/* Warning: grants voided */}
        {BigInt(soul.activeGrantCount) > 0n && <div className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm">
          <p className="font-semibold text-gold mb-1">
            <svg className="inline-block w-4 h-4 mr-1 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Active SoulGrant will be voided on sale.
          </p>
          <p className="text-muted text-xs leading-relaxed">
            Once this Soul transfers to a new owner, the current agent authorization is automatically revoked on-chain.
            The buyer starts with no active grant and must re-authorize their own agent.
          </p>
        </div>}

        {/* Info: escrow notice */}
        <div className="rounded-xl border border-purple/30 bg-purple/5 px-4 py-3 text-sm leading-relaxed text-action-label">
          {native ? 'Only this Soul will be listed in its current kiosk. Equipment is not included. You can cancel an unsold listing; removed equipment stays unequipped in your wallet.' : <>
            Your Soul will be <span className="font-semibold text-action-label">escrowed</span> in the contract during the listing.
            You can delist and reclaim it anytime before a sale.
          </>}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2.5">
          <Link
            href={`/souls/${encodeURIComponent(soul.onChainId)}`}
            className="bg-transparent text-foreground border border-border rounded-lg px-4 py-2.5 text-sm font-semibold hover:border-purple transition"
          >
            ← Cancel
          </Link>
          {authorizeHref ? (
            <Link
              href={authorizeHref}
              className="flex-1 bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-purple-deep transition text-center"
            >
              Next: Authorize →
            </Link>
          ) : (
            <button
              disabled
              className="flex-1 bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-lg opacity-40 cursor-not-allowed"
            >
              Enter a valid price
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
