'use client'

import { useEffect, useRef } from 'react'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { selectCoinObjectIdsForAmountAcrossPages } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'

declare global {
  interface Window {
    __e2eSoulidity?: {
      getWalletAddress: () => string | null
      getAuthHeaders: () => Promise<Record<string, string>>
      selectPaymentCoins: (params: { totalAtomic: string | number | bigint; coinType?: string }) => Promise<string[]>
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

export function E2EWalletHelpers() {
  const { getAuthHeaders } = useAuth()
  const { suiWallet, suiClient } = useWalletSign()
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const suiClientRef = useRef(suiClient)
  const walletAddressRef = useRef<string | null>(suiWallet?.address ?? null)

  useEffect(() => {
    getAuthHeadersRef.current = getAuthHeaders
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
