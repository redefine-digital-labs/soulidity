'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'

export const SUI_COIN_TYPE = '0x2::sui::SUI'
export const WALLET_TX_GAS_BUDGET_MIST = 15_000_000n
export const WALLET_FLOW_GAS_MARGIN_MIST = 10_000_000n

export function minimumSuiBalanceForWalletTransactions(walletTransactionCount: number): bigint {
  if (!Number.isSafeInteger(walletTransactionCount) || walletTransactionCount < 1) {
    throw new Error('wallet transaction count must be a positive safe integer')
  }
  return BigInt(walletTransactionCount) * WALLET_TX_GAS_BUDGET_MIST + WALLET_FLOW_GAS_MARGIN_MIST
}

// Minimum SUI balance required for gas across the 2-tx deploy flow (PTB1 register + PTB2 mint+certify)
export const MIN_SUI_BALANCE = minimumSuiBalanceForWalletTransactions(2) // 0.04 SUI (9 decimals)

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
  const requestVersionRef = useRef(0)

  const commitBalanceState = useCallback((
    requestVersion: number,
    nextWalletAddress: string | null,
    nextSui: bigint | null,
  ) => {
    if (requestVersion !== requestVersionRef.current) {
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

  const isCurrentAddress = state.walletAddress === walletAddress

  return {
    sui: walletAddress && isCurrentAddress ? state.sui : null,
    loading: walletAddress ? !isCurrentAddress || state.loading : false,
    refresh,
  }
}
