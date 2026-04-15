'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { useListSoul } from '@/lib/hooks/use-list-soul'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default function AuthorizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, getAuthHeaders } = useAuth()
  const { data: soul, isLoading, error: loadError } = useSoulDetail(id, getAuthHeaders, user?.id)
  const { status, error, listSoul } = useListSoul(soul ?? null)
  const { showToast } = useToast()

  const rawPrice = searchParams.get('price')?.trim() ?? ''
  let priceAtomic: bigint | null = null
  let priceError: string | null = null
  if (rawPrice) {
    try {
      priceAtomic = parseDisplayAmountToAtomic(rawPrice)
    } catch (parseError) {
      priceError = parseError instanceof Error ? parseError.message : 'Invalid amount'
    }
  }

  const signing = status === 'building' || status === 'signing' || status === 'syncing'
  const signingLabel: Record<string, string> = {
    building: '⟳ Building TX…',
    signing: '⟳ Signing…',
    syncing: '⟳ Syncing…',
  }

  useEffect(() => {
    if (status !== 'done') return

    showToast('Soul listed on marketplace', 'success')
    router.replace(`/souls/${encodeURIComponent(id)}/sell/success?price=${encodeURIComponent(rawPrice)}`)
  }, [id, rawPrice, router, showToast, status])

  useEffect(() => {
    if (error) {
      showToast(`Listing failed: ${error}`, 'danger')
    }
  }, [error, showToast])

  if (isLoading) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-8">
        <div className="h-[420px] rounded-xl bg-card animate-pulse" />
      </div>
    )
  }

  if (loadError || !soul) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🫥"
          label="Soul not found"
          sublabel="The listing authorization flow could not load this asset."
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
          sublabel="Only the current owner can sign the listing transaction."
          actionLabel="Back to Soul"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}`
          }}
        />
      </div>
    )
  }

  if (priceAtomic == null || priceError) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="💸"
          label="Missing listing price"
          sublabel={priceError ?? 'Go back and enter the asking price before signing.'}
          actionLabel="Set Price"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}/sell`
          }}
        />
      </div>
    )
  }

  // Floor price enforcement — reject below-floor prices even if navigated here directly
  const collectionFloor = soul.collection?.floorPriceAtomic ? BigInt(soul.collection.floorPriceAtomic) : null
  if (collectionFloor != null && priceAtomic < collectionFloor) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        <EmptyState
          icon="🚫"
          label="Below collection floor"
          sublabel={`Minimum listing price for this collection is ${formatAtomicAmountForDisplay(collectionFloor.toString())}.`}
          actionLabel="Set Price"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}/sell`
          }}
        />
      </div>
    )
  }

  const signingSubLabel: Record<string, string> = {
    building: 'Preparing transaction…',
    signing: 'Entering escrow on SoulMarket · Sui',
    syncing: 'Syncing on-chain state…',
  }

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      <div className="bg-card2 border border-border px-4 sm:px-6 py-2.5 flex items-center gap-3 rounded-t-xl mb-0">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-success text-white">✓</div>
          <span className="text-success">Set Price</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple text-white">2</div>
          <span className="text-foreground font-semibold">Authorize</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-border text-muted">3</div>
          <span className="text-muted">Listed</span>
        </div>
      </div>

      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6 relative overflow-hidden">
        {/* Signing overlay */}
        {signing && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
            <div className="bg-card2 border border-purple rounded-2xl px-10 py-8 text-center max-w-[340px]">
              <svg className="w-8 h-8 mx-auto mb-4 text-foreground animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              <p className="font-bold text-base mb-1">Listing Soul…</p>
              <p className="text-muted text-sm">{signingSubLabel[status] ?? 'Processing…'}</p>
            </div>
          </div>
        )}
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1">Sell Soul</p>
        <h2 className="font-display text-xl font-bold mb-1">Step 2 — Authorize Listing</h2>
        <p className="text-muted text-sm mb-6">Sign to authorize the marketplace contract to hold your Soul in escrow.</p>

        <div className="bg-card2 border border-purple rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em]">Wallet Request</p>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Soul</span>
            <span className="font-semibold">{soul.name}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Contract</span>
            <span className="font-mono text-xs text-teal">SoulMarket::list_soul</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Listing Price</span>
            <span className="font-semibold">{formatAtomicAmountForDisplay(priceAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Creator Royalty</span>
            <span className="text-teal">{soul.creatorRoyaltyBps / 100}% → {soul.isCreator ? 'You' : formatAddress(soul.creatorAddress)} · <span className="text-[11px]">enforced on-chain</span></span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Platform Fee</span>
            <span>{soul.platformFeeBps != null ? `${(soul.platformFeeBps / 100).toFixed(1)}% → Soulidity` : '—'}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Escrow</span>
            <span className="font-semibold">Soul transferred to contract</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">SoulGrant</span>
            {soul.activeGrants.length > 0
              ? <span className="text-danger">{soul.activeGrants.length} active · Voided on transfer ✕</span>
              : <span className="text-muted">No active grants</span>}
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5">
            <span className="text-muted">Gas</span>
            <span>~0.001 SUI</span>
          </div>
        </div>

        {error && (
          <p className="text-danger text-xs mb-4 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 mb-6 text-sm text-gold leading-relaxed flex items-start gap-2">
          <span className="text-base mt-0.5">⚡</span>
          <span>Once listed, your Soul enters escrow. You can delist anytime to reclaim it if unsold.</span>
        </div>

        <div className="flex gap-2.5">
          <Link
            href={`/souls/${encodeURIComponent(soul.onChainId)}/sell?price=${encodeURIComponent(rawPrice)}`}
            className="bg-transparent text-foreground border border-border rounded-lg px-4 py-2.5 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <button
            onClick={() => {
              void listSoul(priceAtomic)
            }}
            disabled={signing}
            className="flex-1 bg-gold text-white font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
          >
            {signing ? (signingLabel[status] ?? '⟳ Signing…') : '✓ Sign & List'}
          </button>
        </div>
      </div>
    </div>
  )
}
