'use client'

import { useState } from 'react'
import type { SoulAssetDetail } from '@/lib/soulidity/types'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildListSoulTx } from '@/lib/soulidity/tx/list'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'

export type ListStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export function useListSoul(soul: SoulAssetDetail | null) {
  const [status, setStatus] = useState<ListStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders } = useAuth()

  async function listSoul(priceAtomic: bigint) {
    if (!soul) {
      setError('Soul is not available')
      setStatus('error')
      return
    }
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }
    if (priceAtomic <= 0n) {
      setError('Price must be greater than 0')
      setStatus('error')
      return
    }

    // Enforce collection floor price before building the on-chain TX
    if (soul.collection?.floorPriceAtomic) {
      const floorAtomic = BigInt(soul.collection.floorPriceAtomic)
      if (priceAtomic < floorAtomic) {
        setError('Listing price is below the collection floor price')
        setStatus('error')
        return
      }
    }

    try {
      setStatus('building')
      setError(null)
      const authHeaders = await getAuthHeaders()
      // Use the soul's own kiosk (where it was minted), not a generic resolved kiosk
      const soulKioskId = soul.currentKioskId
      const soulKioskCapId = soul.currentKioskCapOnChainId
      if (!soulKioskId || !soulKioskCapId) {
        throw new Error('Soul kiosk info is missing — the Soul may not be held in a personal kiosk')
      }
      await assertObjectInputsExist(suiClient, {
        'Soul kiosk': soulKioskId,
        'Soul kiosk capability': soulKioskCapId,
        'Soul state': soul.stateOnChainId,
        Soul: soul.onChainId,
        Collection: soul.collectionOnChainId,
      })

      const tx = buildListSoulTx({
        currentKioskId: soulKioskId,
        currentKioskCapOnChainId: soulKioskCapId,
        stateObjectId: soul.stateOnChainId,
        soulObjectId: soul.onChainId,
        priceAtomic,
        collectionObjectId: soul.collectionOnChainId,
      })

      setStatus('signing')
      const result = await signAndExecute(tx)
      setTxDigest(result.digest)

      setStatus('syncing')
      const syncRes = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/list`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror listing')
      }

      setStatus('done')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Listing failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, listSoul, suiWallet }
}
