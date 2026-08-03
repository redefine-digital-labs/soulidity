'use client'

import { useState } from 'react'
import type { AnimacraftV6SecondaryContext, SoulAssetDetail } from '@soulidity/sdk'
import {
  assertPhysicalWardrobeV7Runtime,
  assertObjectInputsExist,
  fetchPhysicalWardrobeV7Snapshot,
  getAnimacraftAppearanceV6Id,
  getAnimacraftPhysicalProfileV7Id,
  getAnimacraftWardrobeV7Id,
  physicalWardrobeV7RuntimeFromPublicEnv,
} from '@soulidity/sdk'
import {
  buildListAnimacraftV5SoulTx,
  buildListAnimacraftV6SoulTx,
  buildListAnimacraftV7SoulTx,
  buildListSoulTx,
} from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

export type ListStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

type SoulWithV6SecondaryContext = SoulAssetDetail & {
  animacraftV6SecondaryContext?: AnimacraftV6SecondaryContext | null
}

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
      const appearanceV6Id = await getAnimacraftAppearanceV6Id(soul.stateOnChainId)
      const [wardrobeV7Id, physicalProfileV7Id] = await Promise.all([
        getAnimacraftWardrobeV7Id(soul.stateOnChainId),
        getAnimacraftPhysicalProfileV7Id(soul.stateOnChainId),
      ])
      if (Boolean(wardrobeV7Id) !== Boolean(physicalProfileV7Id)) {
        throw new Error('Physical Wardrobe v7 binding is incomplete; listing is blocked')
      }
      const physicalRuntime = physicalWardrobeV7RuntimeFromPublicEnv()
      const physicalSnapshot = wardrobeV7Id && physicalProfileV7Id
        ? await fetchPhysicalWardrobeV7Snapshot(
            suiClient as never,
            assertPhysicalWardrobeV7Runtime(physicalRuntime),
            {
              soulObjectId: soul.onChainId,
              soulStateObjectId: soul.stateOnChainId,
              walletAddress: suiWallet.address,
            },
          )
        : null
      if ((wardrobeV7Id || physicalProfileV7Id) && !physicalSnapshot) {
        throw new Error('Physical Wardrobe v7 could not be verified; listing is blocked')
      }
      if (physicalSnapshot?.wardrobe.externalAssetCount) {
        throw new Error('Move wallet-owned Styles out of this Soul before listing it')
      }
      const v6Context = (soul as SoulWithV6SecondaryContext).animacraftV6SecondaryContext ?? null
      if (appearanceV6Id && (!v6Context || v6Context.appearanceObjectId !== appearanceV6Id)) {
        throw new Error('Animacraft v6 appearance is bound, but its verified Maker loadout context is unavailable; listing is blocked')
      }
      if (
        !physicalSnapshot
        &&
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
        'Animacraft v6 appearance': appearanceV6Id,
        'Animacraft v6 composition registry': v6Context?.compositionRegistryObjectId ?? null,
        'Animacraft v6 composition config': v6Context?.compositionConfigObjectId ?? null,
        'Animacraft v6 commerce config': v6Context?.commerceConfigObjectId ?? null,
        'Animacraft v6 Maker profile': v6Context?.makerProfileObjectId ?? null,
        'Animacraft v6 Maker root': v6Context?.makerRootObjectId ?? null,
        'Animacraft v7 physical config': physicalSnapshot
          ? physicalRuntime.physicalProtocolConfigObjectId
          : null,
        'Animacraft v7 physical profile': physicalSnapshot?.maker.physicalProfileObjectId ?? null,
        'Animacraft v7 wardrobe': physicalSnapshot?.wardrobe.objectId ?? null,
      })

      const tx = physicalSnapshot
        ? buildListAnimacraftV7SoulTx({
            currentKioskId: soulKioskId,
            currentKioskCapOnChainId: soulKioskCapId,
            stateObjectId: soul.stateOnChainId,
            provenanceObjectId: soul.animacraftProvenance!.objectId,
            priceAtomic,
            v7: {
              physicalConfigObjectId: physicalRuntime.physicalProtocolConfigObjectId,
              physicalProfileObjectId: physicalSnapshot.maker.physicalProfileObjectId,
              wardrobeObjectId: physicalSnapshot.wardrobe.objectId,
              expectedWardrobeRevision: physicalSnapshot.wardrobe.revision,
            },
          })
        : appearanceV6Id
        ? buildListAnimacraftV6SoulTx({
            currentKioskId: soulKioskId,
            currentKioskCapOnChainId: soulKioskCapId,
            stateObjectId: soul.stateOnChainId,
            provenanceObjectId: soul.animacraftProvenance!.objectId,
            priceAtomic,
            v6: v6Context!,
          })
        : isAnimacraftV5
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
