'use client'

import { useEffect, useRef } from 'react'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { selectCoinObjectIdsForAmountAcrossPages } from '@/lib/soulidity/coin-selection'
import {
  buildConfigurePaidAccessKindTx,
  buildPurchasePaidAccessTx,
  buildUpdatePaidAccessKindTx,
} from '@/lib/soulidity/tx/paid-access'
import { buildSetGrantCapacityTx } from '@/lib/soulidity/tx/grant'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

type E2EContentAccessPurchaseParams = {
  soulObjectId: string
  accessListOnChainId: string
  stateOnChainId: string
  totalAtomic?: string | number | bigint
  priceAtomic?: string | number | bigint
  platformFeeBps?: number
  coinType?: string
  paymentCoinObjectIds?: string[]
}

type E2EContentAccessOwnerParams = {
  accessListOnChainId: string
  stateOnChainId: string
}

declare global {
  interface Window {
    __e2eSoulidity?: {
      getWalletAddress: () => string | null
      getAuthHeaders: () => Promise<Record<string, string>>
      selectPaymentCoins: (params: { totalAtomic: string | number | bigint; coinType?: string }) => Promise<string[]>
      purchaseContentAccess: (params: E2EContentAccessPurchaseParams) => Promise<unknown>
      setContentAccessPrice: (params: E2EContentAccessOwnerParams & { newPriceAtomic: number }) => Promise<unknown>
      setContentAccessDuration: (params: E2EContentAccessOwnerParams & { newDurationMs?: number | null }) => Promise<unknown>
      setGrantCapacity: (params: { stateObjectId: string; capacity: number }) => Promise<unknown>
    }
  }
}

function toAtomic(value: string | number | bigint, fieldName: string) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a non-negative safe integer`)
    }
    return BigInt(value)
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${fieldName} must be an integer string`)
  }
  return BigInt(value.trim())
}

function resolveTotalAtomic(params: E2EContentAccessPurchaseParams) {
  if (params.totalAtomic != null) {
    return toAtomic(params.totalAtomic, 'totalAtomic')
  }
  if (params.priceAtomic == null) {
    throw new Error('totalAtomic or priceAtomic is required')
  }
  const priceAtomic = toAtomic(params.priceAtomic, 'priceAtomic')
  const platformFeeBps = params.platformFeeBps ?? 250
  if (!Number.isSafeInteger(platformFeeBps) || platformFeeBps < 0) {
    throw new Error('platformFeeBps must be a non-negative safe integer')
  }
  return priceAtomic + (priceAtomic * BigInt(platformFeeBps)) / 10_000n
}

export function E2EWalletHelpers() {
  const { getAuthHeaders } = useAuth()
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const signAndExecuteRef = useRef(signAndExecute)
  const suiClientRef = useRef(suiClient)
  const walletAddressRef = useRef<string | null>(suiWallet?.address ?? null)

  useEffect(() => {
    getAuthHeadersRef.current = getAuthHeaders
    signAndExecuteRef.current = signAndExecute
    suiClientRef.current = suiClient
    walletAddressRef.current = suiWallet?.address ?? null
  })

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const helpers = {
      getWalletAddress: () => walletAddressRef.current,
      getAuthHeaders: () => getAuthHeadersRef.current(),
      selectPaymentCoins: async (params: { totalAtomic: string | number | bigint; coinType?: string }) => {
        const owner = walletAddressRef.current
        if (!owner) throw new Error('No Sui wallet found for the current account')
        const totalAtomic = toAtomic(params.totalAtomic, 'totalAtomic')
        const coinType = params.coinType ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')
        const selected = await selectCoinObjectIdsForAmountAcrossPages(suiClientRef.current, {
          owner,
          coinType,
          requiredAmount: totalAtomic,
        })
        if (!selected || selected.length === 0) {
          throw new Error(`Insufficient payment balance for ${totalAtomic.toString()} atomic units`)
        }
        return selected
      },
      // Phase 2: ContentAccessList → per-kind SoulPaidAccessList. The legacy
      // helpers below were the Phase-1 entry points; rewriting the e2e tests
      // around per-kind paid access is tracked as part of the Phase-2 test
      // suite refresh. Stub for now so the global hook still loads in dev.
      purchaseContentAccess: async () => {
        throw new Error('purchaseContentAccess: Phase 1 helper is gone — use buildPurchasePaidAccessTx with a kind argument')
      },
      setContentAccessPrice: async () => {
        throw new Error('setContentAccessPrice: Phase 1 helper is gone — use buildUpdatePaidAccessKindTx with a kind argument')
      },
      setContentAccessDuration: async () => {
        throw new Error('setContentAccessDuration: Phase 1 helper is gone — use buildUpdatePaidAccessKindTx with a kind argument')
      },
      setGrantCapacity: async (params: { stateObjectId: string; capacity: number }) => {
        const tx = buildSetGrantCapacityTx(params)
        const result = await signAndExecuteRef.current(tx)
        const authHeaders = await getAuthHeadersRef.current()
        const syncRes = await fetch(`/api/souls/${encodeURIComponent(params.stateObjectId)}/grant-capacity`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: result.digest }),
        })
        const syncBody = await syncRes.json().catch(() => null)
        if (!syncRes.ok) {
          throw new Error(syncBody?.error || `Grant capacity sync failed: ${syncRes.status}`)
        }
        return { digest: result.digest, sync: syncBody, effects: result.effects, events: result.events }
      },
    } satisfies NonNullable<Window['__e2eSoulidity']>

    window.__e2eSoulidity = helpers
    return () => {
      if (window.__e2eSoulidity === helpers) {
        delete window.__e2eSoulidity
      }
    }
  }, [])

  return null
}
