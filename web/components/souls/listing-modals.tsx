'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { assertObjectInputsExist, getAnimacraftAppearanceV6Id } from '@soulidity/sdk'
import { buildUpdateListingPriceTx } from '@soulidity/sdk'
import { buildDelistAnimacraftV6SoulTx, buildDelistSoulTx } from '@soulidity/sdk'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@soulidity/sdk'
import type { SoulAssetDetail } from '@soulidity/sdk'

// Sui wallets (Slush, Suiet, Backpack, Sui Wallet) signal user-initiated
// cancellation through the thrown Error message. Treat these as a deliberate
// "no-op" rather than a failure surface.
function isWalletUserRejection(error: unknown): boolean {
  if (!error) return false
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('user rejected')
    || message.includes('user reject')
    || message.includes('user denied')
    || message.includes('user deny')
    || message.includes('user cancelled')
    || message.includes('user canceled')
    || message.includes('rejected the request')
    || message.includes('rejected by user')
  )
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
  const { signAndExecute, suiClient } = useWalletSign()
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
  const invalidPrice = priceAtomic != null && priceAtomic <= 0n
  const belowFloor = priceAtomic != null && collectionFloor != null && priceAtomic < collectionFloor

  const samePrice = priceAtomic != null && soul.listedPriceAtomic != null
    && priceAtomic === BigInt(soul.listedPriceAtomic)

  async function handleUpdatePrice() {
    if (priceAtomic == null || priceAtomic <= 0n || !soul.listingObjectOnChainId) return
    setStatus('signing')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const soulKioskId = soul.currentKioskId
      const soulKioskCapId = soul.currentKioskCapOnChainId
      if (!soulKioskId || !soulKioskCapId) {
        throw new Error('Soul kiosk info is missing - the Soul may not be held in a personal kiosk')
      }
      if (soul.provenanceKind === 'animacraft' && !soul.animacraftProvenance) {
        throw new Error('Animacraft provenance is unavailable; price update is blocked')
      }
      const appearanceV6Id = await getAnimacraftAppearanceV6Id(soul.stateOnChainId)
      if (appearanceV6Id) {
        throw new Error(
          'Animacraft v6 listings cannot be repriced in place. Delist this Soul, then create a fresh listing.',
        )
      }
      await assertObjectInputsExist(suiClient, {
        'Soul kiosk': soulKioskId,
        'Soul kiosk capability': soulKioskCapId,
        'Soul state': soul.stateOnChainId,
        Soul: soul.onChainId,
        'Soul listing': soul.listingObjectOnChainId,
        Collection: soul.collectionOnChainId,
        'Animacraft provenance': soul.animacraftProvenance?.objectId ?? null,
      })
      const tx = buildUpdateListingPriceTx({
        currentKioskId: soulKioskId,
        currentKioskCapOnChainId: soulKioskCapId,
        stateObjectId: soul.stateOnChainId,
        listingObjectId: soul.listingObjectOnChainId,
        newPriceAtomic: priceAtomic,
        collectionObjectId: soul.collectionOnChainId,
        animacraftProvenanceObjectId: soul.animacraftProvenance?.objectId,
        animacraftVersion: soul.animacraftProvenance?.animacraftVersion,
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
      if (isWalletUserRejection(e)) return
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
        {invalidPrice && <p className="mt-1 text-xs text-danger">Listing price must be greater than 0</p>}
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
        disabled={priceAtomic == null || invalidPrice || !!priceError || samePrice || belowFloor || status !== 'idle'}
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
  const { signAndExecute, suiClient } = useWalletSign()
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
      const soulKioskId = soul.currentKioskId
      const soulKioskCapId = soul.currentKioskCapOnChainId
      if (!soulKioskId || !soulKioskCapId) {
        throw new Error('Soul kiosk info is missing - the Soul may not be held in a personal kiosk')
      }
      const appearanceV6Id = await getAnimacraftAppearanceV6Id(soul.stateOnChainId)
      await assertObjectInputsExist(suiClient, {
        'Soul kiosk': soulKioskId,
        'Soul kiosk capability': soulKioskCapId,
        'Soul state': soul.stateOnChainId,
        'Animacraft v6 appearance': appearanceV6Id,
        'Soul listing': soul.listingObjectOnChainId,
      })
      const tx = appearanceV6Id
        ? buildDelistAnimacraftV6SoulTx({
            currentKioskId: soulKioskId,
            currentKioskCapOnChainId: soulKioskCapId,
            stateObjectId: soul.stateOnChainId,
            appearanceObjectId: appearanceV6Id,
            listingObjectId: soul.listingObjectOnChainId,
          })
        : buildDelistSoulTx({
            currentKioskId: soulKioskId,
            currentKioskCapOnChainId: soulKioskCapId,
            stateObjectId: soul.stateOnChainId,
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
      if (isWalletUserRejection(e)) return
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
