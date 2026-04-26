'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CreateCollectionSyncResult } from '@/lib/collections/create-form-state'
import type { CollectionDetailResponse, CollectionsListResponse, SoulCollectionAssetDetail } from '@/lib/soulidity/types'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildBuyCollectionTx } from '@/lib/soulidity/tx/buy'
import { buildCreateCollectionTx } from '@/lib/soulidity/tx/collection'
import { buildListCollectionTx } from '@/lib/soulidity/tx/list'
import { buildDelistCollectionTx } from '@/lib/soulidity/tx/delist'
import { buildUpdateCollectionListingPriceTx } from '@/lib/soulidity/tx/update-collection-price'
import { selectCoinObjectIdsForAmountAcrossPages } from '@/lib/soulidity/coin-selection'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

export type CreateCollectionStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

function resolvePersonalKiosk(headers: Record<string, string>, walletAddress?: string | null) {
  const url = walletAddress
    ? `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`
    : '/api/souls/personal-kiosk'
  return fetch(url, { cache: 'no-store', headers })
    .then(async (res) => {
      if (res.status === 404) return null
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to resolve personal kiosk')
      }
      return res.json()
    })
}

export function useCollectionsList(params: { page?: number; q?: string; listed?: boolean } = {}) {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set('page', String(params.page))
  if (params.q) searchParams.set('q', params.q)
  if (params.listed === false) searchParams.set('listed', 'false')

  return useQuery<CollectionsListResponse>({
    queryKey: ['collections', params],
    queryFn: async () => {
      const res = await fetch(`/api/collections?${searchParams}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch collections')
      return res.json()
    },
  })
}

export function useCollectionDetail(id: string, getAuthHeaders?: () => Promise<Record<string, string>>, viewerId?: string | null) {
  return useQuery<CollectionDetailResponse>({
    queryKey: ['collection', id, viewerId ?? null],
    queryFn: async () => {
      const headers = getAuthHeaders ? await getAuthHeaders() : undefined
      const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, { cache: 'no-store', headers })
      if (!res.ok) throw new Error('Failed to fetch collection')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useCollectionActions(collection: (SoulCollectionAssetDetail & {
  quote: {
    priceAtomic: string
    platformFeeAtomic: string
    totalAtomic: string
  } | null
}) | null) {
  const [pending, setPending] = useState<'purchase' | 'list' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createStatus, setCreateStatus] = useState<CreateCollectionStatus>('idle')
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()

  async function buyCollection() {
    if (!collection || !suiWallet || !collection.quote?.totalAtomic || !collection.listingObjectOnChainId) {
      throw new Error('Collection is not available for purchase')
    }

    setPending('purchase')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      const coinType = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')
      const requiredAtomic = BigInt(collection.quote.totalAtomic)
      const selectedCoinIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
        owner: suiWallet.address,
        coinType,
        requiredAmount: requiredAtomic,
      })
      if (!selectedCoinIds || selectedCoinIds.length === 0) {
        throw new Error('Insufficient payment balance')
      }
      await assertObjectInputsExist(suiClient, {
        'Seller kiosk': collection.currentHolderKioskId,
        Collection: collection.onChainId,
        'Collection listing': collection.listingObjectOnChainId,
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
      })

      const tx = buildBuyCollectionTx({
        sellerKioskId: collection.currentHolderKioskId,
        collectionObjectId: collection.onChainId,
        listingObjectId: collection.listingObjectOnChainId,
        totalAtomic: requiredAtomic,
        paymentCoinObjectIds: selectedCoinIds,
        buyerKioskId: personalKiosk?.currentKioskId ?? null,
        buyerKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
      })
      const result = await signAndExecute(tx)
      const res = await fetch(`/api/collections/${encodeURIComponent(collection.onChainId)}/purchase`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror collection purchase')
      }
      return res.json()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Collection purchase failed')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function listCollection(priceAtomic: bigint) {
    if (!collection || !suiWallet) {
      throw new Error('Sign in and load the collection before listing')
    }

    setPending('list')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      if (!personalKiosk) {
        throw new Error('Initialize your personal kiosk before listing a collection')
      }
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': personalKiosk.currentKioskId,
        'Your personal kiosk capability': personalKiosk.currentKioskCapOnChainId,
        Collection: collection.onChainId,
        'Collection right': collection.rightOnChainId,
      })
      const tx = buildListCollectionTx({
        currentKioskId: personalKiosk.currentKioskId,
        currentKioskCapOnChainId: personalKiosk.currentKioskCapOnChainId,
        collectionObjectId: collection.onChainId,
        rightObjectId: collection.rightOnChainId,
        priceAtomic,
      })
      const result = await signAndExecute(tx)
      const res = await fetch(`/api/collections/${encodeURIComponent(collection.onChainId)}/list`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'list' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror collection listing')
      }
      return res.json()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Collection listing failed')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function createCollection(params: {
    name: string
    description: string
    imageUrl: string
    imageFile?: File | null
    extraRoyaltyBps: number
    tradeable: boolean
  }): Promise<CreateCollectionSyncResult> {
    if (!suiWallet) {
      const nextError = new Error('Sign in before creating a collection')
      setError(nextError.message)
      setCreateStatus('error')
      throw nextError
    }

    setPending('create')
    setCreateStatus('building')
    setError(null)
    setTxDigest(null)
    try {
      const authHeaders = await getAuthHeaders()

      // Upload image to Walrus during the building phase (before TX / gas)
      let resolvedImageUrl = params.imageUrl
      if (params.imageFile) {
        const formData = new FormData()
        formData.append('file', params.imageFile)
        const uploadRes = await fetch('/api/collections/upload-image', {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        })
        if (!uploadRes.ok) {
          const uploadBody = await uploadRes.json().catch(() => ({}))
          throw new Error(uploadBody.error || 'Cover image upload failed')
        }
        const uploadResult = await uploadRes.json()
        resolvedImageUrl = uploadResult.imageUrl
      }

      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
      })
      const tx = buildCreateCollectionTx({
        currentKioskId: personalKiosk?.currentKioskId ?? null,
        currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
        name: params.name,
        description: params.description,
        imageUrl: resolvedImageUrl,
        extraRoyaltyBps: params.extraRoyaltyBps,
        tradeable: params.tradeable,
      })
      setCreateStatus('signing')
      const result = await signAndExecute(tx)
      setTxDigest(result.digest)
      setCreateStatus('syncing')
      const res = await fetch('/api/collections/create', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror collection creation')
      }
      setCreateStatus('done')
      return res.json()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Collection creation failed')
      setCreateStatus('error')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  return { pending, error, createStatus, txDigest, buyCollection, listCollection, createCollection }
}

/* ------------------------------------------------------------------ */
/*  Lightweight listing hook — works with SoulCollectionAssetSummary   */
/* ------------------------------------------------------------------ */

export type CollectionListingStatus = 'idle' | 'signing' | 'syncing'

export function useCollectionListing(collection: { onChainId: string; rightOnChainId: string; listingObjectOnChainId: string | null } | null) {
  const [status, setStatus] = useState<CollectionListingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()

  async function list(priceAtomic: bigint) {
    if (!collection) throw new Error('No collection provided')
    setStatus('signing')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const kiosk = await resolvePersonalKiosk(authHeaders, suiWallet?.address)
      if (!kiosk) throw new Error('Initialize your personal kiosk before listing')
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': kiosk.currentKioskId,
        'Your personal kiosk capability': kiosk.currentKioskCapOnChainId,
        Collection: collection.onChainId,
        'Collection right': collection.rightOnChainId,
      })
      const tx = buildListCollectionTx({
        currentKioskId: kiosk.currentKioskId,
        currentKioskCapOnChainId: kiosk.currentKioskCapOnChainId,
        collectionObjectId: collection.onChainId,
        rightObjectId: collection.rightOnChainId,
        priceAtomic,
      })
      const result = await signAndExecute(tx)
      setStatus('syncing')
      const res = await fetch(`/api/collections/${encodeURIComponent(collection.onChainId)}/list`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'list' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror collection listing')
      }
      return res.json()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Collection listing failed'
      setError(msg)
      throw e
    } finally {
      setStatus('idle')
    }
  }

  async function delist() {
    if (!collection?.listingObjectOnChainId) throw new Error('Collection is not listed')
    setStatus('signing')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const kiosk = await resolvePersonalKiosk(authHeaders, suiWallet?.address)
      if (!kiosk) throw new Error('Personal kiosk not found')
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': kiosk.currentKioskId,
        'Your personal kiosk capability': kiosk.currentKioskCapOnChainId,
        'Collection listing': collection.listingObjectOnChainId,
      })
      const tx = buildDelistCollectionTx({
        currentKioskId: kiosk.currentKioskId,
        currentKioskCapOnChainId: kiosk.currentKioskCapOnChainId,
        listingObjectId: collection.listingObjectOnChainId,
      })
      const result = await signAndExecute(tx)
      setStatus('syncing')
      const res = await fetch(`/api/collections/${encodeURIComponent(collection.onChainId)}/list`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'delist' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror collection delist')
      }
      return res.json()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Collection delist failed'
      setError(msg)
      throw e
    } finally {
      setStatus('idle')
    }
  }

  async function updatePrice(newPriceAtomic: bigint) {
    if (!collection?.listingObjectOnChainId) throw new Error('Collection is not listed')
    setStatus('signing')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const kiosk = await resolvePersonalKiosk(authHeaders, suiWallet?.address)
      if (!kiosk) throw new Error('Personal kiosk not found')
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': kiosk.currentKioskId,
        'Your personal kiosk capability': kiosk.currentKioskCapOnChainId,
        Collection: collection.onChainId,
        'Collection right': collection.rightOnChainId,
        'Collection listing': collection.listingObjectOnChainId,
      })
      const tx = buildUpdateCollectionListingPriceTx({
        currentKioskId: kiosk.currentKioskId,
        currentKioskCapOnChainId: kiosk.currentKioskCapOnChainId,
        collectionObjectId: collection.onChainId,
        rightObjectId: collection.rightOnChainId,
        listingObjectId: collection.listingObjectOnChainId,
        newPriceAtomic,
      })
      const result = await signAndExecute(tx)
      setStatus('syncing')
      const res = await fetch(`/api/collections/${encodeURIComponent(collection.onChainId)}/list`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'list' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror collection price update')
      }
      return res.json()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Collection price update failed'
      setError(msg)
      throw e
    } finally {
      setStatus('idle')
    }
  }

  return { status, error, list, delist, updatePrice }
}
