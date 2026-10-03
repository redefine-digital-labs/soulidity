// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NativeOriginalPreview } from '../../web/components/souls/native-original-preview'
import { NativeWardrobePanel } from '../../web/components/souls/native-wardrobe'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'

const mocks = vi.hoisted(() => ({ start: vi.fn(), equipment: vi.fn(), read: vi.fn(),
  signTransaction: vi.fn(), signPersonalMessage: vi.fn(),
  account: { address: 'owner' } as { address: string } | null, client: { grpc: {} }, wallet: {}, config: { target: { release: 'one' } } }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => mocks.account, useSuiClient: () => mocks.client,
  useCurrentWallet: () => ({ currentWallet: mocks.wallet }),
  useSignTransaction: () => ({ mutateAsync: mocks.signTransaction }),
  useSignPersonalMessage: () => ({ mutateAsync: mocks.signPersonalMessage }) }))
vi.mock('../../web/lib/animacraft/browser-native-artwork', () => ({
  getBrowserNativeArtworkConfig: () => mocks.config, readBrowserNativeArtwork: mocks.read,
}))
vi.mock('../../web/lib/animacraft/browser-native-equipment', () => ({ readBrowserNativeEquipment: mocks.equipment }))
vi.mock('../../web/components/souls/native-protected-artwork', () => ({ NativeProtectedArtwork: ({ soulObjectId }: { soulObjectId: string }) =>
  <div data-protected-soul={soulObjectId}>Explicit protected read action</div> }))
