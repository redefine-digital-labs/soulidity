'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildUpdateListingPriceTx } from '@/lib/soulidity/tx/update-price'
import { buildDelistSoulTx } from '@/lib/soulidity/tx/delist'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'
import type { SoulAssetDetail } from '@/lib/soulidity/types'

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

async function fetchPersonalKiosk(authHeaders: Record<string, string>, walletAddress?: string | null) {
  const url = walletAddress
    ? `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`
    : '/api/souls/personal-kiosk'
  const res = await fetch(url, { cache: 'no-store', headers: authHeaders })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to resolve personal kiosk')
  }
  return res.json() as Promise<{ currentKioskId: string; currentKioskCapOnChainId: string }>
}

/* ------------------------------------------------------------------ */
/*  Update Price Modal                                                 */
/* ------------------------------------------------------------------ */

interface UpdatePriceModalProps {
  soul: SoulAssetDetail
  open: boolean
  onClose: () => void
}

export function UpdatePriceModal({ soul, open, onClose }: UpdatePriceModalProps) {
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<'idle' | 'signing' | 'syncing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  let priceAtomic: bigint | null = null
  let priceError: string | null = null
  if (price.trim()) {
    try {
      priceAtomic = parseDisplayAmountToAtomic(price)
    } catch (e) {
      priceError = e instanceof Error ? e.message : 'Invalid amount'
    }
  }

  const currentPrice = soul.listedPriceAtomic
    ? formatAtomicAmountForDisplay(soul.listedPriceAtomic)
    : null

  const collectionFloor = soul.collection?.floorPriceAtomic ? BigInt(soul.collection.floorPriceAtomic) : null
  const belowFloor = priceAtomic != null && collectionFloor != null && priceAtomic < collectionFloor

  const samePrice = priceAtomic != null && soul.listedPriceAtomic != null
    && priceAtomic === BigInt(soul.listedPriceAtomic)

  async function handleUpdatePrice() {
    if (priceAtomic == null || !soul.listingObjectOnChainId) return
    setStatus('signing')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const kiosk = await fetchPersonalKiosk(authHeaders, suiWallet?.address)
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': kiosk.currentKioskId,
        'Your personal kiosk capability': kiosk.currentKioskCapOnChainId,
        'Soul state': soul.stateOnChainId,
        Soul: soul.onChainId,
        'Soul listing': soul.listingObjectOnChainId,
        Collection: soul.collectionOnChainId,
      })
      const tx = buildUpdateListingPriceTx({
        currentKioskId: kiosk.currentKioskId,
        currentKioskCapOnChainId: kiosk.currentKioskCapOnChainId,
        stateObjectId: soul.stateOnChainId,
        soulObjectId: soul.onChainId,
        listingObjectId: soul.listingObjectOnChainId,
        newPriceAtomic: priceAtomic,
        collectionObjectId: soul.collectionOnChainId,
      })
      const result = await signAndExecute(tx)

      setStatus('syncing')
      const syncRes = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/list`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to sync new listing')
      }

      void queryClient.invalidateQueries({ queryKey: ['soul'] })
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      showToast('Listing price updated', 'success')
      setPrice('')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update price failed'
      setError(msg)
      showToast(`Price update failed: ${msg}`, 'danger')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" title="Update Listing Price" subtitle={soul.name}>
      {/* Current price */}
      {currentPrice && (
        <div className="rounded-xl border border-border bg-card2/60 px-4 py-3 mb-4">
          <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1">Current Price</p>
          <p className="text-lg font-bold text-gold">{currentPrice}</p>
        </div>
      )}

      {/* New price input */}
      <div className="mb-4">
        <label className="block text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1.5">
          New Price (USDC)
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          disabled={status !== 'idle'}
          placeholder="0.00"
          className="w-full rounded-lg border border-border bg-card2 px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 outline-none focus:border-gold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        />
        {priceError && <p className="mt-1 text-xs text-danger">{priceError}</p>}
        {belowFloor && collectionFloor && (
          <p className="mt-1 text-xs text-danger">
            Minimum price for this collection is {formatAtomicAmountForDisplay(collectionFloor.toString())} USDC
          </p>
        )}
        {samePrice && <p className="mt-1 text-xs text-muted">Same as current price</p>}
      </div>

      <p className="text-[11px] text-muted mb-5">
        This will delist and relist the Soul at the new price in a single transaction. The Soul stays in escrow.
      </p>

      <Button
        variant="gold"
        full
        disabled={priceAtomic == null || !!priceError || samePrice || belowFloor || status !== 'idle'}
        onClick={handleUpdatePrice}
      >
        {status === 'signing' ? 'Signing\u2026' : status === 'syncing' ? 'Syncing\u2026' : 'Update Price'}
      </Button>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/*  Delist Modal                                                       */
/* ------------------------------------------------------------------ */

interface DelistModalProps {
  soul: SoulAssetDetail
  open: boolean
  onClose: () => void
}

export function DelistModal({ soul, open, onClose }: DelistModalProps) {
  const [status, setStatus] = useState<'idle' | 'signing' | 'syncing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders } = useAuth()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const currentPrice = soul.listedPriceAtomic
    ? formatAtomicAmountForDisplay(soul.listedPriceAtomic)
    : null

  async function handleDelist() {
    if (!soul.listingObjectOnChainId) return
    setStatus('signing')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const kiosk = await fetchPersonalKiosk(authHeaders, suiWallet?.address)
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': kiosk.currentKioskId,
        'Your personal kiosk capability': kiosk.currentKioskCapOnChainId,
        'Soul listing': soul.listingObjectOnChainId,
      })
      const tx = buildDelistSoulTx({
        currentKioskId: kiosk.currentKioskId,
        currentKioskCapOnChainId: kiosk.currentKioskCapOnChainId,
        listingObjectId: soul.listingObjectOnChainId,
      })
      const result = await signAndExecute(tx)

      setStatus('syncing')
      const syncRes = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/delist`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to sync delist')
      }

      void queryClient.invalidateQueries({ queryKey: ['soul'] })
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      showToast('Soul delisted successfully', 'success')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delist failed'
      setError(msg)
      showToast(`Delist failed: ${msg}`, 'danger')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" title="Delist Soul" subtitle={soul.name}>
      <div className="rounded-xl border border-danger/25 bg-danger/[0.06] px-4 py-3 mb-5">
        <p className="text-sm text-foreground">
          Are you sure you want to remove this Soul from the marketplace?
        </p>
        {currentPrice && (
          <p className="mt-1 text-xs text-muted">
            Current listing price: <span className="text-gold font-semibold">{currentPrice}</span>
          </p>
        )}
      </div>

      <p className="text-[11px] text-muted mb-5">
        The Soul will be returned to your kiosk and no longer visible in the marketplace. You can relist it at any time.
      </p>

      <div className="flex gap-2">
        <Button variant="outline" full onClick={onClose} disabled={status !== 'idle'}>
          Cancel
        </Button>
        <Button
          variant="danger"
          full
          disabled={status !== 'idle'}
          onClick={handleDelist}
        >
          {status === 'signing' ? 'Signing\u2026' : status === 'syncing' ? 'Syncing\u2026' : 'Delist Soul'}
        </Button>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </Modal>
  )
}
