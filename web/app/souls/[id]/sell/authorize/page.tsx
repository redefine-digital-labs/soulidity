'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/auth-provider'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { useListSoul } from '@/lib/hooks/use-list-soul'
import { NativeListingRecovery } from '@/components/souls/native-listing-recovery'
import { NativeListingQuote } from '@/components/souls/native-listing-quote'
import { useSoulDetail } from '@/lib/hooks/use-souls'
import {
  formatAtomicAmountForDisplay,
  parseDisplayAmountToAtomic,
} from '@soulidity/sdk'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default function AuthorizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, getAuthHeaders } = useAuth()
  const { data: soul, isLoading, error: loadError } = useSoulDetail(id)
  const { status, error, listSoul, native } = useListSoul(soul ?? null)
  const equipmentSale = native?.snapshot?.equipmentSale
  const nativeCanList = native?.canList && !!native.snapshot
    && (native.snapshot.equipmentId === null || !!equipmentSale)
  const { showToast } = useToast()

  const rawPrice = searchParams.get('price')?.trim() ?? ''
  let priceAtomic: bigint | null = null
  let priceError: string | null = null
  if (rawPrice) {
    try {
      priceAtomic = parseDisplayAmountToAtomic(rawPrice)
      if (priceAtomic > 18446744073709551615n) throw new Error('Listing price exceeds the supported maximum')
    } catch (parseError) {
      priceError = parseError instanceof Error ? parseError.message : 'Invalid amount'
    }
  }

  const recovery = native ? <NativeListingRecovery actions={native}/> : null
  const signing = native ? native.busy : status === 'building' || status === 'signing' || status === 'syncing'
  const signingLabel: Record<string, string> = {
    building: '⟳ Building TX…',
    signing: '⟳ Signing…',
    syncing: '⟳ Syncing…',
  }

  useEffect(() => {
    if (status !== 'done' || native) return

    showToast('Soul listed on marketplace', 'success')
    router.replace(`/souls/${encodeURIComponent(id)}/sell/success?price=${encodeURIComponent(rawPrice)}`)
  }, [id, rawPrice, router, showToast, status, native])

  useEffect(() => {
    if (error) {
      showToast(`Listing needs attention: ${error}`, 'danger')
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
        {recovery}
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

  if (!native && !soul.isOwner) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        {recovery}
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

  if (priceAtomic == null || priceAtomic <= 0n || priceError) {
    const invalidPriceMessage = priceError ?? (priceAtomic != null && priceAtomic <= 0n
      ? 'Listing price must be greater than 0.'
      : 'Go back and enter the asking price before signing.')
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        {recovery}
        <EmptyState
          icon="💸"
          label="Missing listing price"
          sublabel={invalidPriceMessage}
          actionLabel="Set Price"
          onAction={() => {
            window.location.href = `/souls/${encodeURIComponent(soul.onChainId)}/sell`
          }}
        />
      </div>
    )
  }

  // Floor price enforcement — reject below-floor prices even if navigated here directly
  const collectionFloor = !native && soul.collection?.floorPriceAtomic ? BigInt(soul.collection.floorPriceAtomic) : null
  if (collectionFloor != null && priceAtomic < collectionFloor) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-10">
        {recovery}
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
      {recovery}
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
        <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1">Sell Soul</p>
        <h2 className="font-display text-xl font-bold mb-1">Step 2 — Authorize Listing</h2>
        <p className="text-muted text-sm mb-6">{native ? 'Review the selected Soul and exact removal plan before signing one atomic listing transaction.' : 'Sign to authorize the marketplace contract to hold your Soul in escrow.'}</p>

        {native && <section aria-label="Confirm selected sale" className="rounded-xl border border-border bg-card2 p-4 mb-5 space-y-2 text-xs">
          <p className="font-semibold">For sale: 1 Animacraft Soul only</p>
          <p className="break-all">Soul ID: {soul.onChainId}</p>
          <p>Gross listing price: {formatAtomicAmountForDisplay(priceAtomic)}</p>
          <p>Equipment is not for sale. Selecting this Soul does not select any equipment for sale.</p>
          {native.snapshot?.equipmentId ? equipmentSale ? <>
            <p className="break-all">Equipment binding: {equipmentSale.scope.equipmentId} · Revision {String(equipmentSale.scope.expectedRevision)}</p>
            <p>Remove these {equipmentSale.removals.length} equipped selections, close the empty binding, then list only the Soul in the same transaction:</p>
            <ul className="space-y-1 break-all" aria-label="Equipment removal list">
              {equipmentSale.removals.map(removal => <li key={removal.kind === 'selection' ? `slot:${removal.selectionIndex}` : removal.itemId}>
                {removal.kind === 'selection' ? `Usage selection at slot ${removal.selectionIndex} — cleared, not an owned equipment sale`
                  : `${removal.kind === 'base' ? 'Base' : 'External'} equipment ${removal.itemId} — unequipped, stays in seller’s wallet`}
              </li>)}
            </ul>
            <p>{equipmentSale.packs.length} attached Pack definition sources are checked; no Pack or access right is sold.</p>
            <p>If any removal or listing fails, the entire transaction rolls back. Cancelling a successful listing does not re-equip anything.</p>
          </> : <p>Complete verified equipment removal plan unavailable. Refresh before signing; no partial removal or listing will be submitted.</p>
            : native.snapshot ? <p>No equipment binding was found in the verified snapshot.</p> : <p>Waiting for the verified Soul and equipment snapshot.</p>}
          <p>Going back without signing changes nothing on-chain. A saved signing request may already exist; check it in recovery before starting again.</p>
        </section>}

        <div className="bg-card2 border border-purple rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-2.5 border-b border-border">
            <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em]">Wallet Request</p>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Soul</span>
            <span className="font-semibold">{soul.name}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Contract</span>
            <span className="font-mono text-xs text-teal">
              {native
                ? 'market::list_animacraft_v8_soul_fixed_price'
                : 'market::list_soul_fixed_price_v2'}
            </span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Proposed Listing Price</span>
            <span className="font-semibold">{formatAtomicAmountForDisplay(priceAtomic)}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">{native ? 'Soul Creator Royalty' : 'Creator Royalty'}</span>
            <span className="text-teal">
              {native ? native.snapshot ? `${native.snapshot.soulCreatorRoyaltyBps / 100}%` : '—' : `${soul.creatorRoyaltyBps / 100}%`} → {formatAddress(native ? native.snapshot?.creator : soul.creatorAddress)} ·{' '}
              <span className="text-[11px]">
                {native ? 'frozen at first mint' : 'enforced on-chain'}
              </span>
            </span>
          </div>
          {native && (
            <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
              <span className="text-muted">Maker-source Royalty</span>
              <span className="text-teal">
                {native.snapshot ? `${native.snapshot.makerSourceRoyaltyBps / 100}%` : '—'} →{' '}
                {formatAddress(native.snapshot?.makerCreator)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Platform Fee</span>
            <span>
              {native
                ? native.snapshot ? '2.5% → Soulidity' : '—'
                : soul.platformFeeBps != null
                  ? `${(soul.platformFeeBps / 100).toFixed(1)}% → Soulidity`
                  : '—'}
            </span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">Escrow</span>
            <span className="font-semibold">{native ? 'Only the Soul listed in its current kiosk' : 'Soul transferred to contract'}</span>
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5 border-b border-border">
            <span className="text-muted">SoulGrant</span>
            {soul.activeGrants.length > 0
              ? <span className="text-danger">{soul.activeGrants.length} active · Voided on transfer ✕</span>
              : <span className="text-muted">No active grants</span>}
          </div>
          <div className="flex justify-between text-sm px-4 py-2.5">
            <span className="text-muted">Gas</span>
            <span>{native ? 'Shown by the wallet before signing' : '~0.001 SUI'}</span>
          </div>
        </div>

        {native && <div className="mb-4"><NativeListingQuote snapshot={native.snapshot} priceAtomic={priceAtomic}/>
          {!nativeCanList && <p className="mt-3 text-xs text-muted">{native.snapshot?.equipmentId && !equipmentSale
            ? 'Listing is blocked until the complete equipment removal plan can be verified. Saved transactions remain recoverable above.'
            : 'New listing requires the current owner, an available release and no pending saved request. Use recovery for an existing transaction.'}</p>}
        </div>}
        {!native && error && (
          <p className="text-danger text-xs mb-4 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 mb-6 text-sm text-gold leading-relaxed flex items-start gap-2">
          <span className="text-base mt-0.5">⚡</span>
          <span>
            {native
              ? 'The buyer will pay exactly this gross price. Protocol and both frozen royalty shares are distributed from it. Once listed, you can delist anytime if unsold.'
              : 'Once listed, your Soul enters escrow. You can delist anytime to reclaim it if unsold.'}
          </span>
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
              if (native && !nativeCanList) return
              void listSoul(priceAtomic)
            }}
            disabled={signing || !!native && !nativeCanList}
            className="flex-1 bg-gold text-white font-bold text-[15px] px-7 py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
          >
            {signing ? (signingLabel[status] ?? '⟳ Signing…') : '✓ Sign & List'}
          </button>
        </div>
      </div>
    </div>
  )
}
