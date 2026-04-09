'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'

export const SUI_COIN_TYPE = '0x2::sui::SUI'
// Minimum SUI balance required for gas (~0.02 SUI with margin)
export const MIN_SUI_BALANCE = 20_000_000n // 0.02 SUI (9 decimals)

export function formatBalance(atomicBalance: bigint, decimals: number): string {
  const whole = atomicBalance / 10n ** BigInt(decimals)
  const frac = atomicBalance % 10n ** BigInt(decimals)
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

export interface BalanceState {
  sui: bigint | null
  loading: boolean
}

export function useWalletBalances(walletAddress: string | null) {
  const suiClient = useSuiClient()
  const [state, setState] = useState<BalanceState>({ sui: null, loading: true })

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setState({ sui: null, loading: false })
      return
    }
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const suiRes = await suiClient.getBalance({ owner: walletAddress, coinType: SUI_COIN_TYPE })
      setState({
        sui: BigInt(suiRes.totalBalance),
        loading: false,
      })
    } catch {
      setState({ sui: null, loading: false })
    }
  }, [walletAddress, suiClient])

  useEffect(() => { refresh() }, [refresh])

  return { ...state, refresh }
}
