// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SoulArtworkImage } from '../../web/components/souls/soul-artwork-image'
const mocks = vi.hoisted(() => ({ read: vi.fn(), config: { target: { release: 'one' } } }))
vi.mock('../../web/lib/animacraft/browser-native-artwork', () => ({
  getBrowserNativeArtworkConfig: () => mocks.config, readBrowserNativeArtwork: mocks.read,
}))

let root: Root; let host: HTMLDivElement
const native = (n: number) => `soulidity-artwork:0x${String(n).padStart(64, '0')}`
const fetched = mocks.read; const ownedFetch = vi.fn(); const createUrl = vi.fn(); const revokeUrl = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetched.mockReset(); createUrl.mockReset().mockReturnValue('blob:verified-image'); revokeUrl.mockReset()
  mocks.config = { target: { release: 'one' } }
  ownedFetch.mockReset().mockRejectedValue(new Error('Owned API must not be called')); vi.stubGlobal('fetch', ownedFetch)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); expect(ownedFetch).not.toHaveBeenCalled(); host.remove(); vi.unstubAllGlobals() })
const render = async (src: string) => { await act(async () => root.render(<SoulArtworkImage src={src} className="cover" />)) }
const success = () => ({ status: 'PUBLIC', blob: new Blob(['png'], { type: 'image/png' }) })
it('preserves existing HTTPS artwork without invoking native readers', async () => {
  await render('https://artist.example/art.png')
  expect(host.querySelector('img')?.getAttribute('src')).toBe('https://artist.example/art.png'); expect(fetched).not.toHaveBeenCalled()
})
it('renders only received PNG and releases its object URL', async () => {
  fetched.mockResolvedValue(success()); await render(native(1))
  expect(fetched).toHaveBeenCalledWith({ soulId: `0x${'1'.padStart(64, '0')}`, config: mocks.config, signal: expect.any(AbortSignal) })
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:verified-image')
  await render('https://artist.example/art.png'); expect(revokeUrl).toHaveBeenCalledWith('blob:verified-image')
})
it('distinguishes protected artwork from retryable read failure', async () => {
  fetched.mockResolvedValueOnce({ status: 'PROTECTED' })
  await render(native(1)); expect(host.textContent).toContain('Protected artwork'); expect(createUrl).not.toHaveBeenCalled()
  fetched.mockRejectedValueOnce(new Error('unavailable')); await render(native(2))
  expect(host.textContent).toContain('Retry'); fetched.mockResolvedValueOnce(success())
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('img')).not.toBeNull()
})
it('ignores a late previous-Soul response after navigation', async () => {
  let finish!: (value: unknown) => void
  fetched.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(native(1)); fetched.mockRejectedValueOnce(new Error('unavailable')); await render(native(2))
  await act(async () => finish(success()))
  expect(host.textContent).toContain('Retry'); expect(host.querySelector('img')).toBeNull(); expect(createUrl).not.toHaveBeenCalled()
})

it('invalidates a completed cover and aborts its read when the public release changes', async () => {
  fetched.mockResolvedValueOnce(success()); await render(native(1))
  const signal = fetched.mock.calls[0][0].signal
  let finish!: (value: unknown) => void
  fetched.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mocks.config = { target: { release: 'two' } }; await render(native(1))
  expect(signal.aborted).toBe(true); expect(revokeUrl).toHaveBeenCalledWith('blob:verified-image')
  expect(host.querySelector('img')).toBeNull()
  await act(async () => finish({ status: 'PROTECTED' }))
  expect(host.textContent).toContain('Protected artwork'); expect(host.querySelector('img')).toBeNull()
})

it('shows retry for invalid browser Blob metadata without displaying it', async () => {
  fetched.mockResolvedValueOnce({ status: 'PUBLIC', blob: new Blob(['wrong'], { type: 'text/html' }) })
  await render(native(1)); expect(host.textContent).toContain('Retry'); expect(createUrl).not.toHaveBeenCalled()
})

it('releases a failed image immediately and ignores its late error after retry', async () => {
  let sequence = 0; createUrl.mockImplementation(() => `blob:cover-${++sequence}`)
  fetched.mockResolvedValue(success()); await render(native(1))
  const old = host.querySelector('img')!
  await act(async () => old.dispatchEvent(new Event('error')))
  expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:cover-1'])
  expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('Retry')
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:cover-2')
  await act(async () => old.dispatchEvent(new Event('error')))
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:cover-2')
  expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual(['blob:cover-1'])
})
