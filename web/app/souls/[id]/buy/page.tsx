'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { useGenericLogin } from '@/lib/hooks/use-generic-login'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { TxPending } from '@/components/ui/tx-pending'
import { useToast } from '@/components/ui/toast'
import { usePurchase } from '@/lib/hooks/use-purchase'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { formatAtomicAmountForDisplay } from '@/lib/soulidity/format'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default function BuyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, loading, getAuthHeaders } = useAuth()
  const { ready } = usePrivy()
  const login = useGenericLogin()
  const { data: soul, isLoading, error: loadError } = useSoulDetail(id, getAuthHeaders, user?.id)
  const { status, error, purchase, txDigest } = usePurchase(soul ?? null)
  const { showToast } = useToast()

  const signing = status === 'building' || status === 'signing' || status === 'syncing'

  useEffect(() => {
    if (status === 'done') {
      showToast('Soul purchased successfully!', 'success')
    }
  }, [status, showToast])

  useEffect(() => {
    if (error) {
      showToast(`Transaction failed: ${error}`, 'danger')
    }
  }, [error, showToast])
  const signingLabel: Record<string, string> = {
    building: '⟳ Building TX…',
    signing: '⟳ Signing…',
    syncing: '⟳ Syncing…',
  }

  if (loading || !ready || isLoading) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-8">
        <div className="h-4 w-36 rounded bg-card2 animate-pulse mb-6" />
        <div className="h-[360px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🪪"
          label="Sign in to purchase"
          sublabel="Buying a Soulidity asset requires an authenticated wallet session before the checkout can continue."
          actionLabel="Sign In"
          onAction={login}
        />
      </div>
    )
  }

  if (loadError || !soul) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🫥"
          label="Soul not available"
          sublabel="The Soul detail route did not return a purchasable asset."
          actionLabel="Back to Market"
          onAction={() => {
            window.location.href = '/market'
          }}
        />
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
        <div className="bg-card border border-border rounded-xl p-6 text-center pt-10">
          <div className="w-[72px] h-[72px] rounded-full bg-success/15 border-2 border-success flex items-center justify-center text-3xl mx-auto mb-5">
            🎉
          </div>
          <h2 className="font-display text-xl font-bold mb-2">Soul acquired</h2>
          <p className="text-muted mb-6">
            <span className="font-semibold text-foreground">{soul.name}</span> is now synchronized to your wallet state.
          </p>

          <div className="bg-card2 border border-border rounded-xl p-4 text-left mb-6 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Soul</span>
              <span className="font-semibold">{soul.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Paid</span>
              <span className="text-gold font-semibold">
                {formatAtomicAmountForDisplay(soul.quote?.totalAtomic ?? soul.listedPriceAtomic)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Transaction</span>
              <span className="font-mono text-xs text-teal">{formatAddress(txDigest)}</span>
            </div>
          </div>

          <div className="flex gap-2.5">
            <Link
              href="/my-souls"
              className="flex-1 bg-purple text-white font-bold text-sm px-4.5 py-2.5 rounded-lg hover:bg-purple-deep transition text-center"
            >
              View in My Souls
            </Link>
            <Link
              href={`/souls/${encodeURIComponent(soul.onChainId)}`}
              className="flex-1 bg-transparent text-foreground border border-border font-semibold text-sm px-4.5 py-2.5 rounded-lg hover:border-purple transition text-center"
            >
              Open Detail
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (soul.listingStatus !== 'listed' || !soul.quote || !soul.listingObjectOnChainId) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🚫"
          label="Soul is not listed"
          sublabel="Only listed Soulidity assets can be purchased from this route."
          actionLabel="Back to Soul"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}`
          }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      <TxPending visible={signing} message={
        status === 'building' ? 'Building transaction…' :
        status === 'syncing' ? 'Syncing on-chain state…' :
        'Waiting for wallet signature…'
      } />
      <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center gap-0 rounded-t-xl mb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-success">✓</div>
          <span className="text-success">Review</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple">2</div>
          <span className="text-foreground font-semibold">Sign & Sync</span>
        </div>
      </div>

      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6">
        <h2 className="font-display text-xl font-bold mb-1">Confirm purchase</h2>
        <p className="text-muted text-sm mb-6">This checkout uses the on-chain Soulidity quote, including protocol and royalty fees.</p>

        <div className="bg-card2 border border-border rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-lg border border-border bg-card flex items-center justify-center text-lg font-semibold"
              style={soul.imageUrl ? {
                backgroundImage: `linear-gradient(135deg, rgba(15,17,26,0.15), rgba(44,20,98,0.55)), url(${soul.imageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              } : undefined}
            >
              {!soul.imageUrl ? soul.name.slice(0, 1).toUpperCase() : null}
            </div>
            <div>
              <p className="font-bold text-sm">{soul.name}</p>
              <p className="text-muted text-xs">Seller {formatAddress(soul.currentOwnerAddress)}</p>
            </div>
          </div>

          <div className="flex justify-between text-sm py-2 border-b border-border">
            <span className="text-muted">List price</span>
            <span className="font-semibold">{formatAtomicAmountForDisplay(soul.quote.priceAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b border-border">
            <span className="text-muted">Protocol fee</span>
            <span>{formatAtomicAmountForDisplay(soul.quote.platformFeeAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b border-border">
            <span className="text-muted">Creator royalty</span>
            <span>{formatAtomicAmountForDisplay(soul.quote.creatorRoyaltyAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b border-border">
            <span className="text-muted">Collection royalty</span>
            <span>{formatAtomicAmountForDisplay(soul.quote.collectionRoyaltyAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm py-2 font-bold">
            <span>Total</span>
            <span className="text-gold">{formatAtomicAmountForDisplay(soul.quote.totalAtomic)}</span>
          </div>
        </div>

        {error && (
          <p className="text-danger text-xs mb-4 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 text-xs text-muted leading-relaxed">
          The buyer kiosk is prepared automatically if you do not already have one. The route only marks the purchase complete after the transaction succeeds and the projection is synced.
        </div>

        <div className="flex gap-2.5">
          <Link
            href={`/souls/${encodeURIComponent(soul.onChainId)}`}
            className="bg-transparent text-foreground border border-border rounded-lg px-4.5 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <button
            onClick={() => {
              void purchase()
            }}
            disabled={signing}
            className="flex-1 bg-gold text-black font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
          >
            {signing ? (signingLabel[status] ?? '⟳ Signing…') : `Buy for ${formatAtomicAmountForDisplay(soul.quote.totalAtomic)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
