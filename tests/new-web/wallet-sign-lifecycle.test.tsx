// @vitest-environment jsdom
import React, { act, startTransition, Suspense, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Transaction } from '@mysten/sui/transactions'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useWalletSign } from '../../web/lib/hooks/use-wallet-sign'

const h = vi.hoisted(() => ({ account: null as { address: string } | null, wallet: {} as object,
  client: {} as any, sign: vi.fn(), personal: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account,
  useCurrentWallet: () => ({ currentWallet: h.wallet }), useSuiClient: () => h.client,
  useSignTransaction: () => ({ mutateAsync: h.sign }), useSignPersonalMessage: () => ({ mutateAsync: h.personal }) }))

let root: Root, host: HTMLDivElement, current: ReturnType<typeof useWalletSign>
const never = new Promise<void>(() => {})
function Probe({ suspend = false, onCommit }: { suspend?: boolean; onCommit?: () => void }) {
  const value = useWalletSign()
  useLayoutEffect(() => { current = value; onCommit?.() })
  if (suspend) throw never
  return <span>{value.suiWallet?.address}</span>
}
const view = (suspend = false, onCommit?: () => void) => <Suspense fallback="loading"><Probe suspend={suspend} onCommit={onCommit} /></Suspense>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  h.account = { address: '0x' + '11'.repeat(32) }; h.wallet = {}
  h.client = { grpc: {}, executeTransactionBlock: vi.fn(), waitForTransaction: vi.fn() }
  h.sign.mockReset().mockResolvedValue({ bytes: 'bytes', signature: 'signature' })
  h.personal.mockReset().mockResolvedValue({ signature: 'personal' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('does not expose an uncommitted wallet or revoke the committed signer for a suspended render', async () => {
  await act(async () => root.render(view()))
  const original = current, account = h.account, wallet = h.wallet
  h.account = { address: '0x' + '22'.repeat(32) }; h.wallet = {}
  await act(async () => { startTransition(() => root.render(view(true))) })
  expect(host.textContent).toBe(account!.address)
  expect(original.getWalletAddress()).toBe(account!.address)
  await expect(original.signTransaction(new Transaction())).resolves.toEqual({ bytes: 'bytes', signature: 'signature' })
  expect(h.sign).toHaveBeenCalledWith(expect.objectContaining({ account }))
  h.account = account; h.wallet = wallet
  await act(async () => root.render(view()))
  expect(current.walletAccount).toBe(account); expect(current.currentWallet).toBe(wallet)
})

it('revokes old transaction and message callbacks by the replacement layout commit, including same-address wallets', async () => {
  await act(async () => root.render(view()))
  const original = current
  h.wallet = {}
  let checks!: Promise<unknown>
  await act(async () => root.render(view(false, () => {
    checks = Promise.all([
      expect(original.signTransaction(new Transaction())).rejects.toThrow('session changed'),
      expect(original.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow('session changed'),
    ])
  })))
  await checks
  expect(h.sign).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  await expect(current.signTransaction(new Transaction())).resolves.toMatchObject({ signature: 'signature' })
})

it('never broadcasts a late signature after its wallet activation has been revoked', async () => {
  let finish!: (value: { bytes: string; signature: string }) => void
  h.sign.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(view()))
  const pending = current.signAndExecute(new Transaction())
  const rejected = expect(pending).rejects.toThrow('session changed')
  h.wallet = {}; await act(async () => root.render(view()))
  finish({ bytes: 'late-bytes', signature: 'late-signature' }); await rejected
  expect(h.client.executeTransactionBlock).not.toHaveBeenCalled()
})

it('clears the live address and rejects stale signing after unmount', async () => {
  await act(async () => root.render(view()))
  const original = current
  await act(async () => root.render(null))
  expect(original.getWalletAddress()).toBeNull()
  await expect(original.signTransaction(new Transaction())).rejects.toThrow('session changed')
  expect(h.sign).not.toHaveBeenCalled()
})
