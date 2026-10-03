import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { browserProfileDraftStore, parseProfileSaveDraft } from '../../web/lib/profile/profile-save-controller'
import { browserProfileCoverCache } from '../../web/lib/profile/profile-cover-cache'
import { publicProfileOperationFixture } from './fixtures/public-profile-operation'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://profile.example.test' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('Storage', dom.window.Storage)
})
afterEach(() => { vi.restoreAllMocks(); dom.window.close(); vi.unstubAllGlobals() })
async function fixture() {
  const { intent, receipt } = await publicProfileOperationFixture()
  return parseProfileSaveDraft({ schema: 'soulidity.profile-save-draft.v1', id: crypto.randomUUID(),
    intent, cover: null, coverReceipt: null, metadataReceipt: receipt })
}
it('a fresh browser store reloads frozen public intent/receipts with no image bodies or expiry deletion', async () => {
  const record = await fixture(), store = browserProfileDraftStore()
  store.write('draft', record)
  expect(browserProfileDraftStore().read('draft')).toEqual(record)
  expect(JSON.parse(dom.window.localStorage.getItem('draft')!)).toEqual(record)
})
it('archive preserves an exact recoverable record before removing the active slot', async () => {
  const record = await fixture(), store = browserProfileDraftStore()
  store.write('draft', record); store.archive('draft', record)
  expect(store.read('draft')).toBeNull()
  expect(store.read(`draft:archive:${record.id}`)).toEqual(record)
})
it('archive quota or removal failure leaves the active save recoverable', async () => {
  const record = await fixture(), store = browserProfileDraftStore()
  store.write('draft', record)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota') })
  expect(() => store.archive('draft', record)).toThrow('quota')
  expect(store.read('draft')).toEqual(record)
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {})
  expect(() => store.archive('draft', record)).toThrow('PROFILE_DRAFT_ARCHIVE_FAILED')
  expect(store.read('draft')).toEqual(record)
})
it('silent writes and malformed records fail closed without deleting evidence', async () => {
  const record = await fixture(), store = browserProfileDraftStore()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {})
  expect(() => store.write('draft', record)).toThrow('PROFILE_DRAFT_PERSISTENCE_FAILED')
  dom.window.localStorage.setItem('draft', '{"schema":"wrong"}')
  expect(() => store.read('draft')).toThrow('PROFILE_DRAFT_INVALID')
  expect(dom.window.localStorage.getItem('draft')).toBe('{"schema":"wrong"}')
})
it('missing IndexedDB fails explicitly rather than pretending to save cropped bytes', async () => {
  vi.stubGlobal('indexedDB', undefined)
  await expect(browserProfileCoverCache().write('scope', new File(['cover'], 'cover.png', { type: 'image/png' })))
    .rejects.toThrow('PROFILE_COVER_RECOVERY_STORAGE_UNAVAILABLE')
})

// Fault-controlled IDB transaction timing, NOT real browser IndexedDB acceptance.
function idbFixture() {
  const request: any = {}, tx: any = {}, dataRequest: any = {}
  const store = { put: vi.fn(), get: vi.fn(() => dataRequest) }
  tx.objectStore = vi.fn(() => store)
  const db = { close: vi.fn(), transaction: vi.fn(() => tx), createObjectStore: vi.fn() }
  request.result = db
  vi.stubGlobal('indexedDB', { open: vi.fn(() => request) })
  return { request, tx, db, store, dataRequest }
}
it('cropped file write waits for a strict transaction commit, not an individual put result', async () => {
  const f = idbFixture(), file = new File(['cover'], 'cover.png', { type: 'image/png' })
  let done = false
  const pending = browserProfileCoverCache().write('scope', file).then(() => { done = true })
  f.request.onsuccess(); await Promise.resolve()
  expect(f.db.transaction).toHaveBeenCalledWith('covers', 'readwrite', { durability: 'strict' })
  expect(f.store.put).toHaveBeenCalledWith(file, 'scope')
  expect(done).toBe(false)
  f.tx.oncomplete(); await pending
  expect(done).toBe(true); expect(f.db.close).toHaveBeenCalledOnce()
})
it('cropped file transaction abort rejects and closes the database', async () => {
  const f = idbFixture()
  const pending = browserProfileCoverCache().write('scope', new File(['cover'], 'cover.png', { type: 'image/png' }))
  const rejected = expect(pending).rejects.toThrow('PROFILE_COVER_RECOVERY_WRITE_FAILED')
  f.request.onsuccess(); await Promise.resolve(); f.tx.onabort()
  await rejected; expect(f.db.close).toHaveBeenCalledOnce()
})
it('cached public Blob read preserves the MIME/extension and refuses malformed bodies', async () => {
  const f = idbFixture(); f.dataRequest.result = new Blob(['cover'], { type: 'image/webp' })
  const pending = browserProfileCoverCache().read('scope')
  f.request.onsuccess(); await Promise.resolve(); f.tx.oncomplete()
  const file = await pending
  expect(file?.name).toBe('profile-cover.webp'); expect(await file?.text()).toBe('cover')
  const bad = idbFixture(); bad.dataRequest.result = { body: 'pretend-image' }
  const rejected = browserProfileCoverCache().read('scope')
  const result = expect(rejected).rejects.toThrow('PROFILE_COVER_RECOVERY_BYTES_INVALID')
  bad.request.onsuccess(); await Promise.resolve(); bad.tx.oncomplete(); await result
})
