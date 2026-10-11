import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import type { WalletKioskInventoryPage, WalletKioskInventoryOptions } from '../../packages/soulidity-sdk/src/wallet-kiosk-inventory'
import { deriveKioskItemFieldId } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { createBrowserOwnedSouls } from '../../web/lib/soulidity/browser-owned-souls'
import type { readBrowserSoulDetail } from '../../web/lib/soulidity/browser-soul-detail'
import { browserSoulDetailFixture, createBrowserSoulDetailModel, detailId as id, detailDigest } from './fixtures/browser-soul-detail-fixture'

afterEach(() => vi.unstubAllGlobals())
async function fixture() {
  const { f, compose } = await createBrowserSoulDetailModel(false), model = compose(), lifetime = new AbortController()
  const item = (itemId: string, type = `${id(1)}::soul::Soul`) => ({ itemId, type,
    fieldId: deriveKioskItemFieldId(model.currentKioskId, itemId), version: '1', digest: detailDigest })
  const page: { -readonly [K in keyof WalletKioskInventoryPage]: WalletKioskInventoryPage[K] } = { owner: model.viewerAddress!, kioskId: model.currentKioskId,
    registeredCapId: id(76), items: [item(model.onChainId)], status: 'COMPLETE', expectedItemCount: 1,
    scannedFields: 1, pages: 1, consistency: 'STABLE_KIOSK_MEMBERSHIP_PER_PAGE', notAuthorization: true }
  const next = vi.fn(async () => page), inventory = vi.fn((_options: WalletKioskInventoryOptions) => ({ next }))
  const detail = vi.fn(async ({ soulId }: Parameters<typeof readBrowserSoulDetail>[0]) => ({ ...structuredClone(model), onChainId: soulId }))
  const params = { owner: model.viewerAddress!, config: f.config, signal: lifetime.signal }
  const dependencies = { client: () => f.client, inventory, detail }
  return { f, model, lifetime, page, item, next, inventory, detail, params, dependencies,
    create: () => createBrowserOwnedSouls(params, dependencies) }
}
it('hydrates a complete wallet Kiosk using the actual inventory, detail, custody, state and listing readers', async () => {
  const f = browserSoulDetailFixture(false), lifetime = new AbortController()
  f.tables.set(f.state.current_kiosk_id, [{ parent: f.state.current_kiosk_id,
    fieldId: deriveKioskItemFieldId(f.state.current_kiosk_id, f.soul.id), kind: 2, childId: f.soul.id,
    name: { name: '0x2::kiosk::Item', value: bcs.Address.serialize(f.soul.id).toBytes() }, valueType: `${id(1)}::soul::Soul` }])
  const scanner = createBrowserOwnedSouls({ owner: f.state.current_owner, config: f.config, signal: lifetime.signal }, { client: () => f.client })
  const result = await scanner.next()
  expect(result).toMatchObject({ status: 'COMPLETE', owner: f.state.current_owner, notAuthorization: true })
  expect(result.souls[0]).toMatchObject({ onChainId: f.soul.id, isOwner: true, listingStatus: 'unlisted', activeGrantCount: '1' })
  expect(result.souls[0].paidAccessKindConfigs[0].priceAtomic).toBe('9007199254740993')
  expect(Object.isFrozen(result.souls[0].activeGrants)).toBe(true)
  await expect(scanner.next()).rejects.toThrow('SCAN_ENDED')
})
it('preserves CollectionRight discovery seeds without treating other assets as Souls', async () => {
  const f = await fixture()
  f.page.items = [...f.page.items, f.item(id(91), `${id(1)}::collection::SoulCollectionRight`), f.item(id(92), `${id(8)}::other::Asset`)]
  const result = await f.create().next()
  expect(result.heldCollectionRightIds).toEqual([id(91)]); expect(result.souls).toHaveLength(1); expect(f.detail).toHaveBeenCalledTimes(1)
})
it('retains a failed terminal page and retries it without skipping discovery or committing half a page', async () => {
  const f = await fixture(); f.page.items = [f.item(id(3)), f.item(id(100))]
  f.detail.mockImplementationOnce(async () => structuredClone(f.model)).mockRejectedValueOnce(new Error('offline'))
  const scan = f.create(); await expect(scan.next()).rejects.toThrow('offline')
  const result = await scan.next(); expect(result.souls.map(row => row.onChainId)).toEqual([id(3), id(100)])
  expect(f.next).toHaveBeenCalledTimes(1); expect(f.detail).toHaveBeenCalledTimes(4)
})
it('carries accumulated verified pages and exposes a terminal limit without declaring completion', async () => {
  const f = await fixture(), first = { ...f.page, status: 'PARTIAL' as const }
  f.next.mockResolvedValueOnce(first).mockResolvedValueOnce({ ...f.page, pages: 2, status: 'LIMIT_REACHED', items: [...f.page.items, f.item(id(100))] })
  const scan = f.create(); expect((await scan.next()).status).toBe('PARTIAL')
  const result = await scan.next(); expect(result.status).toBe('LIMIT_REACHED'); expect(result.souls).toHaveLength(2)
  expect(f.detail).toHaveBeenCalledTimes(2)
})
it.each(['originalPackageId', 'onChainId', 'viewerAddress', 'currentOwnerAddress', 'currentKioskId'] as const)(
  'rejects a detail from another scope: %s', async field => {
    const f = await fixture(); f.detail.mockResolvedValueOnce({ ...f.model, [field]: id(999) })
    await expect(f.create().next()).rejects.toThrow('CHANGED_RESTART')
  })
