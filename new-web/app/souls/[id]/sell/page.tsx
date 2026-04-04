'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default function SellPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, getAuthHeaders } = useAuth()
  const { data: soul, isLoading, error } = useSoulDetail(id, getAuthHeaders, user?.id)
  const [price, setPrice] = useState('')

  let priceAtomic: bigint | null = null
  let priceError: string | null = null
  if (price.trim()) {
    try {
      priceAtomic = parseDisplayAmountToAtomic(price)
    } catch (parseError) {
      priceError = parseError instanceof Error ? parseError.message : 'Invalid amount'
    }
  }

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

  if (!soul.isOwner) {
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

  if (soul.listingStatus === 'listed' && soul.listedPriceAtomic) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🏷️"
          label="Soul already listed"
          sublabel={`Current listing: ${formatAtomicAmountForDisplay(soul.listedPriceAtomic)}.`}
          actionLabel="Open Soul"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}`
          }}
        />
      </div>
    )
  }

  const authorizeHref = priceAtomic
    ? `/souls/${encodeURIComponent(soul.onChainId)}/sell/authorize?price=${encodeURIComponent(price)}`
    : null

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center gap-0 rounded-t-xl mb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple text-white">1</div>
          <span className="text-foreground font-semibold">Set Price</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-border text-muted">2</div>
          <span className="text-muted">Authorize</span>
        </div>
      </div>

      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-xl font-bold mb-1">List Soul</h2>
          <p className="text-muted text-sm">Choose the asking price, then sign the real Soulidity listing transaction on the next screen.</p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-card2 p-4">
          <div
            className="w-12 h-12 rounded-lg border border-border bg-card flex items-center justify-center text-lg font-semibold shrink-0"
            style={soul.imageUrl ? {
              backgroundImage: `linear-gradient(135deg, rgba(15,17,26,0.15), rgba(44,20,98,0.55)), url(${soul.imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : undefined}
          >
            {!soul.imageUrl ? soul.name.slice(0, 1).toUpperCase() : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm">{soul.name}</p>
            <p className="text-xs text-muted">Owner {formatAddress(soul.currentOwnerAddress)}</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="page-kicker text-muted">Listing Price</label>
          <div className="flex items-center bg-card2 border border-border rounded-xl overflow-hidden focus-within:border-purple transition">
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="border-0 bg-transparent rounded-none focus:border-0"
              placeholder="0.00"
            />
            <span className="px-4 text-sm font-semibold text-muted border-l border-border py-3">USDC</span>
          </div>
          <p className="text-xs text-muted">Soulidity expects 6 decimal places for the payment coin. Example: `12.5`.</p>
          {priceError && <p className="text-danger text-xs">{priceError}</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card2 p-4">
            <div className="page-kicker text-muted mb-3">Resale Split</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Creator royalty</span>
                <span>{(soul.creatorRoyaltyBps / 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Collection royalty</span>
                <span>{soul.collection ? `${(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%` : 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Protocol fee</span>
                <span>Calculated at checkout</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card2 p-4">
            <div className="page-kicker text-muted mb-3">Grant & Escrow</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Active grant</span>
                <span>{soul.activeGrantCount > 0 ? `${soul.activeGrantCount} grant(s) invalid after transfer` : 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Kiosk escrow</span>
                <span>Required</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Current kiosk</span>
                <span className="font-mono text-xs text-teal">{formatAddress(soul.currentKioskId)}</span>
              </div>
            </div>
          </div>
        </div>

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
              className="flex-1 bg-gold text-black font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-gold-light transition text-center"
            >
              Next: Authorize →
            </Link>
          ) : (
            <button
              disabled
              className="flex-1 bg-gold text-black font-bold text-[15px] px-7 py-3 rounded-lg opacity-40 cursor-not-allowed"
            >
              Enter a valid price
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
