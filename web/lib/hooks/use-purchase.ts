'use client'

import type { ChainSoulDetail } from '@/lib/soulidity/soul-detail-model'

import { useState } from 'react'
import { assertObjectInputsExist, buildBuySoulTx, getRequiredSoulidityEnv } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { useNativeMarketBuyActions } from '@/lib/hooks/use-native-market-buy-actions'

export type PurchaseStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'recovering' | 'unknown' | 'retired' | 'superseded' | 'done' | 'error'

async function resolvePersonalKiosk(headers: Record<string, string>, walletAddress: string) {
  const res = await fetch('/api/souls/personal-kiosk?walletAddress=' + encodeURIComponent(walletAddress), { cache: 'no-store', headers })
  if (!res.ok) {
    if (res.status === 404) return null
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to resolve personal kiosk')
  }
  return res.json()
}

/** Ordinary Soul checkout retains its established builder. Native Maker Souls
 * use the single current native market, never a legacy provenance fallback. */
function useOrdinaryPurchase(soul: ChainSoulDetail | null) {
  const [status, setStatus] = useState<PurchaseStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()
  async function purchase() {
    if (!soul || soul.provenanceKind === 'animacraft' || !soul.purchaseAvailable || !suiWallet || !soul.quote?.totalAtomic || !soul.listingObjectOnChainId) {
      setError('Connect your wallet and refresh a listed Soul before purchasing'); setStatus('error'); return
    }
    try {
      setStatus('building'); setError(null)
      const requiredAtomic = BigInt(soul.quote.totalAtomic)
      const authHeaders = await getAuthHeaders()
      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      const coinType = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')
      const coins = await suiClient.getCoins({ owner: suiWallet.address, coinType })
      const selectedCoinIds: string[] = []; let accumulated = 0n
      for (const coin of coins.data) {
        selectedCoinIds.push(coin.coinObjectId); accumulated += BigInt(coin.balance)
        if (accumulated >= requiredAtomic) break
      }
      if (accumulated < requiredAtomic) throw new Error('Insufficient payment balance')
      await assertObjectInputsExist(suiClient, {
        'Seller kiosk': soul.currentKioskId, 'Soul state': soul.stateOnChainId,
        'Soul listing': soul.listingObjectOnChainId, Collection: soul.collectionOnChainId,
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
      })
      const tx = buildBuySoulTx({
        sellerKioskId: soul.currentKioskId, stateObjectId: soul.stateOnChainId,
        listingObjectId: soul.listingObjectOnChainId, totalAtomic: requiredAtomic,
        paymentCoinObjectIds: selectedCoinIds, collectionObjectId: soul.collectionOnChainId,
        buyerKioskId: personalKiosk?.currentKioskId ?? null,
        buyerKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
      })
      setStatus('signing')
      const result = await signAndExecute(tx); setTxDigest(result.digest); setStatus('syncing')
      const response = await fetch('/api/souls/' + encodeURIComponent(soul.onChainId) + '/purchase', {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Failed to mirror purchase')
      }
      setStatus('done')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Purchase failed'); setStatus('error') }
  }
  return { status, error, txDigest, purchase, suiWallet }
}

export function usePurchase(soul: ChainSoulDetail | null) {
  const isNative = soul?.provenanceKind === 'animacraft'
  const ordinary = useOrdinaryPurchase(isNative ? null : soul)
  const native = useNativeMarketBuyActions(isNative && soul
    ? { soulId: soul.onChainId, stateId: soul.stateOnChainId, listingId: soul.listingObjectOnChainId } : null)
  if (!isNative) return { ...ordinary, native: null }
  const status = nativePurchaseStatus(native)
  return { status, error: native.error, txDigest: native.record?.digest ?? null, purchase: native.start, suiWallet: native.wallet, native }
}

/** A prior successful buy is history, not proof of current ownership and not a
 * reason to hide checkout when the same buyer returns for a later resale. */
export function nativePurchaseStatus(native: Pick<ReturnType<typeof useNativeMarketBuyActions>,
  'record'|'confirmedResult'|'snapshot'|'busy'|'pending'|'error'>): PurchaseStatus {
  const record = native.record, confirmed = native.confirmedResult
  const newListing = Boolean(native.snapshot && native.snapshot.listingId !== record?.snapshot.listingId)
  return native.busy
    ? record?.phase === 'SUCCEEDED' ? 'syncing' : record?.phase === 'SIGNING' ? 'signing' : record?.phase === 'SIGNED' ? 'recovering' : 'building'
    : confirmed?.phase === 'SUCCEEDED' && confirmed.digest === record?.digest && !newListing
      ? confirmed.syncStatus === 'COMPLETE' ? 'done' : confirmed.syncStatus === 'SUPERSEDED' ? 'superseded' : 'unknown'
      : record?.phase === 'RETIRED' ? 'retired' : native.pending ? 'unknown' : native.error ? 'error' : 'idle'
}
