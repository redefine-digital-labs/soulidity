'use client'

import { useState } from 'react'
import type { SoulAssetDetail } from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { assertObjectInputsExist } from '@soulidity/sdk'
import { buildBuySoulTx } from '@soulidity/sdk'
import { buildBuyAnimacraftSoulTx } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

export type PurchaseStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

async function resolvePersonalKiosk(headers: Record<string, string>, walletAddress?: string | null) {
  const url = walletAddress
    ? `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`
    : '/api/souls/personal-kiosk'
  const res = await fetch(url, { cache: 'no-store', headers })
  if (!res.ok) {
    if (res.status === 404) return null
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to resolve personal kiosk')
  }
  return res.json()
}

export function usePurchase(soul: SoulAssetDetail | null) {
  const [status, setStatus] = useState<PurchaseStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()

  async function purchase() {
    if (!soul) {
      setError('Soul is not available')
      setStatus('error')
      return
    }
    if (!suiWallet) {
      setError('Please sign in to purchase')
      setStatus('error')
      return
    }
    if (!soul.quote?.totalAtomic || !soul.listingObjectOnChainId) {
      setError('Soul is not listed for purchase')
      setStatus('error')
      return
    }

    try {
      setStatus('building')
      setError(null)
      const authHeaders = await getAuthHeaders()
      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      const coinType = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')
      const coins = await suiClient.getCoins({ owner: suiWallet.address, coinType })
      const requiredAtomic = BigInt(soul.quote.totalAtomic)
      const selectedCoinIds: string[] = []
      let accumulated = 0n

      for (const coin of coins.data) {
        selectedCoinIds.push(coin.coinObjectId)
        accumulated += BigInt(coin.balance)
        if (accumulated >= requiredAtomic) {
          break
        }
      }

      if (accumulated < requiredAtomic) {
        throw new Error('Insufficient payment balance')
      }
      if (soul.provenanceKind === 'animacraft' && !soul.animacraftProvenance) {
        throw new Error('Animacraft provenance is unavailable; purchase is blocked')
      }
      await assertObjectInputsExist(suiClient, {
        'Seller kiosk': soul.currentKioskId,
        'Soul state': soul.stateOnChainId,
        'Soul listing': soul.listingObjectOnChainId,
        Collection: soul.collectionOnChainId,
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
        'Animacraft provenance': soul.animacraftProvenance?.objectId ?? null,
        'Animacraft Maker': soul.animacraftProvenance?.makerId ?? null,
        'Animacraft Maker treasury': soul.animacraftProvenance?.makerTreasuryId ?? null,
      })

      const sharedPurchaseParams = {
        sellerKioskId: soul.currentKioskId,
        stateObjectId: soul.stateOnChainId,
        listingObjectId: soul.listingObjectOnChainId,
        totalAtomic: requiredAtomic,
        paymentCoinObjectIds: selectedCoinIds,
        collectionObjectId: soul.collectionOnChainId,
        buyerKioskId: personalKiosk?.currentKioskId ?? null,
        buyerKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
      }
      const tx = soul.animacraftProvenance
        ? buildBuyAnimacraftSoulTx({
            ...sharedPurchaseParams,
            provenanceObjectId: soul.animacraftProvenance.objectId,
            makerObjectId: soul.animacraftProvenance.makerId,
            makerTreasuryObjectId: soul.animacraftProvenance.makerTreasuryId,
          })
        : buildBuySoulTx(sharedPurchaseParams)

      setStatus('signing')
      const result = await signAndExecute(tx)
      setTxDigest(result.digest)

      setStatus('syncing')
      const syncRes = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/purchase`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror purchase')
      }

      setStatus('done')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Purchase failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, purchase, suiWallet }
}
