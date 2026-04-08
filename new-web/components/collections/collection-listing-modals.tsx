'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useCollectionListing } from '@/lib/hooks/use-collections'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@/lib/soulidity/format'
import type { SoulCollectionAssetSummary } from '@/lib/soulidity/types'

/* ------------------------------------------------------------------ */
/*  List Collection Modal                                              */
/* ------------------------------------------------------------------ */

interface ListCollectionModalProps {
  collection: SoulCollectionAssetSummary
  open: boolean
  onClose: () => void
}

export function ListCollectionModal({ collection, open, onClose }: ListCollectionModalProps) {
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { status, error: hookError, list } = useCollectionListing(collection)
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

  async function handleList() {
    if (!priceAtomic) return
    setError(null)
    try {
      await list(priceAtomic)
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      void queryClient.invalidateQueries({ queryKey: ['collection'] })
      void queryClient.invalidateQueries({ queryKey: ['collections'] })
      showToast('Collection listed on marketplace', 'success')
      setPrice('')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Listing failed'
      setError(msg)
      showToast(`Listing failed: ${msg}`, 'danger')
    }
  }

  const displayError = error || hookError

  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" title="List Soul Collection" subtitle="Put your Soul Collection's royalty rights on the open market. The buyer will receive the royalty stream.">
      <div className="mb-4">
        <label className="block text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1.5">
          Listing Price (USDC)
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
      </div>

      <p className="text-[11px] text-muted mb-4">
        Minimum fee 0.5% deducted on sale. You keep the rest of it.
      </p>

      <div className="rounded-xl border border-purple/20 bg-purple/[0.06] px-4 py-3 mb-5">
        <p className="text-[11px] text-muted">
          While listed, you will still earn royalties from Soul sales. The royalty stream only transfers to the new owner upon successful purchase.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" full onClick={onClose} disabled={status !== 'idle'}>
          Cancel
        </Button>
        <Button
          variant="gold"
          full
          disabled={!priceAtomic || !!priceError || status !== 'idle'}
          onClick={handleList}
        >
          {status === 'signing' ? 'Signing\u2026' : status === 'syncing' ? 'Syncing\u2026' : 'List'}
        </Button>
      </div>

      {displayError && <p className="mt-3 text-xs text-danger">{displayError}</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/*  Edit Collection Price Modal                                        */
/* ------------------------------------------------------------------ */

interface EditCollectionPriceModalProps {
  collection: SoulCollectionAssetSummary
  open: boolean
  onClose: () => void
}

export function EditCollectionPriceModal({ collection, open, onClose }: EditCollectionPriceModalProps) {
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { status, error: hookError, updatePrice } = useCollectionListing(collection)
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

  const currentPrice = collection.listedPriceAtomic
    ? formatAtomicAmountForDisplay(collection.listedPriceAtomic)
    : null

  const samePrice = priceAtomic != null && collection.listedPriceAtomic != null
    && priceAtomic === BigInt(collection.listedPriceAtomic)

  async function handleUpdatePrice() {
    if (!priceAtomic) return
    setError(null)
    try {
      await updatePrice(priceAtomic)
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      void queryClient.invalidateQueries({ queryKey: ['collection'] })
      void queryClient.invalidateQueries({ queryKey: ['collections'] })
      showToast('Collection listing price updated', 'success')
      setPrice('')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Price update failed'
      setError(msg)
      showToast(`Price update failed: ${msg}`, 'danger')
    }
  }

  const displayError = error || hookError

  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" title="Edit Listing Price" subtitle="Update the price for your Soul Collection listing. Your listing will remain active with the updated price.">
      {currentPrice && (
        <div className="rounded-xl border border-border bg-card2/60 px-4 py-3 mb-4">
          <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-1">Current Price</p>
          <p className="text-lg font-bold text-gold">{currentPrice}</p>
        </div>
      )}

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
        {samePrice && <p className="mt-1 text-xs text-muted">Same as current price</p>}
      </div>

      <p className="text-[11px] text-muted mb-4">
        Minimum fee 0.5% deducted on sale.
      </p>

      <div className="rounded-xl border border-purple/20 bg-purple/[0.06] px-4 py-3 mb-5">
        <p className="text-[11px] text-muted">
          Price changes do not reset your listing. Royalties continue to accrue until a buyer pays.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" full onClick={onClose} disabled={status !== 'idle'}>
          Cancel
        </Button>
        <Button
          variant="gold"
          full
          disabled={!priceAtomic || !!priceError || samePrice || status !== 'idle'}
          onClick={handleUpdatePrice}
        >
          {status === 'signing' ? 'Signing\u2026' : status === 'syncing' ? 'Syncing\u2026' : 'Update Price'}
        </Button>
      </div>

      {displayError && <p className="mt-3 text-xs text-danger">{displayError}</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/*  Delist Collection Modal                                            */
/* ------------------------------------------------------------------ */

interface DelistCollectionModalProps {
  collection: SoulCollectionAssetSummary
  open: boolean
  onClose: () => void
}

export function DelistCollectionModal({ collection, open, onClose }: DelistCollectionModalProps) {
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { status, error: hookError, delist } = useCollectionListing(collection)
  const { showToast } = useToast()

  const currentPrice = collection.listedPriceAtomic
    ? formatAtomicAmountForDisplay(collection.listedPriceAtomic)
    : null

  async function handleDelist() {
    setError(null)
    try {
      await delist()
      void queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      void queryClient.invalidateQueries({ queryKey: ['collection'] })
      void queryClient.invalidateQueries({ queryKey: ['collections'] })
      showToast('Collection delisted successfully', 'success')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delist failed'
      setError(msg)
      showToast(`Delist failed: ${msg}`, 'danger')
    }
  }

  const displayError = error || hookError

  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" title="Delist Soul Collection" subtitle={collection.name}>
      <div className="rounded-xl border border-danger/25 bg-danger/[0.06] px-4 py-3 mb-5">
        <p className="text-sm text-foreground">
          Are you sure you want to remove this collection from the marketplace?
        </p>
        {currentPrice && (
          <p className="mt-1 text-xs text-muted">
            Current listing price: <span className="text-gold font-semibold">{currentPrice}</span>
          </p>
        )}
      </div>

      <p className="text-[11px] text-muted mb-5">
        The collection right will be returned to your kiosk and no longer visible in the marketplace. You can relist it at any time.
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
          {status === 'signing' ? 'Signing\u2026' : status === 'syncing' ? 'Syncing\u2026' : 'Delist'}
        </Button>
      </div>

      {displayError && <p className="mt-3 text-xs text-danger">{displayError}</p>}
    </Modal>
  )
}
