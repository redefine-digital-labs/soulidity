import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { browserEquipmentOperationStore, equipmentOperationKey } from '../../web/lib/animacraft/equipment-operation'
import { equipmentOperationFixture } from './fixtures/equipment-operation'
let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://equipment.example.test' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('Storage', dom.window.Storage); vi.stubGlobal('localStorage', dom.window.localStorage)
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn(async (_key: string, _options: unknown, fn: (lock: unknown) => Promise<unknown>) => fn({ name: 'lock' })),
  } })
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); dom.window.close(); vi.unstubAllGlobals() })
it('reloads the exact persisted transaction through a new store instance without a TTL', async () => {
  const { record } = await equipmentOperationFixture(); const key = equipmentOperationKey(record.soulId,record.owner)
  const first = browserEquipmentOperationStore()
  await first.exclusive(key, async () => first.write(key,record))
  expect(browserEquipmentOperationStore().read(key)).toEqual(record)
  expect(navigator.locks.request).toHaveBeenCalledWith(key, { mode: 'exclusive', ifAvailable: true }, expect.any(Function))
})
it('fails closed when cross-tab locking is unavailable or held elsewhere', async () => {
  const work = vi.fn()
  vi.mocked(navigator.locks.request).mockImplementationOnce(async (_key: any, _options: any, fn: any) => fn(null))
  await expect(browserEquipmentOperationStore().exclusive('scope',work)).rejects.toThrow('another tab'); expect(work).not.toHaveBeenCalled()
  Object.defineProperty(navigator,'locks',{ configurable: true, value: undefined })
  expect(() => browserEquipmentOperationStore()).toThrow('Web Locks')
})
it('does not swallow quota failures or remove the previous recoverable transaction', async () => {
  const { record } = await equipmentOperationFixture(); const key = equipmentOperationKey(record.soulId,record.owner)
  const store = browserEquipmentOperationStore(); store.write(key,record)
  vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => store.write(key,{ ...record, phase: 'SIGNING' })).toThrow('quota')
  expect(store.read(key)?.phase).toBe('PREPARED')
})
it('rejects corrupt recovery records without deleting them or pretending there is no operation', () => {
  localStorage.setItem('bad','{"schema":999}')
  expect(() => browserEquipmentOperationStore().read('bad')).toThrow()
  expect(localStorage.getItem('bad')).toBe('{"schema":999}')
})
