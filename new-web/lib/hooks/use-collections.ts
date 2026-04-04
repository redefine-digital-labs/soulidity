'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CreateCollectionSyncResult } from '@/lib/collections/create-form-state'
import type { CollectionsListResponse, SoulCollectionAssetDetail } from '@/lib/soulidity/types'
import { buildBuyCollectionTx } from '@/lib/soulidity/tx/buy'
import { buildCreateCollectionTx } from '@/lib/soulidity/tx/collection'
import { buildListCollectionTx } from '@/lib/soulidity/tx/list'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'

export type CreateCollectionStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

function resolvePersonalKiosk(headers: Record<string, string>) {
  return fetch('/api/souls/personal-kiosk', { cache: 'no-store', headers })
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

export function useCollectionDetail(id: string) {
  return useQuery<SoulCollectionAssetDetail & {
    quote: {
      priceAtomic: string
      platformFeeAtomic: string
      totalAtomic: string
    } | null
  }>({
    queryKey: ['collection', id],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, { cache: 'no-store' })
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
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders } = useAuth()

  async function buyCollection() {
    if (!collection || !suiWallet || !collection.quote?.totalAtomic || !collection.listingObjectOnChainId) {
      throw new Error('Collection is not available for purchase')
    }

    setPending('purchase')
    setError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const personalKiosk = await resolvePersonalKiosk(authHeaders)
      const coinType = process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE ?? '0x0::usdc::USDC'
      const coins = await suiClient.getCoins({ owner: suiWallet.address, coinType })
      const requiredAtomic = BigInt(collection.quote.totalAtomic)
      const selectedCoinIds: string[] = []
      let accumulated = 0n
      for (const coin of coins.data) {
        selectedCoinIds.push(coin.coinObjectId)
        accumulated += BigInt(coin.balance)
        if (accumulated >= requiredAtomic) break
      }
      if (accumulated < requiredAtomic) {
        throw new Error('Insufficient payment balance')
      }

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
      const personalKiosk = await resolvePersonalKiosk(authHeaders)
      if (!personalKiosk) {
        throw new Error('Initialize your personal kiosk before listing a collection')
      }
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
      const personalKiosk = await resolvePersonalKiosk(authHeaders)
      const tx = buildCreateCollectionTx({
        currentKioskId: personalKiosk?.currentKioskId ?? null,
        currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
        ...params,
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
