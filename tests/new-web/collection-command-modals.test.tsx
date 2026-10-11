// @vitest-environment jsdom
// Original three forms and Modal; command proof/journal/hook have separate real suites.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ListCollectionModal, EditCollectionPriceModal, DelistCollectionModal } from '../../web/components/collections/collection-listing-modals'
import { collectionCommandFixture } from './fixtures/collection-command'

const h = vi.hoisted(() => ({ commands: {} as any, toast: vi.fn(), close: vi.fn() }))
vi.mock('../../web/lib/hooks/use-collection-commands', () => ({ useCollectionCommands: () => h.commands }))
vi.mock('../../web/components/ui/toast', () => ({ useToast: () => ({ showToast: h.toast }) }))
let host: HTMLDivElement, root: Root, query: QueryClient, f: Awaited<ReturnType<typeof collectionCommandFixture>>
const forms = { list: ListCollectionModal, reprice: EditCollectionPriceModal, delist: DelistCollectionModal }
const render = async (action: keyof typeof forms = 'list') => {
  const Form = forms[action]
  await act(async () => root.render(<QueryClientProvider client={query}><Form collection={{ onChainId: f.c.id, name: 'Verified Collection',
    listedPriceAtomic: action === 'list' ? null : '2000000', listingObjectOnChainId: action === 'list' ? null : f.listing.id }} open onClose={h.close} /></QueryClientProvider>))
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
const click = async (text: string) => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()) }
const price = async (text: string) => { const input = host.querySelector<HTMLInputElement>('input')!; await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}) }
beforeAll(() => { vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => vi.unstubAllGlobals())
beforeEach(async () => {
  vi.clearAllMocks(); f = await collectionCommandFixture('list', { feeBps: 250, price: '1000000' })
  h.commands = { currentAddress: f.author, targetKey: JSON.stringify(f.target), records: [], history: [], pending: false,
    status: null, error: null, currentObservation: null, prepare: vi.fn(async () => {}), run: vi.fn(async () => ({ status: 'PENDING' })),
    exportRecord: vi.fn(() => 'public-recovery'), importRecord: vi.fn(async () => {}) }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); query = new QueryClient()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); query.clear(); vi.restoreAllMocks() })

it.each(['list', 'reprice', 'delist'] as const)('%s keeps the original form and separates review from signature', async action => {
  await render(action)
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Verified Collection')
  expect(host.querySelector('[role="dialog"]')?.classList.contains('overflow-y-auto')).toBe(true)
  if (action !== 'delist') { expect(button('Review transaction').disabled).toBe(true); await price('1.000001') }
  await click('Review transaction')
  expect(h.commands.prepare).toHaveBeenCalledWith({ action, priceAtomic: action === 'delist' ? null : '1000001' })
  expect(h.commands.run).not.toHaveBeenCalled()
})
it.each(['0', '-1', '0.0000001', '18446744073709.551616', 'not a number'])('does not prepare invalid price %s', async value => {
  await render(); await price(value); expect(button('Review transaction').disabled).toBe(true)
  await click('Review transaction'); expect(h.commands.prepare).not.toHaveBeenCalled()
})
it('does not reprice to the same displayed amount and clears errors when the user fixes it', async () => {
  await render('reprice'); await price('2'); expect(button('Review transaction').disabled).toBe(true)
  expect(host.textContent).toContain('Same as current price'); await price('3')
  expect(button('Review transaction').disabled).toBe(false); expect(host.textContent).not.toContain('Same as current price')
})
it('shows the actual additive fee, seller proceeds and exact saved gas budget before signature', async () => {
  const record = { ...f.record, packet: { ...f.record.packet, phase: 'PREPARED', signature: null } }
  h.commands.records = [record]; await render()
  expect(host.textContent).toContain('Seller receives: 1 USDC')
  expect(host.textContent).toContain('Buyer adds platform fee: 0.025 USDC (2.5%)')
  expect(host.textContent).toContain('Buyer total: 1.025 USDC')
  expect(host.textContent).toContain('SUI gas budget: 0.001 SUI')
  expect(host.textContent).toContain('expires after epoch 10'); expect(button('Review transaction')).toBeUndefined()
  await click('Sign and submit'); expect(h.commands.run).toHaveBeenCalledWith(record, 'resume')
  expect(h.toast).not.toHaveBeenCalled()
})
it('signed unknown packets remain query-first, block new review and cannot be cancelled as unsigned', async () => {
  h.commands.records = [f.record]; h.commands.error = 'Acknowledgement lost'; await render()
  expect(host.querySelector('input')?.disabled).toBe(true); expect(button('Review transaction')).toBeUndefined()
  expect(button('Cancel unsigned')).toBeUndefined(); await click('Query result')
  expect(h.commands.run).toHaveBeenCalledWith(f.record, 'query')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Acknowledgement lost')
  await click('Export recovery'); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Collection recovery backup"]')?.value).toBe('public-recovery')
})
it.each(['wallet', 'release'])('keeps query/backup but disables signed resume after %s replacement', async kind => {
  h.commands.records = [f.record]
  if (kind === 'wallet') h.commands.currentAddress = null; else h.commands.targetKey = 'other-release'
  await render(); expect(button('Resume same request').disabled).toBe(true)
  expect(button('Query result').disabled).toBe(false); expect(button('Export recovery').disabled).toBe(false)
  await click('Resume same request'); expect(h.commands.run).not.toHaveBeenCalled()
})
it('explicit unsigned cancel, import, close and failures remain visible without pretending success', async () => {
  const record = { ...f.record, packet: { ...f.record.packet, phase: 'PREPARED', signature: null } }
  h.commands.records = [record]; h.commands.run.mockRejectedValueOnce(Error('Storage unavailable')); await render()
  await click('Cancel unsigned'); expect(h.commands.run).toHaveBeenCalledWith(record, 'cancel-unsigned')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable')
  const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Import collection recovery"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '{"packet":"exact"}')
    input.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Import and query only'); expect(h.commands.importRecord).toHaveBeenCalledWith('{"packet":"exact"}')
  await click('Close'); expect(h.close).toHaveBeenCalledOnce(); expect(h.toast).not.toHaveBeenCalled()
})
