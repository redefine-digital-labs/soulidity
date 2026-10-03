'use client'

import { use } from 'react'
import Link from 'next/link'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { useListSoul } from '@/lib/hooks/use-list-soul'
import { NativeListingRecovery } from '@/components/souls/native-listing-recovery'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'

export default function SellSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: soul, error, refetch } = useSoulDetail(id)
  const {native}=useListSoul(soul??null)

  if (error) return <div className="max-w-[560px] mx-auto px-6 py-8"><p role="alert">Listing state could not be verified: {error.message}</p><button onClick={() => void refetch()}>Retry chain read</button></div>
  if (!soul) return <div className="max-w-[560px] mx-auto px-6 py-8"><p className="text-muted">Loading listing evidence…</p></div>
  if (native) return <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="font-display text-2xl font-bold mb-2">Listing receipt</h2>
      <p className="text-muted text-sm">Verify the saved transaction and current listing below. A saved receipt or a price in this URL is not proof that the Soul is still listed.</p>
      <NativeListingRecovery actions={native}/>
      {!native.record && <p className="mt-3 text-sm text-muted">{native.wallet ? 'No saved listing transaction for this wallet on this device.' : 'Connect the wallet used to list this Soul to load its saved transaction.'}</p>}
      <Link href={`/souls/${encodeURIComponent(soul.onChainId)}`} className="mt-4 inline-block text-action-label">Open Soul →</Link>
    </div>
  </div>

  if (soul.chainListingStatus !== 'LISTED' || !soul.listingObjectOnChainId || soul.listedPriceAtomic === null) {
    return <div className="max-w-[560px] mx-auto px-6 py-8"><h2>Listing is not active</h2>
      <p>The current chain state does not show an active listing. A price or success URL does not prove a sale listing.</p>
      <button onClick={() => void refetch()}>Refresh chain state</button>
      <Link href={`/souls/${encodeURIComponent(soul.onChainId)}`}>Open Soul →</Link></div>
  }
  const priceDisplay = formatAtomicAmountForDisplay(soul.listedPriceAtomic)
  const belowFloor = soul.listingStatus === 'floor-violation'

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      {/* Stepper bar */}
      <div className="bg-card2 border border-border px-4 sm:px-6 py-2.5 flex items-center gap-3 rounded-t-xl mb-0">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-success text-white">✓</div>
          <span className="text-success">Set Price</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-success text-white">✓</div>
          <span className="text-success">Authorize</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple text-white">✓</div>
          <span className="text-foreground font-semibold">Listed</span>
        </div>
      </div>

      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6 text-center pt-10">
        <div className="w-[72px] h-[72px] rounded-full bg-success/15 border-2 border-success flex items-center justify-center text-3xl mx-auto mb-5">
          🏷️
        </div>

        <h2 className="font-display text-2xl font-bold mb-2">{belowFloor ? 'Listed below collection floor' : 'Soul Listed!'}</h2>
        <p className="text-muted mb-7">
          {belowFloor ? 'Listed on chain but hidden by the collection floor policy, at ' : 'The current chain listing is active at '}
          <span className="text-gold font-semibold">{priceDisplay}</span>.
        </p>

        <div className="bg-card2 border border-border rounded-xl overflow-hidden text-left mb-5 text-sm">
          <div className="flex justify-between px-4 py-2.5 border-b border-border">
            <span className="text-muted">Soul</span>
            <span className="font-semibold">{soul?.name ?? id}</span>
          </div>
          <div className="flex justify-between px-4 py-2.5 border-b border-border">
            <span className="text-muted">Price</span>
            <span className="text-gold font-semibold">{priceDisplay}</span>
          </div>
          <div className="flex justify-between px-4 py-2.5 border-b border-border">
            <span className="text-muted">Listing Window</span>
            <span className="font-semibold">No expiry — delist manually</span>
          </div>
          <div className="flex justify-between px-4 py-2.5">
            <span className="text-muted">Status</span>
            <span className="text-success">{belowFloor ? '● Listed on chain · below floor' : '● Listed in Market'}</span>
          </div>
        </div>

        <div className="rounded-xl border border-teal/30 bg-teal/5 px-4 py-3 mb-7 text-left text-sm text-teal/90 leading-relaxed flex items-start gap-2">
          <span className="text-base mt-0.5">💡</span>
          <span>
            Soul is now in <span className="font-semibold text-teal">escrow</span>. It moves from{' '}
            <span className="font-semibold text-foreground">Owned</span> →{' '}
            <span className="font-semibold text-foreground">Listings</span> tab in My Souls.
            You can delist anytime before a buyer completes the purchase.
          </span>
        </div>

        <div className="flex gap-2.5 mb-4">
          <Link
            href="/market"
            className="flex-1 bg-transparent text-foreground border border-border font-semibold text-sm px-4 py-2.5 rounded-lg hover:border-purple transition text-center"
          >
            View in Market
          </Link>
          <Link
            href="/my-souls"
            className="flex-1 bg-purple text-white font-bold text-sm px-4 py-2.5 rounded-lg hover:bg-purple-deep transition text-center"
          >
            My Souls →
          </Link>
        </div>

        <Link
          href="/community"
          className="text-action-label text-sm transition hover:opacity-80"
        >
          📣 Announce Listing to Community →
        </Link>
      </div>
    </div>
  )
}
