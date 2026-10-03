'use client'

import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

import { useState } from 'react'
import { assertObjectInputsExist, buildListSoulTx } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { useNativeMarketListActions } from '@/lib/hooks/use-native-market-list-actions'

export type ListStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'recovering' | 'done' | 'superseded' | 'unknown' | 'retired' | 'error'

function useOrdinaryListSoul(soul: ChainSoulDetail | null) {
  const [status, setStatus] = useState<ListStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()
  async function listSoul(priceAtomic: bigint) {
    if (!soul || soul.provenanceKind === 'animacraft') return
    if (!suiWallet) { setError('Please sign in first'); setStatus('error'); return }
    if (priceAtomic <= 0n) { setError('Price must be greater than 0'); setStatus('error'); return }
    if (soul.collection?.floorPriceAtomic && priceAtomic < BigInt(soul.collection.floorPriceAtomic)) {
      setError('Listing price is below the collection floor price'); setStatus('error'); return
    }
    try {
      setStatus('building'); setError(null)
      const authHeaders = await getAuthHeaders()
      const soulKioskId = soul.currentKioskId, soulKioskCapId = soul.currentKioskCapOnChainId
      if (!soulKioskId || !soulKioskCapId) throw new Error('Soul kiosk info is missing')
      await assertObjectInputsExist(suiClient, {
        'Soul kiosk': soulKioskId, 'Soul kiosk capability': soulKioskCapId,
        'Soul state': soul.stateOnChainId, Soul: soul.onChainId, Collection: soul.collectionOnChainId,
      })
      const tx = buildListSoulTx({ currentKioskId: soulKioskId, currentKioskCapOnChainId: soulKioskCapId,
        stateObjectId: soul.stateOnChainId, priceAtomic, collectionObjectId: soul.collectionOnChainId })
      setStatus('signing')
      const result = await signAndExecute(tx); setTxDigest(result.digest); setStatus('syncing')
      const response = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/list`, {
        method:'POST', headers:{...authHeaders,'Content-Type':'application/json'}, body:JSON.stringify({txDigest:result.digest}),
      })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Failed to mirror listing') }
      setStatus('done')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Listing failed'); setStatus('error') }
  }
  return { status, error, txDigest, listSoul, suiWallet }
}

/** A restored journal is not a new confirmation, and never authorizes a new signature. */
export function nativeListingStatus(native: Pick<ReturnType<typeof useNativeMarketListActions>,
  'record'|'confirmedResult'|'busy'|'pending'|'error'>): ListStatus {
  const record = native.record, confirmed = native.confirmedResult
  if (native.busy) return record?.phase === 'SIGNING' ? 'signing' : record?.phase === 'SUCCEEDED' ? 'syncing' : record ? 'recovering' : 'building'
  if (confirmed?.phase === 'SUCCEEDED' && confirmed.digest === record?.digest) {
    return confirmed.syncStatus === 'COMPLETE' ? 'done' : confirmed.syncStatus === 'SUPERSEDED' ? 'superseded' : 'unknown'
  }
  if (record?.phase === 'RETIRED') return 'retired'
  if (native.pending || record?.phase === 'SUCCEEDED') return 'unknown'
  return native.error ? 'error' : 'idle'
}

export function useListSoul(soul: ChainSoulDetail | null) {
  const isNative = soul?.provenanceKind === 'animacraft'
  const ordinary = useOrdinaryListSoul(isNative ? null : soul)
  const native = useNativeMarketListActions(isNative && soul
    ? {soulId:soul.onChainId,stateId:soul.stateOnChainId,listingId:soul.listingObjectOnChainId ?? null} : null)
  if (!isNative) return {...ordinary,native:null}
  return {status:nativeListingStatus(native),error:native.error,txDigest:native.record?.digest ?? null,
    listSoul:(priceAtomic:bigint) => native.start(priceAtomic,'list'),suiWallet:native.wallet,native}
}
