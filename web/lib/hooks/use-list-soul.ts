'use client'

import { useState } from 'react'
import type { SoulAssetDetail } from '@soulidity/sdk'
import { assertObjectInputsExist } from '@soulidity/sdk'
import { buildListAnimacraftV5SoulTx, buildListSoulTx } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

export type ListStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export function useListSoul(soul: SoulAssetDetail | null) {
  const [status, setStatus] = useState<ListStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
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
      if (soul.provenanceKind === 'animacraft' && !soul.animacraftProvenance) {
        throw new Error('Animacraft provenance is unavailable; listing is blocked')
      }
      const animacraftVersion = soul.animacraftProvenance?.animacraftVersion
      const isAnimacraftV5 = animacraftVersion === 5
      if (
        soul.provenanceKind === 'animacraft'
        && animacraftVersion !== 4
        && !isAnimacraftV5
      ) {
        throw new Error('This Animacraft provenance version is not supported for secondary listing')
      }
      if (isAnimacraftV5 && soul.collectionOnChainId) {
        throw new Error(
          'Animacraft v5 Souls cannot be listed while bound to a collection. '
          + 'No collection-removal transaction is available in this release.',
        )
      }
      await assertObjectInputsExist(suiClient, {
        'Soul kiosk': soulKioskId,
        'Soul kiosk capability': soulKioskCapId,
        'Soul state': soul.stateOnChainId,
        Soul: soul.onChainId,
        Collection: soul.collectionOnChainId,
        'Animacraft provenance': soul.animacraftProvenance?.objectId ?? null,
      })

      const tx = isAnimacraftV5
        ? buildListAnimacraftV5SoulTx({
            currentKioskId: soulKioskId,
            currentKioskCapOnChainId: soulKioskCapId,
            stateObjectId: soul.stateOnChainId,
            provenanceObjectId: soul.animacraftProvenance!.objectId,
            priceAtomic,
            makerSourceRoyaltyBps: soul.animacraftProvenance!.makerRoyaltyBps,
            frozenSoulCreatorRoyaltyBps: soul.creatorRoyaltyBps,
          })
        : buildListSoulTx({
            currentKioskId: soulKioskId,
            currentKioskCapOnChainId: soulKioskCapId,
            stateObjectId: soul.stateOnChainId,
            priceAtomic,
            collectionObjectId: soul.collectionOnChainId,
            animacraftProvenanceObjectId: soul.animacraftProvenance?.objectId,
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
