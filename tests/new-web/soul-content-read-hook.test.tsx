// @vitest-environment jsdom
import React, { act, startTransition, Suspense, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSoulContentRead } from '../../web/lib/hooks/use-soul-content-read'

const h = vi.hoisted(() => ({ account: {} as any, wallet: {} as any, client: {} as any, config: {} as any,
  seal: {} as any, configError: false, open: vi.fn(), personal: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignPersonalMessage: () => ({ mutateAsync: h.personal }) }))
vi.mock('../../web/lib/soulidity/browser-content-access', () => ({ getBrowserContentAccessConfig: () => {
  if (h.configError) throw new Error('Invalid config'); return h.config
} }))
vi.mock('../../web/lib/soulidity/browser-content-open', () => ({ getBrowserContentSealConfig: () => h.seal,
  openBrowserSoulContent: (...args: any[]) => h.open(...args) }))
let root: Root, host: HTMLDivElement, current: ReturnType<typeof useSoulContentRead>, soul: any, version: any
function Probe({ blocked = false }: { blocked?: boolean }) { current = useSoulContentRead(soul, blocked); return null }
async function render(blocked = false) { await act(async () => root.render(<Probe blocked={blocked} />)) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  h.account = { address: 'wallet' }; h.wallet = {}; h.client = { grpc: {} }; h.config = { release: 1 }; h.seal = { threshold: 1 }; h.configError = false
  soul = { originalPackageId: 'pkg', onChainId: 'soul', stateOnChainId: 'state', contentOnChainId: 'content', viewerAddress: 'wallet', stateVersion: '2' }
  version = { soulOnChainId: 'soul', contentOnChainId: 'content', kind: 2, name: 'skill', versionIndex: '9007199254740993' }
  h.open.mockReset().mockImplementation(async () => ({ bytes: new Uint8Array([1, 2]), fileName: 'asset.zip', mimeType: 'application/zip' }))
  h.personal.mockResolvedValue({ signature: 'personal' })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Owned API forbidden') }))
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('mount does not read, sign, require auth or fetch; explicit open uses exact live client/version', async () => {
  await render(); expect(h.open).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
  let result!: Uint8Array; await act(async () => { result = await current.decryptContentVersion(version) })
  expect(result).toEqual(new Uint8Array([1, 2])); expect(h.open).toHaveBeenCalledOnce()
  const p = h.open.mock.calls[0][0]
  expect(p.request).toEqual({ soulId: 'soul', stateId: 'state', contentId: 'content', kind: 2, name: 'skill',
    versionIndex: '9007199254740993', viewerAddress: 'wallet', config: h.config })
  expect(p.client).toBe(h.client.grpc); expect(p.sealClient).toBe(h.client); expect(p.getAddress()).toBe('wallet')
  expect(fetch).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
})
it.each(['wallet', 'same-address-account', 'client', 'address', 'release', 'seal', 'soul', 'state', 'epoch'])('rejects late bytes and invalidates memory identity on %s change', async mode => {
  await render(); const key = current.privacyKey; let resolve!: (result: any) => void
  h.open.mockImplementation(() => new Promise(r => { resolve = r }))
  let pending!: Promise<Uint8Array>; await act(async () => { pending = current.decryptContentVersion(version) })
  const p = h.open.mock.calls[0][0]
  if (mode === 'wallet') h.wallet = {}
  if (mode === 'same-address-account') h.account = { address: 'wallet' }
  if (mode === 'client') h.client = { grpc: {} }
  if (mode === 'address') h.account = { address: 'other' }
  if (mode === 'release') h.config = { release: 2 }
  if (mode === 'seal') h.seal = { threshold: 2 }
  if (mode === 'soul') soul = { ...soul, onChainId: 'other' }
  if (mode === 'state') soul = { ...soul, stateVersion: '3' }
  if (mode === 'epoch') soul = { ...soul, currentOwnershipEpoch: '4' }
  await render(); expect(current.privacyKey).not.toBe(key); expect(current.pending).toBe(false); expect(p.signal.aborted).toBe(true)
  expect(p.getAddress()).toBeNull(); await expect(p.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow()
  const bytes = new Uint8Array([9, 9]); const rejected = expect(pending).rejects.toThrow()
  await act(async () => { resolve({ bytes, fileName: 'private', mimeType: 'text/plain' }); await rejected })
  expect(bytes).toEqual(new Uint8Array(2)); expect(h.personal).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled()
})
it('requests personal approval for the captured account only and rejects a late signature', async () => {
  await render(); let resolve!: (v: any) => void
  h.open.mockImplementation(async (p: any) => {
    await p.signPersonalMessage(new Uint8Array([8])); return { bytes: new Uint8Array([1]), fileName: 'f', mimeType: 'text/plain' }
  })
  h.personal.mockImplementation(() => new Promise(r => { resolve = r }))
  let pending!: Promise<Uint8Array>; await act(async () => { pending = current.decryptContentVersion(version) })
  expect(h.personal).toHaveBeenCalledWith({ message: new Uint8Array([8]), account: h.account })
  h.wallet = {}; await render(); const rejected = expect(pending).rejects.toThrow()
  await act(async () => { resolve({ signature: 'late' }); await rejected }); expect(h.personal).toHaveBeenCalledOnce()
})
it('downloads only verified bytes, clears the buffer and releases the URL on wallet change', async () => {
  await render(); const bytes = new Uint8Array([7, 8])
  h.open.mockResolvedValue({ bytes, fileName: '../unsafe\n.zip', mimeType: 'application/zip' })
  await act(async () => current.openContentVersion(version))
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce(); expect(bytes).toEqual(new Uint8Array(2))
  expect(URL.createObjectURL).toHaveBeenCalledOnce(); h.wallet = {}; await render(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
})
it.each(['blocked', 'no-wallet', 'bad-config', 'wrong-slot'])('exposes %s without invoking the read service', async mode => {
  if (mode === 'no-wallet') h.account = null
  if (mode === 'bad-config') h.configError = true
  if (mode === 'wrong-slot') version.contentOnChainId = 'foreign'
  await render(mode === 'blocked')
  await act(async () => { await expect(current.decryptContentVersion(version)).rejects.toThrow() })
  expect(h.open).not.toHaveBeenCalled(); expect(h.personal).not.toHaveBeenCalled()
})
it('rejects overlapping read attempts and retains a visible failure for explicit retry', async () => {
  await render(); let reject!: (v: any) => void; h.open.mockImplementation(() => new Promise((_r, j) => { reject = j }))
  let pending!: Promise<Uint8Array>; await act(async () => { pending = current.decryptContentVersion(version) })
  expect(current.pending).toBe(true); await expect(current.openContentVersion(version)).rejects.toThrow('pending')
  const rejected = expect(pending).rejects.toThrow('Storage unavailable')
  await act(async () => { reject(new Error('Storage unavailable')); await rejected })
  expect(current.pending).toBe(false); expect(current.error).toBe('Storage unavailable')
  h.open.mockResolvedValue({ bytes: new Uint8Array([2]), fileName: 'f', mimeType: 'text/plain' })
  await act(async () => current.decryptContentVersion(version)); expect(current.error).toBeNull()
})

it('keeps a committed private read valid when a replacement render suspends and is abandoned', async () => {
  const never = new Promise<void>(() => {}), originalWallet = h.wallet
  let committed!: ReturnType<typeof useSoulContentRead>
  function ConcurrentProbe({ suspend = false }: { suspend?: boolean }) {
    const value = useSoulContentRead(soul, false)
    useLayoutEffect(() => { committed = value })
    if (suspend) throw never
    return <span>committed content</span>
  }
  const view = (suspend = false) => <Suspense fallback="loading"><ConcurrentProbe suspend={suspend} /></Suspense>
  await act(async () => root.render(view()))
  let finish!: (value: any) => void
  h.open.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let pending!: Promise<Uint8Array>
  await act(async () => { pending = committed.decryptContentVersion(version) })
  const operation = h.open.mock.calls[0][0]
  h.wallet = {}
  await act(async () => { startTransition(() => root.render(view(true))) })
  expect(host.textContent).toBe('committed content')
  expect(operation.signal.aborted).toBe(false)
  expect(operation.getAddress()).toBe('wallet')
  const bytes = new Uint8Array([5, 6])
  await act(async () => { finish({ bytes, fileName: 'private', mimeType: 'text/plain' }); expect(await pending).toBe(bytes) })
  h.wallet = originalWallet
  await act(async () => root.render(view()))
})

it('revokes a read signer before the replacement component layout subscribers run', async () => {
  let operation: any, finish!: (value: any) => void, pending!: Promise<Uint8Array>
  h.open.mockImplementation((value: any) => { operation = value; return new Promise(resolve => { finish = resolve }) })
  let committed!: ReturnType<typeof useSoulContentRead>, checked: Promise<unknown> | undefined
  function LayoutProbe({ check = false }: { check?: boolean }) {
    const value = useSoulContentRead(soul, false)
    useLayoutEffect(() => {
      committed = value
      if (check) {
        expect(operation.signal.aborted).toBe(true)
        expect(operation.getAddress()).toBeNull()
        checked = expect(operation.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow()
      }
    })
    return null
  }
  await act(async () => root.render(<LayoutProbe />))
  await act(async () => { pending = committed.decryptContentVersion(version) })
  h.wallet = {}; await act(async () => root.render(<LayoutProbe check />)); await checked
  const bytes = new Uint8Array([9]), rejected = expect(pending).rejects.toThrow()
  await act(async () => { finish({ bytes, fileName: 'private', mimeType: 'text/plain' }); await rejected })
  expect(bytes).toEqual(new Uint8Array(1)); expect(h.personal).not.toHaveBeenCalled()
})
