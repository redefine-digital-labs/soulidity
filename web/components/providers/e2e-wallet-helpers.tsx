'use client'

import { useEffect, useRef } from 'react'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { selectCoinObjectIdsForAmountAcrossPages } from '@/lib/soulidity/coin-selection'
import {
  buildPurchaseContentAccessTx,
  buildSetContentAccessDurationTx,
  buildSetContentAccessPriceTx,
} from '@/lib/soulidity/tx/content-access'
import { buildSetGrantCapacityTx } from '@/lib/soulidity/tx/grant'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
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
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const signAndExecuteRef = useRef(signAndExecute)
  const suiClientRef = useRef(suiClient)
  const walletAddressRef = useRef<string | null>(suiWallet?.address ?? null)

  getAuthHeadersRef.current = getAuthHeaders
  signAndExecuteRef.current = signAndExecute
  suiClientRef.current = suiClient
  walletAddressRef.current = suiWallet?.address ?? null

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    const helpers = {
      getWalletAddress: () => walletAddressRef.current,
      getAuthHeaders: () => getAuthHeadersRef.current(),
      selectPaymentCoins: async (params: { totalAtomic: string | number | bigint; coinType?: string }) => {
        const owner = walletAddressRef.current
        if (!owner) throw new Error('No Sui wallet found in Privy account')
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
      purchaseContentAccess: async (params: E2EContentAccessPurchaseParams) => {
        const owner = walletAddressRef.current
        if (!owner) throw new Error('No Sui wallet found in Privy account')
        const totalAtomic = resolveTotalAtomic(params)
        const paymentCoinObjectIds = params.paymentCoinObjectIds?.length
          ? params.paymentCoinObjectIds
          : await helpers.selectPaymentCoins({ totalAtomic, coinType: params.coinType })
        const tx = buildPurchaseContentAccessTx({
          accessListOnChainId: params.accessListOnChainId,
          stateOnChainId: params.stateOnChainId,
          paymentCoinObjectIds,
          totalAtomic,
        })
        const result = await signAndExecuteRef.current(tx)
        const authHeaders = await getAuthHeadersRef.current()
        const syncRes = await fetch(`/api/souls/${encodeURIComponent(params.soulObjectId)}/access-list/purchase`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: result.digest }),
        })
        const syncBody = await syncRes.json().catch(() => null)
        if (!syncRes.ok) {
          throw new Error(syncBody?.error || `Content access purchase sync failed: ${syncRes.status}`)
        }
        return { digest: result.digest, sync: syncBody, effects: result.effects, events: result.events }
      },
      setContentAccessPrice: async (params: E2EContentAccessOwnerParams & { newPriceAtomic: number }) => {
        const tx = buildSetContentAccessPriceTx(params)
        const result = await signAndExecuteRef.current(tx)
        return { digest: result.digest, effects: result.effects, events: result.events }
      },
      setContentAccessDuration: async (params: E2EContentAccessOwnerParams & { newDurationMs?: number | null }) => {
        const tx = buildSetContentAccessDurationTx(params)
        const result = await signAndExecuteRef.current(tx)
        return { digest: result.digest, effects: result.effects, events: result.events }
      },
      setGrantCapacity: async (params: { stateObjectId: string; capacity: number }) => {
        const tx = buildSetGrantCapacityTx(params)
        const result = await signAndExecuteRef.current(tx)
        return { digest: result.digest, effects: result.effects, events: result.events }
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