vi.mock('../../web/lib/hooks/use-native-equipment-actions', () => ({ useNativeEquipmentActions: () => ({
  record: null, error: null, busy: false, pending: false, canStart: false, start: mocks.start,
}) }))

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const view = (blob = new Blob(['verified completed PNG'], { type: 'image/png' })) => ({ status: 'PUBLIC', blob })
const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject }
}
const fetched = mocks.read; const ownedFetch = vi.fn(); const createUrl = vi.fn(); const revokeUrl = vi.fn()
let root: Root | null; let host: HTMLDivElement; let client: QueryClient
beforeEach(() => {
  mocks.signTransaction.mockReset().mockRejectedValue(new Error('Unexpected wallet transaction request'))
  mocks.signPersonalMessage.mockReset().mockRejectedValue(new Error('Unexpected wallet message request'))
  mocks.start.mockClear(); fetched.mockReset().mockResolvedValue(view())
  mocks.account = { address: 'owner' }; mocks.client = { grpc: {} }; mocks.wallet = {}; mocks.config = { target: { release: 'one' } }
  ownedFetch.mockReset().mockRejectedValue(new Error('Owned API must not be called'))
  let sequence = 0
  createUrl.mockReset().mockImplementation(() => `blob:original-${++sequence}`); revokeUrl.mockReset()
  class PreviewURL extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl }
  vi.stubGlobal('URL', PreviewURL); vi.stubGlobal('fetch', ownedFetch)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  expect(ownedFetch).not.toHaveBeenCalled(); expect(mocks.signTransaction).not.toHaveBeenCalled(); expect(mocks.signPersonalMessage).not.toHaveBeenCalled()
  client.clear(); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
const preview = async (soulId = id(12), stateId = id(14)) => { await act(async () => root!.render(<NativeOriginalPreview soulObjectId={soulId} stateObjectId={stateId} />)); await settle() }
const image = () => host.querySelector('img[alt="Original completed Soul artwork"]')
const button = () => [...host.querySelectorAll('button')].find(value => /^(View original artwork|Retry original preview)$/.test(value.textContent ?? ''))!
const click = async () => { await act(async () => button().click()); await settle() }
const unmount = async () => { await act(async () => root!.unmount()); root = null }

it('loads only the verified completed PNG on explicit request, preserving the exact Blob', async () => {
  const completed = view(); fetched.mockResolvedValue(completed)
  await preview(); expect(fetched).not.toHaveBeenCalled(); expect(image()).toBeNull()
  expect(host.textContent).toContain('image saved at completion, with its selected size and background')
  await click()
  expect(fetched).toHaveBeenCalledWith({ soulId: id(12), config: mocks.config,
    signal: expect.any(AbortSignal) }, { client: expect.any(Function) })
  expect(fetched.mock.calls[0][1].client()).toBe(mocks.client.grpc)
  expect(image()?.getAttribute('src')).toBe('blob:original-1')
  expect(createUrl).toHaveBeenCalledWith(completed.blob); expect(mocks.start).not.toHaveBeenCalled()
})
it('allows anonymous public viewing without wallet authorization', async () => {
  mocks.account = null; await preview(); await click(); expect(image()).not.toBeNull()
})
it('offers an explicit protected read without creating a public image URL', async () => {
  fetched.mockResolvedValue({ status: 'PROTECTED' })
  await preview(); expect(host.querySelector('[data-protected-soul]')).toBeNull(); await click()
  expect(host.querySelector('[data-protected-soul]')?.getAttribute('data-protected-soul')).toBe(id(12)); expect(createUrl).not.toHaveBeenCalled()
  fetched.mockReturnValue(new Promise(() => {})); await preview(id(99)); expect(host.querySelector('[data-protected-soul]')).toBeNull()
})
it('keeps a delayed verified image pending and prevents duplicate requests', async () => {
  const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise)
  await preview(); await click()
  expect(host.querySelector('[role=status]')?.textContent).toContain('Verifying original artwork')
  expect(button().disabled).toBe(true); expect(image()).toBeNull(); expect(createUrl).not.toHaveBeenCalled()
  await click(); expect(fetched).toHaveBeenCalledTimes(1)
  const completed = view(); await act(async () => pending.resolve(completed)); await settle()
  expect(button().disabled).toBe(false); expect(createUrl).toHaveBeenCalledWith(completed.blob)
})
it.each(['resolve', 'reject'])('bounds a stalled read and ignores its late %s after retry', async outcome => {
  const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise)
  await preview(); await click(); await act(async () => deadline.abort(new DOMException('deadline', 'TimeoutError'))); await settle()
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Original preview timed out. Please retry.')
  expect(button().disabled).toBe(false); expect(createUrl).not.toHaveBeenCalled(); expect(fetched.mock.calls[0][0].signal.aborted).toBe(true)
  vi.mocked(AbortSignal.timeout).mockReturnValue(new AbortController().signal); await click()
  await act(async () => { if (outcome === 'resolve') pending.resolve(view()); else pending.reject(new Error('late failure')) }); await settle()
  expect(image()?.getAttribute('src')).toBe('blob:original-1'); expect(createUrl).toHaveBeenCalledTimes(1); expect(host.querySelector('[role=alert]')).toBeNull()
})
it.each([{ status: 'OTHER' }, null, { status: 'PUBLIC' }, { status: 'PUBLIC', blob: 'unverified URL' },
  { status: 'PUBLIC', blob: new Blob(['svg'], { type: 'image/svg+xml' }) }])('rejects malformed verified-image responses: %j', async data => {
  fetched.mockResolvedValue(data); await preview(); await click()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('verified original artwork response is invalid')
  expect(createUrl).not.toHaveBeenCalled(); expect(image()).toBeNull()
})
it.each(['Artwork PNG bytes/hash mismatch', 'Artwork requires authorized decryption', 'Artwork evidence changed; retry the complete read', 'offline'])
('never displays unverified bytes and permits retry after %s', async message => {
  fetched.mockRejectedValueOnce(new Error(message)); await preview(); await click()
  expect(host.querySelector('[role=alert]')?.textContent).toBe(message); expect(image()).toBeNull(); expect(createUrl).not.toHaveBeenCalled()
  expect(button().textContent).toBe('Retry original preview'); await click(); expect(host.querySelector('[role=alert]')).toBeNull(); expect(image()).not.toBeNull()
})
it('revokes a completed URL on retry and the replacement on unmount', async () => {
  await preview(); await click(); const firstSignal = fetched.mock.calls[0][0].signal as AbortSignal
  const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise); await click()
  expect(firstSignal.aborted).toBe(true); expect(revokeUrl).toHaveBeenCalledWith('blob:original-1'); expect(image()).toBeNull()
  await act(async () => pending.resolve(view())); await settle(); expect(image()?.getAttribute('src')).toBe('blob:original-2')
  await unmount(); expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:original-1', 'blob:original-2'])
})
it('recovers from display failure and releases each URL only once', async () => {
  await preview(); await click(); await act(async () => { image()!.dispatchEvent(new Event('error')) })
  expect(image()).toBeNull(); expect(host.querySelector('[role=alert]')?.textContent).toContain('could not be displayed')
  expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:original-1'])
  await click(); expect(image()?.getAttribute('src')).toBe('blob:original-2')
  await unmount(); expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:original-1', 'blob:original-2'])
})
it('a replaced image error cannot invalidate the newer image', async () => {
  await preview(); await click(); const old = image()!; await click()
  expect(image()).not.toBe(old); await act(async () => { old.dispatchEvent(new Event('error')) })
  expect(image()?.getAttribute('src')).toBe('blob:original-2'); expect(host.querySelector('[role=alert]')).toBeNull()
  expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:original-1'])
})
it('aborts on unmount and never creates a URL from a late Blob', async () => {
  const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise)
  await preview(); await click(); const signal = fetched.mock.calls[0][0].signal as AbortSignal
  await unmount(); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(view())); await settle()
  expect(createUrl).not.toHaveBeenCalled(); expect(revokeUrl).not.toHaveBeenCalled()
})
it.each(['resolve', 'reject'])('a previous-Soul read %s cannot replace the new image', async outcome => {
  const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise)
  await preview(); await click(); const firstSignal = fetched.mock.calls[0][0].signal as AbortSignal
  await preview(id(99)); expect(firstSignal.aborted).toBe(true)
  await act(async () => { if (outcome === 'resolve') pending.resolve(view()); else pending.reject(new Error('old Soul failure')) }); await settle()
  expect(image()?.getAttribute('src')).toBe('blob:original-1'); expect(host.querySelector('[role=alert]')).toBeNull(); expect(createUrl).toHaveBeenCalledTimes(1)
})
it('changing Soul revokes its image before waiting for the next image', async () => {
  await preview(); await click(); const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise)
  await preview(id(99)); expect(revokeUrl).toHaveBeenCalledWith('blob:original-1'); expect(image()).toBeNull()
  await act(async () => pending.resolve(view())); await settle(); expect(image()?.getAttribute('src')).toBe('blob:original-2')
})
it('the real Wardrobe requires a new explicit request after switching Soul', async () => {
  const original = await nativeEquipmentSourceFixture().readBase()
  mocks.equipment.mockImplementation(async ({ soulId, stateId }: { soulId: string; stateId: string }) => ({ ...structuredClone(original), soulId, stateId }))
  const wardrobe = async (soulId: string) => {
    await act(async () => root!.render(<QueryClientProvider client={client}><NativeWardrobePanel soulObjectId={soulId} stateObjectId={id(14)} /></QueryClientProvider>)); await settle(); await settle()
  }
  await wardrobe(id(12)); expect(host.textContent).toContain('Current equipment · revision 1'); expect(fetched).not.toHaveBeenCalled()
  await click(); expect(image()).not.toBeNull(); await wardrobe(id(99)); expect(image()).toBeNull(); expect(revokeUrl).toHaveBeenCalledWith('blob:original-1')
  expect(fetched).toHaveBeenCalledTimes(1); await click(); expect(fetched.mock.calls[1][0].soulId).toBe(id(99)); expect(mocks.start).not.toHaveBeenCalled()
})
it.each(['owner','ownershipEpoch'] as const)('Wardrobe releases its displayed image after refreshed %s changes without a wallet switch', async field => {
  const snapshot=await nativeEquipmentSourceFixture().readBase()
  mocks.equipment.mockImplementation(async()=>structuredClone(snapshot))
  await act(async()=>root!.render(<QueryClientProvider client={client}><NativeWardrobePanel soulObjectId={id(12)} stateObjectId={id(14)}/></QueryClientProvider>))
  await settle();await settle();await click()
  expect(image()?.getAttribute('src')).toBe('blob:original-1')
  if(field==='owner')snapshot.owner=id(99)
  else snapshot.ownershipEpoch=String(BigInt(snapshot.ownershipEpoch)+1n)
  await act(async()=>{ [...host.querySelectorAll('button')].find(button=>button.textContent==='Refresh')!.click() })
  await settle();await settle()
  expect(image()).toBeNull();expect(revokeUrl).toHaveBeenCalledWith('blob:original-1')
  expect(fetched).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('View original artwork')
})
it.each(['owner', 'wallet', 'client', 'state', 'release'])('cancels and discards an old %s session', async mode => {
  const pending = deferred<unknown>(); fetched.mockReturnValueOnce(pending.promise); await preview(); await click(); const oldSignal = fetched.mock.calls[0][0].signal
  if (mode === 'owner') mocks.account = { address: 'other' }
  if (mode === 'wallet') mocks.wallet = {}
  if (mode === 'client') mocks.client = { grpc: {} }
  if (mode === 'release') mocks.config = { target: { release: 'two' } }
  await preview(id(12), mode === 'state' ? id(15) : id(14)); expect(oldSignal.aborted).toBe(true)
  await act(async () => pending.resolve(view())); await settle()
  expect(createUrl).toHaveBeenCalledTimes(1); expect(image()?.getAttribute('src')).toBe('blob:original-1')
})
