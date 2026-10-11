// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

import {
  minimumSuiBalanceForWalletTransactions,
  useWalletBalances,
} from '../../web/lib/hooks/use-wallet-balances'

const mockedGetBalance = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  getBalance: mockedGetBalance,
}))

vi.mock('@mysten/dapp-kit', () => ({
  useSuiClient: () => mockedSuiClient,
}))

interface BalanceSnapshot {
  sui: bigint | null
  loading: boolean
  refresh: () => Promise<void>
}

function flushPromises() {
  return Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createHookHarness(useWalletBalances: typeof import('../../web/lib/hooks/use-wallet-balances').useWalletBalances) {
  return function HookHarness(props: {
    walletAddress: string | null
    snapshotRef: { current: BalanceSnapshot | null }
  }) {
    const balances = useWalletBalances(props.walletAddress)

    props.snapshotRef.current = {
      sui: balances.sui,
      loading: balances.loading,
      refresh: balances.refresh,
    }

    return null
  }
}

describe('useWalletBalances', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockedGetBalance.mockReset()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('sizes the minimum SUI floor from the wallet transaction count plus margin', () => {
    expect(minimumSuiBalanceForWalletTransactions(2)).toBe(40_000_000n)
    expect(minimumSuiBalanceForWalletTransactions(7)).toBe(115_000_000n)
    expect(() => minimumSuiBalanceForWalletTransactions(0)).toThrow('wallet transaction count')
  })

  it('does not reuse stale balances when the same address reconnects after disconnect', async () => {
    const HookHarness = createHookHarness(useWalletBalances)
    const firstBalance = createDeferred<{ totalBalance: string }>()
    const secondBalance = createDeferred<{ totalBalance: string }>()
    const snapshotRef = { current: null as BalanceSnapshot | null }
    let balanceRequestCount = 0

    mockedGetBalance.mockImplementation(() => {
      balanceRequestCount += 1
      return balanceRequestCount === 1 ? firstBalance.promise : secondBalance.promise
    })

    await act(async () => {
      root.render(<HookHarness walletAddress="0xabc" snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({ sui: null, loading: true }))

    await act(async () => {
      firstBalance.resolve({ totalBalance: '1000000000' })
      await firstBalance.promise
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({ sui: 1000000000n, loading: false }))

    await act(async () => {
      root.render(<HookHarness walletAddress={null} snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({ sui: null, loading: false }))

    await act(async () => {
      await flushPromises()
    })

    await act(async () => {
      root.render(<HookHarness walletAddress="0xabc" snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({ sui: null, loading: true }))

    await act(async () => {
      secondBalance.resolve({ totalBalance: '2000000000' })
      await secondBalance.promise
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({ sui: 2000000000n, loading: false }))
  })

  it('ignores a stale manual refresh result after the wallet switches', async () => {
    const HookHarness = createHookHarness(useWalletBalances)
    const initialBalance = createDeferred<{ totalBalance: string }>()
    const staleRefreshBalance = createDeferred<{ totalBalance: string }>()
    const nextWalletBalance = createDeferred<{ totalBalance: string }>()
    const snapshotRef = { current: null as BalanceSnapshot | null }
    let balanceRequestCount = 0

    mockedGetBalance.mockImplementation(() => {
      balanceRequestCount += 1
      if (balanceRequestCount === 1) return initialBalance.promise
      if (balanceRequestCount === 2) return staleRefreshBalance.promise
      return nextWalletBalance.promise
    })

    await act(async () => {
      root.render(<HookHarness walletAddress="0xaaa" snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    await act(async () => {
      initialBalance.resolve({ totalBalance: '1000000000' })
      await initialBalance.promise
      await flushPromises()
    })

    expect(snapshotRef.current?.sui).toBe(1000000000n)
    expect(snapshotRef.current?.loading).toBe(false)

    let refreshPromise: Promise<void> | undefined
    await act(async () => {
      refreshPromise = snapshotRef.current?.refresh()
      await flushPromises()
    })

    await act(async () => {
      root.render(<HookHarness walletAddress="0xbbb" snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({
      sui: null,
      loading: true,
    }))

    await act(async () => {
      nextWalletBalance.resolve({ totalBalance: '2000000000' })
      await nextWalletBalance.promise
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({
      sui: 2000000000n,
      loading: false,
    }))

    await act(async () => {
      staleRefreshBalance.resolve({ totalBalance: '1500000000' })
      await staleRefreshBalance.promise
      await refreshPromise
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual(expect.objectContaining({
      sui: 2000000000n,
      loading: false,
    }))
  })
})
