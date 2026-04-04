'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
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
    if (status === 'done' && soul) {
      router.push(`/souls/${encodeURIComponent(soul.onChainId)}/sell/success?price=${encodeURIComponent(rawPrice)}`)
    }
  }, [rawPrice, router, soul, status])

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

  if (!priceAtomic || priceError) {
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

  return (
    <div className="max-w-[560px] mx-auto px-6 py-8 relative z-10">
      <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center gap-0 rounded-t-xl mb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-success text-white">✓</div>
          <span className="text-success">Set Price</span>
        </div>
        <span className="mx-2.5 text-border text-[11px]">›</span>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-purple text-white">2</div>
          <span className="text-foreground font-semibold">Authorize</span>
        </div>
      </div>

      <div className="bg-card border border-border border-t-0 rounded-b-xl p-6">
        <h2 className="font-display text-xl font-bold mb-1">Authorize listing</h2>
        <p className="text-muted text-sm mb-6">The kiosk transfer and listing object are created only after this signature succeeds on chain.</p>

        <div className="bg-card2 border border-purple rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em]">Wallet Request</p>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Soul</span>
            <span className="font-semibold">{soul.name}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Ask price</span>
            <span className="font-semibold text-gold">{formatAtomicAmountForDisplay(priceAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Creator royalty</span>
            <span>{(soul.creatorRoyaltyBps / 100).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Collection royalty</span>
            <span>{soul.collection ? `${(soul.collection.extraRoyaltyBps / 100).toFixed(2)}%` : 'None'}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Escrow kiosk</span>
            <span className="font-mono text-xs text-teal">{formatAddress(soul.currentKioskId)}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5">
            <span className="text-muted">Grant impact</span>
            <span>{soul.activeGrantCount > 0 ? `${soul.activeGrantCount} grant(s) become invalid after sale` : 'No active grant'}</span>
          </div>
        </div>

        {error && (
          <p className="text-danger text-xs mb-4 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="bg-card2 border border-border rounded-xl px-4 py-3 mb-6 text-xs text-muted leading-relaxed">
          The server will only mirror the listing after the submitted digest resolves successfully and the emitted `SoulListed` event matches this owner wallet.
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
            className="flex-1 bg-gold text-black font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
          >
            {signing ? (signingLabel[status] ?? '⟳ Signing…') : '✓ Sign & List'}
          </button>
        </div>
      </div>
    </div>
  )
}
