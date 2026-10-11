// @vitest-environment jsdom
// Real production panel, Button, React and React Query. Only the supplied
// purchase-hook result is controlled; these are not wallet or chain tests.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { CollectionPurchasePanel } from '../../web/components/collections/collection-purchase-panel'
import type { useCollectionBuy } from '../../web/lib/hooks/use-collection-buy'
import { publicMutationCanonical } from '../../web/lib/sui/public-mutation-journal'
import { collectionBuyUIRecord, buyDeferred, buyId } from './fixtures/newcollection-buy-ui'

type Purchase = ReturnType<typeof useCollectionBuy>
let host: HTMLDivElement, root: Root, query: QueryClient, record: Awaited<ReturnType<typeof collectionBuyUIRecord>>
let purchase: Purchase, offered: boolean, expanded: boolean, unmounted: boolean
const expand = vi.fn()
async function render() { await act(async () => root.render(<QueryClientProvider client={query}>
  <CollectionPurchasePanel purchase={purchase} offered={offered} expanded={expanded} onExpand={expand} />
</QueryClientProvider>)) }
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)
const click = async (label: string) => { expect(button(label)).toBeTruthy(); await act(async () => button(label)!.click()) }
async function input(value: string) { await act(async () => {
  const element = host.querySelector<HTMLTextAreaElement>('#collection-purchase-import')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}) }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  record = await collectionBuyUIRecord(); offered = true; expanded = true; unmounted = false; expand.mockReset()
  purchase = { currentAddress: record.plan.author, targetKey: publicMutationCanonical(record.plan.target), identityKey: 'A:1',
    records: [], history: [], pending: false, status: null, error: null, currentObservation: null,
    prepare: vi.fn<Purchase['prepare']>().mockResolvedValue(record),
    run: vi.fn<Purchase['run']>().mockResolvedValue({ status: 'MISSING', record }),
    importRecord: vi.fn<Purchase['importRecord']>().mockResolvedValue(record),
    exportRecord: vi.fn<Purchase['exportRecord']>().mockReturnValue(JSON.stringify(record)) }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); query = new QueryClient()
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); query.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('Review prepares a saved transaction and never invokes a signing/resume path', async () => {
  await render(); await click('Review purchase transaction')
  expect(purchase.prepare).toHaveBeenCalledOnce(); expect(purchase.run).not.toHaveBeenCalled()
  expect(host.textContent).toContain('not creator authority to add Souls')
})
it('renders exact saved additive quote, gas cap, epoch and same-transaction new Kiosk before signing', async () => {
  purchase.records = [record]; await render()
  for (const text of ['Seller receives: 1.000001 USDC', 'Platform fee: 0.025001 USDC (2.5%)', 'Total USDC payment: 1.025002 USDC',
    'SUI gas budget: 0.001000001 SUI', 'expires after epoch 11', 'Creates and registers your personal Kiosk in this same transaction.',
    'Gas budget is a cap, not the final gas charge']) expect(host.textContent).toContain(text)
  expect(button('Review purchase transaction')).toBeUndefined()
  await click('Sign and buy'); expect(purchase.run).toHaveBeenCalledWith(record, 'resume')
})
it('existing verified Kiosk is distinguished from same-transaction creation', async () => {
  record.plan.buyerKiosk = { kind: 'EXISTING', kioskId: buyId(90), capId: buyId(91) }; purchase.records = [record]; await render()
  expect(host.textContent).toContain('Receives the Collection Right into your verified personal Kiosk.')
  expect(host.textContent).not.toContain('Creates and registers')
})
it.each(['SIGNING', 'SIGNED'] as const)('%s unknown outcome hides new intent and unsigned cancellation but retains same-packet query/resume', async phase => {
  record.packet.phase = phase; purchase.records = [record]; offered = false; purchase.error = 'Acknowledgement lost'; await render()
  expect(button('Review purchase transaction')).toBeUndefined(); expect(button('Cancel unsigned purchase')).toBeUndefined()
  await click('Query purchase'); expect(purchase.run).toHaveBeenLastCalledWith(record, 'query')
  await click('Resume same purchase'); expect(purchase.run).toHaveBeenLastCalledWith(record, 'resume')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Acknowledgement lost')
})
it.each(['wallet', 'release'] as const)('%s change makes unresolved recovery query/backup-only', async kind => {
  record.packet.phase = 'SIGNED'; purchase.records = [record]
  if (kind === 'wallet') purchase.currentAddress = buyId(90); else purchase.targetKey = 'different-release'
  await render(); expect(button('Resume same purchase')?.disabled).toBe(true)
  expect(button('Query purchase')?.disabled).toBe(false); expect(button('Export purchase recovery')?.disabled).toBe(false)
  await click('Resume same purchase'); expect(purchase.run).not.toHaveBeenCalled()
  await click('Query purchase'); expect(purchase.run).toHaveBeenCalledWith(record, 'query')
  expect(host.textContent).toContain(kind === 'wallet' ? 'Connect purchasing wallet' : 'Release configuration changed')
})
it('canonical target field reordering does not falsely disable resume', async () => {
  record.plan.target = Object.fromEntries(Object.entries(record.plan.target).reverse()) as typeof record.plan.target
  purchase.records = [record]; await render(); expect(button('Sign and buy')?.disabled).toBe(false)
  await click('Sign and buy'); expect(purchase.run).toHaveBeenCalledWith(record, 'resume')
})
it('prepared unsigned cancellation is explicit and never passes resume', async () => {
  purchase.records = [record]; await render(); await click('Cancel unsigned purchase')
  expect(purchase.run).toHaveBeenCalledExactlyOnceWith(record, 'cancel-unsigned'); expect(purchase.prepare).not.toHaveBeenCalled()
})
it('import passes exact public JSON without resuming; export shows the exact returned backup', async () => {
  purchase.records = [record]; await render(); expect(button('Query and import purchase')?.disabled).toBe(true)
  const json = JSON.stringify(record); await input(json); await click('Query and import purchase')
  expect(purchase.importRecord).toHaveBeenCalledExactlyOnceWith(json); expect(purchase.run).not.toHaveBeenCalled()
  await click('Export purchase recovery')
  expect(purchase.exportRecord).toHaveBeenCalledExactlyOnceWith(record)
  expect(host.querySelector<HTMLTextAreaElement>('#collection-purchase-export')?.value).toBe(json)
})
it('all active mutation/recovery controls disable while an operation is pending', async () => {
  purchase.records = [record]; await render(); await input('{}'); purchase.pending = true; await render()
  for (const b of host.querySelectorAll<HTMLButtonElement>('button')) { expect(b.disabled).toBe(true); await act(async () => b.click()) }
  expect(purchase.run).not.toHaveBeenCalled(); expect(purchase.importRecord).not.toHaveBeenCalled(); expect(purchase.exportRecord).not.toHaveBeenCalled()
})
it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const)('%s receipt permits a separately reviewed new intent and keeps terminal packet query/export-only', async phase => {
  record.packet.phase = phase; purchase.records = [record]; await render()
  expect(button('Review purchase transaction')).toBeTruthy(); expect(button('Sign and buy')).toBeUndefined(); expect(button('Resume same purchase')).toBeUndefined()
  expect(button('Cancel unsigned purchase')).toBeUndefined(); await click('Query purchase')
  expect(purchase.run).toHaveBeenCalledWith(record, 'query')
})
it('retained receipts allow exact historical query/export without resume or unsigned cancellation', async () => {
  record.packet.phase = 'SUCCEEDED'; purchase.history = [record]; expanded = false; offered = false; await render()
  expect(host.textContent).toContain('Retained purchase receipts (1)'); expect(host.textContent).toContain('retained receipt')
  expect(button('Sign and buy')).toBeUndefined(); expect(button('Resume same purchase')).toBeUndefined()
  expect(button('Cancel unsigned purchase')).toBeUndefined()
  await click('Query purchase'); expect(purchase.run).toHaveBeenCalledExactlyOnceWith(record, 'query')
  await click('Export purchase recovery'); expect(purchase.exportRecord).toHaveBeenCalledWith(record)
})
it('disconnected users can query/import public receipts but cannot prepare or resume', async () => {
  purchase.currentAddress = null; await render(); expect(button('Review purchase transaction')?.disabled).toBe(true)
  await click('Review purchase transaction'); expect(purchase.prepare).not.toHaveBeenCalled()
  await input('{}'); await click('Query and import purchase'); expect(purchase.importRecord).toHaveBeenCalledWith('{}')
  purchase.records = [record]; await render(); expect(button('Sign and buy')?.disabled).toBe(true); expect(button('Query purchase')?.disabled).toBe(false)
})
it('recovery can open without an active listing and old packets keep it expanded automatically', async () => {
  expanded = false; offered = false; await render(); expect(button('Review purchase transaction')).toBeUndefined()
  await click('Open purchase recovery'); expect(expand).toHaveBeenCalledOnce()
  purchase.records = [record]; await render(); expect(button('Open purchase recovery')).toBeUndefined(); expect(button('Query purchase')).toBeTruthy()
})
it('visible operation errors are not converted into success and current-custody text remains distinct', async () => {
  vi.mocked(purchase.prepare).mockRejectedValue(Error('Storage readback failed')); await render(); await click('Review purchase transaction')
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Storage readback failed')
  purchase.status = 'Historical purchase confirmed'; purchase.currentObservation = 'Current custody has changed'; await render()
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Historical purchase confirmed'); expect(host.textContent).toContain('Current custody has changed')
})
it('scope replacement clears import/backup/errors and a late earlier callback cannot repopulate them', async () => {
  purchase.records = [record]; await render(); await input('old-import'); await click('Export purchase recovery')
  const gate = buyDeferred<Awaited<ReturnType<Purchase['run']>>>(); vi.mocked(purchase.run).mockReturnValueOnce(gate.promise)
  await click('Query purchase'); purchase = { ...purchase, identityKey: 'B:2', records: [] }; await render()
  expect(host.querySelector<HTMLTextAreaElement>('#collection-purchase-import')?.value).toBe('')
  expect(host.querySelector('#collection-purchase-export')).toBeNull()
  purchase = { ...purchase, identityKey: 'A:3' }; await render()
  await act(async () => gate.reject(Error('stale callback error')))
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
it('unmount drops late operation errors without another render', async () => {
  const gate = buyDeferred<Awaited<ReturnType<Purchase['prepare']>>>(); vi.mocked(purchase.prepare).mockReturnValueOnce(gate.promise)
  await render(); await click('Review purchase transaction'); await act(async () => root.unmount()); unmounted = true
  await act(async () => gate.reject(Error('late after close'))); expect(host.textContent).toBe('')
})
