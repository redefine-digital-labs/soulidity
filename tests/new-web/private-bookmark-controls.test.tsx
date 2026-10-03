// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { PrivateBookmarkControls } from '../../web/components/bookmarks/private-bookmark-controls'

const h = vi.hoisted(() => ({ actions: {} as any }))
vi.mock('../../web/lib/hooks/use-private-bookmarks', () => ({ usePrivateBookmarks: () => h.actions }))
let root: Root, host: HTMLDivElement
const requestId = '1'.repeat(64), encoded = JSON.stringify({ record: { context: { requestId } } })
const render = async () => { await act(async () => root.render(<PrivateBookmarkControls />)) }
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
const click = async (text: string) => { await act(async () => button(text).click()) }
const select = async (file: { size: number; text(): Promise<string> }, backup = false) => {
  const input = host.querySelectorAll<HTMLInputElement>('input[type="file"]')[backup ? 1 : 0]
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
const typeConfirmation = async (text: string) => {
  const input = host.querySelector<HTMLInputElement>('input:not([type="file"])')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  h.actions = { privacyKey: 'wallet-a:0', owner: 'wallet-a', connected: true, entries: null, revision: null,
    locked: true, busy: false, loading: false, writesEnabled: true, pending: false, canExport: false, endEpoch: null, error: null, notice: null,
    unlock: vi.fn(), refresh: vi.fn(), lock: vi.fn(), renew: vi.fn(), query: vi.fn(), retry: vi.fn(), rebase: vi.fn(), dismiss: vi.fn(),
    exportRecovery: vi.fn(() => encoded), importRecovery: vi.fn() }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('never presents locked or failed bookmarks as an empty library', async () => {
  await render(); expect(host.textContent).toContain('locked or unavailable, not empty')
  expect(host.querySelector('section')?.classList.contains('ph-no-capture')).toBe(true)
  expect(host.textContent).not.toContain('No private bookmarks yet.'); expect(h.actions.unlock).not.toHaveBeenCalled()
  h.actions = { ...h.actions, error: 'Storage expired' }; await render()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Storage expired')
  expect(host.textContent).not.toContain('No private bookmarks yet.')
  h.actions = { ...h.actions, error: null, entries: [], locked: false, revision: '0' }; await render()
  expect(host.textContent).toContain('No private bookmarks yet.')
})
it('shows wallet connection requirement without active management controls', async () => {
  h.actions.connected = false; await render(); expect(host.textContent).toContain('Connect your wallet')
  expect(host.querySelectorAll('button')).toHaveLength(0); expect(host.querySelectorAll('input')).toHaveLength(0)
})
it('explicit unlock and read-only refresh are exposed, and lock remains available during work', async () => {
  await render(); await click('Unlock private bookmarks'); await click('Refresh bookmark head')
  expect(h.actions.unlock).toHaveBeenCalledOnce(); expect(h.actions.refresh).toHaveBeenCalledOnce()
  h.actions = { ...h.actions, busy: true }; await render()
  expect(button('Unlock private bookmarks').disabled).toBe(true); expect(button('Refresh bookmark head').disabled).toBe(true)
  expect(button('Lock private bookmarks').disabled).toBe(false); await click('Lock private bookmarks'); expect(h.actions.lock).toHaveBeenCalledOnce()
})
it('write gates disable resume/rebase/renew while preserving query and archive', async () => {
  h.actions = { ...h.actions, writesEnabled: false, pending: true, entries: [], locked: false }; await render()
  expect(button('Resume same bookmark request').disabled).toBe(true)
  expect(button('Review bookmark rebase').disabled).toBe(true); expect(button('Renew encrypted bookmark storage').disabled).toBe(true)
  expect(button('Query bookmark request').disabled).toBe(false); await click('Query bookmark request'); expect(h.actions.query).toHaveBeenCalledOnce()
  await click('Review bookmark archive'); expect(h.actions.dismiss).not.toHaveBeenCalled()
  await click('Confirm bookmark archive'); expect(h.actions.dismiss).toHaveBeenCalledOnce()
})
it('rebase is a separate explicit request with paid-storage disclosure', async () => {
  h.actions.pending = true; await render(); await click('Review bookmark rebase')
  expect(h.actions.rebase).not.toHaveBeenCalled(); expect(host.textContent).toContain('may require new paid storage')
  await click('Confirm bookmark rebase'); expect(h.actions.rebase).toHaveBeenCalledOnce()
  expect(h.actions.retry).not.toHaveBeenCalled(); expect(h.actions.dismiss).not.toHaveBeenCalled()
})
it.each([false, true])('requires exact public request ID confirmation before %s backup import', async backup => {
  await render(); await select({ size: encoded.length, text: async () => encoded }, backup)
  expect(h.actions.importRecovery).not.toHaveBeenCalled(); expect(host.textContent).toContain(requestId)
  const label = backup ? 'Confirm and unlock bookmark backup' : 'Confirm and restore bookmark request'
  expect(button(label).disabled).toBe(true)
  await typeConfirmation('wrong'); expect(button(label).disabled).toBe(true)
  await typeConfirmation(requestId); expect(button(label).disabled).toBe(false)
  await click(label); expect(h.actions.importRecovery).toHaveBeenCalledWith(encoded, backup)
  expect(host.textContent).not.toContain('This file claims public request ID')
})
it('discards a late file read after wallet/privacy changes', async () => {
  await render(); let resolve!: (v: string) => void
  await select({ size: 20, text: () => new Promise<string>(r => { resolve = r }) })
  h.actions = { ...h.actions, privacyKey: 'wallet-b:1', owner: 'wallet-b' }; await render()
  await act(async () => resolve(encoded)); expect(host.textContent).not.toContain(requestId)
  expect(h.actions.importRecovery).not.toHaveBeenCalled()
})
it('clears a chosen recovery and request confirmation after manual lock changes the privacy key', async () => {
  await render(); await select({ size: encoded.length, text: async () => encoded }); await typeConfirmation(requestId)
  h.actions = { ...h.actions, privacyKey: 'wallet-a:1' }; await render()
  expect(host.textContent).not.toContain(requestId); expect(host.querySelector('input:not([type="file"])')).toBeNull()
})
it.each(['oversized', 'malformed', 'invalid-request'])('rejects %s recovery without import', async kind => {
  await render(); const file = { size: kind === 'oversized' ? 31 * 1024 * 1024 : 1,
    text: vi.fn(async () => kind === 'malformed' ? '{' : JSON.stringify({ record: { context: { requestId: '0'.repeat(64) } } })) }
  await select(file); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(h.actions.importRecovery).not.toHaveBeenCalled()
  if (kind === 'oversized') expect(file.text).not.toHaveBeenCalled()
})
it('shows action failures while retaining the recovery selection for correction', async () => {
  h.actions.importRecovery.mockRejectedValueOnce(Error('Wrong wallet scope'))
  await render(); await select({ size: 1, text: async () => encoded }); await typeConfirmation(requestId)
  await click('Confirm and restore bookmark request')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Wrong wallet scope')
  expect(host.textContent).toContain(requestId)
})
it('does not claim a null expiry is fresh storage and exposes an explicit renewal', async () => {
  h.actions = { ...h.actions, entries: [], locked: false, revision: '3', endEpoch: null }; await render()
  expect(host.textContent).toContain('does not establish the current remote storage expiry')
  expect(host.textContent).not.toContain('Encrypted storage expires at Walrus epoch')
  expect(button('Renew encrypted bookmark storage').disabled).toBe(false)
  await click('Renew encrypted bookmark storage'); expect(h.actions.renew).toHaveBeenCalledOnce()
})
