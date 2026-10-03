// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NativeProtectedArtwork } from '../../web/components/souls/native-protected-artwork'

const mocks = vi.hoisted(() => ({ account: null as null | { address: string }, decrypt: vi.fn(), sign: vi.fn(), client: { grpc: {} }, wallet: {},
  read: vi.fn(), config: { target: { release: 'one' }, aggregators: [] as [string, string][] }, configError: '' }))
vi.mock('../../web/lib/animacraft/browser-native-artwork', () => ({
  getBrowserNativeProtectedArtworkConfig: () => { if (mocks.configError) throw new Error(mocks.configError); return mocks.config },
  readBrowserNativeCompleteReadTarget: mocks.read,
}))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => mocks.account, useSuiClient: () => mocks.client,
  useCurrentWallet: () => ({ currentWallet: mocks.wallet }),
  useSignPersonalMessage: () => ({ mutateAsync: mocks.sign }) }))
vi.mock('../../web/lib/animacraft/native-complete-read-client', async importOriginal => ({
  ...await importOriginal<any>(), decryptNativeCompleteArtwork: mocks.decrypt,
}))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (value: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let root: Root | null; let host: HTMLDivElement
const createUrl = vi.fn(); const revokeUrl = vi.fn()
const ownedFetch = vi.fn()
beforeEach(() => {
  mocks.account = { address: id(3) }; mocks.client = { grpc: {} }; mocks.wallet = {}; mocks.decrypt.mockReset().mockResolvedValue(new Blob(['verified png']))
  mocks.sign.mockReset().mockResolvedValue({ signature: 'signature' })
  mocks.read.mockReset().mockResolvedValue({ schema: 'verified' }); mocks.config = { target: { release: 'one' }, aggregators: [] }; mocks.configError = ''
  ownedFetch.mockReset().mockRejectedValue(new Error('Owned API must not be called')); vi.stubGlobal('fetch', ownedFetch)
  createUrl.mockReset().mockReturnValue('blob:protected'); revokeUrl.mockReset()
  class TestURL extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl }
  vi.stubGlobal('URL', TestURL); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { if (root) await act(async () => root!.unmount()); expect(ownedFetch).not.toHaveBeenCalled(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
const mount = async (soulId = id(1), stateId = id(2)) => { await act(async () => root!.render(<NativeProtectedArtwork soulObjectId={soulId} stateObjectId={stateId} />)); await settle() }
const unlock = () => [...host.querySelectorAll('button')].find(b => /^(Unlock original artwork|Retry protected artwork)$/.test(b.textContent ?? ''))!
const click = async () => { await act(async () => unlock().click()); await settle() }
it('does not load or prompt until the owner explicitly requests protected read', async () => {
  await mount(); expect(mocks.decrypt).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
  expect(host.textContent).toContain('not a purchase or equipment transaction')
  await click(); expect(mocks.decrypt).toHaveBeenCalledTimes(1); expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:protected')
  const input = mocks.decrypt.mock.calls[0][0]
  expect(input.owner).toBe(id(3)); expect(input.getAddress()).toBeNull() // attempt no longer active
})
it('requires wallet connection without a hidden automatic prompt', async () => {
  mocks.account = null; await mount(); expect(unlock().disabled).toBe(true)
  await click(); expect(mocks.decrypt).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
})
it('prevents duplicate clicks and exposes cancel while approval is pending', async () => {
  const d = deferred<Blob>(); mocks.decrypt.mockReturnValue(d.promise)
  await mount(); await click(); await click(); expect(mocks.decrypt).toHaveBeenCalledTimes(1)
  expect(unlock().disabled).toBe(true)
  await act(async () => { mocks.decrypt.mock.calls[0][0].onPhase('authorizing') })
  expect(host.querySelector('[role=status]')?.textContent).toContain('wallet')
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancel read')!.click()); await settle()
  expect(mocks.decrypt.mock.calls[0][0].signal.aborted).toBe(true)
  expect(host.textContent).toContain('dismiss it before retrying'); expect(unlock().disabled).toBe(false)
  await act(async () => d.resolve(new Blob(['late']))); await settle(); expect(createUrl).not.toHaveBeenCalled()
})
it.each(['wallet', 'same-address-wallet', 'soul', 'state', 'release', 'services', 'client', 'unmount'])('cancels on %s change and ignores stale completion', async mode => {
  const d = deferred<Blob>(); mocks.decrypt.mockReturnValue(d.promise); await mount(); await click()
  const previous = mocks.decrypt.mock.calls[0][0]
  if (mode === 'wallet') { mocks.account = { address: id(99) }; await mount() }
  if (mode === 'soul') await mount(id(99))
  if (mode === 'state') await mount(id(1), id(99))
  if (mode === 'release') { mocks.config = { ...mocks.config, target: { release: 'two' } }; await mount() }
  if (mode === 'services') { mocks.config = { ...mocks.config, aggregators: [[id(90), 'https://keys.example/']] }; await mount() }
  if (mode === 'client') { mocks.client = { grpc: {} }; await mount() }
  if (mode === 'same-address-wallet') { mocks.wallet = {}; await mount() }
  if (mode === 'unmount') { await act(async () => root!.unmount()); root = null }
  expect(previous.signal.aborted).toBe(true); expect(previous.getAddress()).toBeNull()
  await expect(previous.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow()
  expect(mocks.sign).not.toHaveBeenCalled()
  await act(async () => d.resolve(new Blob(['late private result']))); await settle()
  expect(createUrl).not.toHaveBeenCalled(); expect(host.querySelector('img')).toBeNull()
})
it('revokes displayed private artwork when the wallet disconnects', async () => {
  await mount(); await click(); expect(host.querySelector('img')).not.toBeNull()
  mocks.account = null; await mount(); expect(host.querySelector('img')).toBeNull()
  expect(revokeUrl).toHaveBeenCalledWith('blob:protected')
})
it('StrictMode never restores revoked artwork after an A to B to A wallet round trip', async () => {
  const firstWallet = mocks.wallet
  const render = async () => {
    await act(async () => root!.render(<React.StrictMode><NativeProtectedArtwork soulObjectId={id(1)} stateObjectId={id(2)} /></React.StrictMode>))
    await settle()
  }
  await render(); await click()
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:protected')
  mocks.wallet = {}; await render()
  expect(host.querySelector('img')).toBeNull()
  expect(revokeUrl).toHaveBeenCalledWith('blob:protected')
  mocks.wallet = firstWallet; await render()
  expect(host.querySelector('img')).toBeNull()
  expect(mocks.decrypt).toHaveBeenCalledTimes(1)
  await click()
  expect(mocks.decrypt).toHaveBeenCalledTimes(2)
  expect(host.querySelector('img')).not.toBeNull()
})
it('recovers from an image decoder failure without leaving a broken-image success state', async () => {
  await mount(); await click()
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error'))); await settle()
  expect(host.querySelector('img')).toBeNull(); expect(revokeUrl).toHaveBeenCalledWith('blob:protected')
  expect(host.textContent).toContain('could not be displayed'); expect(unlock().disabled).toBe(false)
})
it('renders a failed request and allows an explicit successful retry', async () => {
  mocks.decrypt.mockRejectedValueOnce(new Error('User rejected'))
  await mount(); await click(); expect(host.querySelector('[role=alert]')?.textContent).toBe('User rejected')
  expect(unlock().disabled).toBe(false); await click(); expect(host.querySelector('img')).not.toBeNull()
  expect(host.querySelector('[role=alert]')).toBeNull()
})
it('times out stalled read and ignores its late rejection after a successful retry', async () => {
  const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const d = deferred<Blob>(); mocks.decrypt.mockReturnValueOnce(d.promise)
  await mount(); await click(); await act(async () => deadline.abort(new Error('timeout'))); await settle()
  expect(host.textContent).toContain('timed out'); expect(unlock().disabled).toBe(false)
  vi.mocked(AbortSignal.timeout).mockReturnValue(new AbortController().signal)
  await click(); expect(host.querySelector('img')).not.toBeNull()
  await act(async () => d.reject(new Error('late failure'))); await settle()
  expect(host.querySelector('img')).not.toBeNull(); expect(host.querySelector('[role=alert]')).toBeNull()
})
it('passes only an exact personal message to the selected account', async () => {
  mocks.decrypt.mockImplementationOnce(async params => {
    const message = new Uint8Array([1, 2, 3]); await params.signPersonalMessage(message); return new Blob(['png'])
  })
  await mount(); await click(); expect(mocks.sign).toHaveBeenCalledWith({ message: new Uint8Array([1,2,3]), account: mocks.account })
})

it('delegates each protected metadata read to the captured release, State and wallet client', async () => {
  mocks.decrypt.mockImplementationOnce(async params => {
    expect(await params.read()).toEqual({ schema: 'verified' })
    return new Blob(['png'])
  })
  await mount(); await click()
  expect(mocks.read).toHaveBeenCalledWith({ soulId: id(1), stateId: id(2), config: mocks.config,
    signal: expect.any(AbortSignal) }, { client: expect.any(Function) })
  expect(mocks.read.mock.calls[0][1].client()).toBe(mocks.client.grpc)
})

it('missing public configuration is visible and stops before decryption or wallet prompts', async () => {
  mocks.configError = 'Exact Release unavailable'; await mount(); await click()
  expect(host.textContent).toContain('Exact Release unavailable')
  expect(mocks.decrypt).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled()
})
