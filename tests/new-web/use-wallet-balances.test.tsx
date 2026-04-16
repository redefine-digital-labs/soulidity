// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

import { useWalletBalances } from '../../web/lib/hooks/use-wallet-balances'

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

    expect(snapshotRef.current).toEqual({ sui: null, loading: true })

    await act(async () => {
      firstBalance.resolve({ totalBalance: '1000000000' })
      await firstBalance.promise
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual({ sui: 1000000000n, loading: false })

    await act(async () => {
      root.render(<HookHarness walletAddress={null} snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual({ sui: null, loading: false })

    await act(async () => {
      await flushPromises()
    })

    await act(async () => {
      root.render(<HookHarness walletAddress="0xabc" snapshotRef={snapshotRef} />)
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual({ sui: null, loading: true })

    await act(async () => {
      secondBalance.resolve({ totalBalance: '2000000000' })
      await secondBalance.promise
      await flushPromises()
    })

    expect(snapshotRef.current).toEqual({ sui: 2000000000n, loading: false })
  })
})
