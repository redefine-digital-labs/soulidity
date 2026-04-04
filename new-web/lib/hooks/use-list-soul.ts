'use client'

import { useState } from 'react'
import type { SoulAssetDetail } from '@/lib/soulidity/types'
import { buildListSoulTx } from '@/lib/soulidity/tx/list'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'

export type ListStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export function useListSoul(soul: SoulAssetDetail | null) {
  const [status, setStatus] = useState<ListStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const { suiWallet, signAndExecute } = usePrivySuiSign()
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
      setError('Price must be greater than zero')
      setStatus('error')
      return
    }

    try {
      setStatus('building')
      setError(null)
      const authHeaders = await getAuthHeaders()
      const kioskRes = await fetch('/api/souls/personal-kiosk', { cache: 'no-store', headers: authHeaders })
      if (!kioskRes.ok) {
        const body = await kioskRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to resolve personal kiosk')
      }
      const kiosk = await kioskRes.json()

      const tx = buildListSoulTx({
        currentKioskId: kiosk.currentKioskId,
        currentKioskCapOnChainId: kiosk.currentKioskCapOnChainId,
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