it('snapshots configuration and passes the same captured client into detail hydration', async () => {
  const f = await fixture(), scan = f.create(); f.params.config.native.soulidityOriginalPackageId = id(999)
  await scan.next()
  expect(f.inventory.mock.calls[0][0].deployment.originalPackageId).toBe(id(1))
  expect(f.detail.mock.calls[0][0]).toMatchObject({ config: { native: { soulidityOriginalPackageId: id(1) } } })
})
it('rejects concurrent next and aborts an in-flight old lifetime even after the same wallet returns', async () => {
  const f = await fixture(); let finish!: (value: typeof f.model) => void
  f.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const scan = f.create(), pending = scan.next(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await expect(scan.next()).rejects.toThrow('BUSY')
  f.lifetime.abort(new Error('identity replaced')); finish(f.model)
  await expect(pending).rejects.toThrow('identity replaced')
  await expect(scan.next()).rejects.toThrow('identity replaced')
})
it.each(['detail', 'inventory'] as const)('caller cancellation releases BUSY even if %s ignores abort', async reader => {
  const f = await fixture(), controller = new AbortController()
  let finishInventory!: (value: WalletKioskInventoryPage) => void
  if (reader === 'detail') f.detail.mockImplementationOnce(() => new Promise(() => {}))
  else f.next.mockImplementationOnce(() => new Promise(resolve => { finishInventory = resolve }))
  const scan = f.create(), waiting = scan.next({ signal: controller.signal })
  const rejected = expect(waiting).rejects.toThrow('page cancelled')
  await vi.waitFor(() => expect(reader === 'detail' ? f.detail : f.next).toHaveBeenCalledTimes(1))
  controller.abort(new Error('page cancelled')); await rejected
  const retried = scan.next()
  if (reader === 'inventory') finishInventory(f.page)
  expect((await retried).status).toBe('COMPLETE')
  expect(f.next).toHaveBeenCalledTimes(1)
})
it('retains the accepted inventory page when cancellation wins the cursor-commit handoff', async () => {
  const f = await fixture(), controller = new AbortController()
  f.next.mockImplementationOnce(async () => { controller.abort(new Error('handoff cancelled')); return f.page })
  const scan = f.create()
  await expect(scan.next({ signal: controller.signal })).rejects.toThrow('handoff cancelled')
  expect((await scan.next()).souls[0].onChainId).toBe(f.model.onChainId)
  expect(f.next).toHaveBeenCalledTimes(1)
})
