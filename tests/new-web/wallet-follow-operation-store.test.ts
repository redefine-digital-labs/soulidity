import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { browserWalletFollowOperationStore } from '../../web/lib/social/follow-operation-client'
import { walletFollowOperationKey } from '../../packages/soulidity-sdk/src/wallet-follow-operation'
import { walletFollowOperationFixture } from './fixtures/wallet-follow-operation'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://follow.example.test' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('Storage', dom.window.Storage); vi.stubGlobal('localStorage', dom.window.localStorage)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn(async (_key: string, _options: unknown, work: (lock: unknown) => Promise<unknown>) => work({ name: 'fixture-lock' })),
  } })
})
afterEach(() => { vi.restoreAllMocks(); dom.window.close(); vi.unstubAllGlobals() })
it('cold-reloads the real browser record with exact scope and strict WebLocks', async () => {
  const { record } = await walletFollowOperationFixture(), key = walletFollowOperationKey(record.intent)
  const store = browserWalletFollowOperationStore()
  await store.exclusive(key, async () => store.write(key, record))
  expect(browserWalletFollowOperationStore().read(key)).toEqual(record)
  expect(navigator.locks.request).toHaveBeenCalledWith(key, { mode: 'exclusive', ifAvailable: true }, expect.any(Function))
})
it('fails closed on competing tab or absent locks without executing operation work', async () => {
  const work = vi.fn()
  vi.mocked(navigator.locks.request).mockImplementationOnce(async (_key: any, _options: any, run: any) => run(null))
  await expect(browserWalletFollowOperationStore().exclusive('scope', work)).rejects.toThrow('FOLLOW_OPERATION_BUSY_IN_ANOTHER_TAB')
  expect(work).not.toHaveBeenCalled()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  expect(() => browserWalletFollowOperationStore()).toThrow('FOLLOW_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
})
it('preserves old durable state on quota failure and rejects silent write/readback loss', async () => {
  const { record } = await walletFollowOperationFixture(), key = walletFollowOperationKey(record.intent), store = browserWalletFollowOperationStore()
  store.write(key, record)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => store.write(key, { ...record, phase: 'SIGNING' })).toThrow('quota')
  expect(store.read(key)?.phase).toBe('PREPARED')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {})
  expect(() => store.write(key, { ...record, phase: 'SIGNING' })).toThrow('FOLLOW_RECOVERY_PERSISTENCE_FAILED')
  expect(store.read(key)?.phase).toBe('PREPARED')
})
it('rejects malformed/oversized/foreign-scope records without deleting or replacing them', async () => {
  const { record } = await walletFollowOperationFixture(), store = browserWalletFollowOperationStore()
  localStorage.setItem('bad', '{"schema":999}'); localStorage.setItem('large', 'x'.repeat(65537))
  localStorage.setItem('other-scope', JSON.stringify(record))
  expect(() => store.read('bad')).toThrow(); expect(() => store.read('large')).toThrow('FOLLOW_RECOVERY_RECORD_TOO_LARGE')
  expect(() => store.read('other-scope')).toThrow('FOLLOW_OPERATION_SCOPE_MISMATCH')
  expect(() => store.write('other-scope', record)).toThrow('FOLLOW_OPERATION_SCOPE_MISMATCH')
  expect(localStorage.getItem('large')).toHaveLength(65537)
  expect(localStorage.getItem('other-scope')).toBe(JSON.stringify(record))
})
