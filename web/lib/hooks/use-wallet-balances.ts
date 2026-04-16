'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  walletAddress: string | null
}

export function useWalletBalances(walletAddress: string | null) {
  const suiClient = useSuiClient()
  const [state, setState] = useState<BalanceState>({
    sui: null,
    loading: walletAddress !== null,
    walletAddress,
  })
  const previousWalletAddressRef = useRef(walletAddress)
  const currentWalletAddressRef = useRef(walletAddress)
  const requestVersionRef = useRef(0)
  currentWalletAddressRef.current = walletAddress

  const commitBalanceState = useCallback((
    requestVersion: number,
    nextWalletAddress: string | null,
    nextSui: bigint | null,
  ) => {
    if (
      requestVersion !== requestVersionRef.current
      || currentWalletAddressRef.current !== nextWalletAddress
    ) {
      return
    }

    setState({
      sui: nextSui,
      loading: false,
      walletAddress: nextWalletAddress,
    })
  }, [])

  const refresh = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    if (!walletAddress) {
      commitBalanceState(requestVersion, null, null)
      return
    }
    try {
      const suiRes = await suiClient.getBalance({ owner: walletAddress, coinType: SUI_COIN_TYPE })
      commitBalanceState(requestVersion, walletAddress, BigInt(suiRes.totalBalance))
    } catch {
      commitBalanceState(requestVersion, walletAddress, null)
    }
  }, [commitBalanceState, walletAddress, suiClient])

  useEffect(() => {
    let cancelled = false
    const requestVersion = ++requestVersionRef.current

    if (!walletAddress) {
      commitBalanceState(requestVersion, null, null)
      return () => {
        cancelled = true
      }
    }

    void suiClient
      .getBalance({ owner: walletAddress, coinType: SUI_COIN_TYPE })
      .then((suiRes) => {
        if (!cancelled) {
          commitBalanceState(requestVersion, walletAddress, BigInt(suiRes.totalBalance))
        }
      })
      .catch(() => {
        if (!cancelled) {
          commitBalanceState(requestVersion, walletAddress, null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [commitBalanceState, walletAddress, suiClient])

  const walletChanged = previousWalletAddressRef.current !== walletAddress
  useLayoutEffect(() => {
    previousWalletAddressRef.current = walletAddress
  }, [walletAddress])
  const isCurrentAddress = state.walletAddress === walletAddress

  return {
    sui: walletAddress && isCurrentAddress && !walletChanged ? state.sui : null,
    loading: walletAddress ? walletChanged || !isCurrentAddress || state.loading : false,
    refresh,
  }
}
