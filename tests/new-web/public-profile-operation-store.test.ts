import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { browserPublicProfileOperationStore } from '../../web/lib/profile/profile-operation-client'
import { publicProfileOperationKey, validatePublicProfileOperation } from '../../packages/soulidity-sdk/src/public-profile-operation'
import { publicProfileOperationFixture } from './fixtures/public-profile-operation'

let dom: JSDOM
beforeEach(() => {
  // Keep byte/crypto values in the Node test realm while using actual jsdom
  // Storage. jsdom does not supply a native TextEncoder/WebCrypto pair.
  dom = new JSDOM('', { url: 'https://profile.example.test' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('Storage', dom.window.Storage)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('crypto', webcrypto)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn(async (_key: string, _options: unknown, work: (lock: unknown) => Promise<unknown>) => work({ name: 'fixture-lock' })),
  } })
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); dom.window.close(); vi.unstubAllGlobals() })
it('reloads exact durable profile bytes through a fresh store with no expiry deletion', async () => {
  const { record } = await publicProfileOperationFixture(), key = publicProfileOperationKey(record.intent)
  const store = browserPublicProfileOperationStore()
  await store.exclusive(key, async () => store.write(key, record))
  const restored = browserPublicProfileOperationStore().read(key)
  expect(await validatePublicProfileOperation(restored)).toEqual(record)
  expect(navigator.locks.request).toHaveBeenCalledWith(key, { mode: 'exclusive', ifAvailable: true }, expect.any(Function))
})
it('refuses operation work when another tab owns the lock or the API is unavailable', async () => {
  const work = vi.fn()
  vi.mocked(navigator.locks.request).mockImplementationOnce(async (_key: any, _options: any, fn: any) => fn(null))
  await expect(browserPublicProfileOperationStore().exclusive('scope', work)).rejects.toThrow('PROFILE_OPERATION_BUSY_IN_ANOTHER_TAB')
  expect(work).not.toHaveBeenCalled()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  expect(() => browserPublicProfileOperationStore()).toThrow('PROFILE_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
})
it('preserves previous pending record and exposes quota errors', async () => {
  const { record } = await publicProfileOperationFixture(), key = publicProfileOperationKey(record.intent)
  const store = browserPublicProfileOperationStore(); store.write(key, record)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => store.write(key, { ...record, phase: 'SIGNING' })).toThrow('quota')
  expect(store.read(key)?.phase).toBe('PREPARED')
})
it('fails write-readback instead of using an in-memory replacement', async () => {
  const { record } = await publicProfileOperationFixture(), store = browserPublicProfileOperationStore()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {})
  expect(() => store.write('scope', record)).toThrow('PROFILE_RECOVERY_PERSISTENCE_FAILED')
  expect(store.read('scope')).toBeNull()
})
it('keeps malformed/oversized records visible as errors without silently deleting them', () => {
  localStorage.setItem('bad', '{"schema":999}')
  localStorage.setItem('large', 'x'.repeat(65537))
  const store = browserPublicProfileOperationStore()
  expect(() => store.read('bad')).toThrow()
  expect(() => store.read('large')).toThrow('PROFILE_RECOVERY_RECORD_TOO_LARGE')
  expect(localStorage.getItem('bad')).toBe('{"schema":999}')
  expect(localStorage.getItem('large')).toHaveLength(65537)
})
