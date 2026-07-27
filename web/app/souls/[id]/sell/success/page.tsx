'use client'

import { use } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@soulidity/sdk'

function resolvePriceDisplay(rawPrice: string | null, listedPriceAtomic: string | null) {
  if (rawPrice) {
    try {
      return formatAtomicAmountForDisplay(parseDisplayAmountToAtomic(rawPrice))
    } catch {
      return rawPrice
    }
  }

  if (listedPriceAtomic) {
    return formatAtomicAmountForDisplay(listedPriceAtomic)
  }

  return 'Pending sync'
}

export default function SellSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const { user, getAuthHeaders } = useAuth()
  const { data: soul } = useSoulDetail(id, getAuthHeaders, user?.id)

  const priceDisplay = resolvePriceDisplay(searchParams.get('price'), soul?.listedPriceAtomic ?? null)

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

        <h2 className="font-display text-2xl font-bold mb-2">Soul Listed!</h2>
        <p className="text-muted mb-7">
          Your Soul is now live in the marketplace at{' '}
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
            <span className="text-success">● Listed in Market</span>
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
