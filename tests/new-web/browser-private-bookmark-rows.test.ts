import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserPrivateBookmarkRows } from '../../web/lib/bookmarks/browser-private-bookmark-rows'
import type { readBrowserSoulDetail } from '../../web/lib/soulidity/browser-soul-detail'
import { browserSoulDetailFixture, createBrowserSoulDetailModel, detailId as id } from './fixtures/browser-soul-detail-fixture'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const entry = (soulId: string) => ({ soulId, createdAt: '2026-09-15T12:00:00.000Z' })
async function fixture(count = 23) {
  const { f, compose } = await createBrowserSoulDetailModel(false), model = compose(), lifetime = new AbortController()
  const deployment = { originalPackageId: f.config.native.soulidityOriginalPackageId, callablePackageId: f.config.native.soulidityCallablePackageId,
    callableDigest: f.config.native.soulidityCallableDigest, chainIdentifier: f.config.chainIdentifier }
  const params = { entries: Array.from({ length: count }, (_, i) => entry(id(800 + i))), owner: model.viewerAddress!,
    deployment, config: f.config, signal: lifetime.signal }
  const detail = vi.fn(async ({ soulId }: Parameters<typeof readBrowserSoulDetail>[0]) => ({ ...structuredClone(model), onChainId: soulId }))
  const dependencies = { client: () => f.client, detail }
  return { f, model, params, detail, dependencies, lifetime, create: () => createBrowserPrivateBookmarkRows(params, dependencies) }
}
it('reads a private entry through the actual browser raw asset/state/listing composition', async () => {
  const f = browserSoulDetailFixture(false), scope = { originalPackageId: f.config.native.soulidityOriginalPackageId,
    callablePackageId: f.config.native.soulidityCallablePackageId, callableDigest: f.config.native.soulidityCallableDigest, chainIdentifier: f.config.chainIdentifier }
  const reader = createBrowserPrivateBookmarkRows({ entries: [entry(f.soul.id)], owner: f.state.current_owner,
    deployment: scope, config: f.config, signal: new AbortController().signal }, { client: () => f.client })
  const page = await reader.load()
  expect(page).toMatchObject({ total: 1, pageCount: 1, partial: false })
  expect(page.rows[0]).toMatchObject({ soulId: f.soul.id, status: 'AVAILABLE', detail: { onChainId: f.soul.id, listingStatus: 'unlisted' } })
})
it('uses page-sized detail memory without a bookmark count quota and preserves private order', async () => {
  const f = await fixture(), reader = f.create(), first = await reader.load()
  expect(first).toMatchObject({ page: 0, pageCount: 2, total: 23, hasPrevious: false, hasNext: true })
  expect(first.rows.map(row => row.soulId)).toEqual(f.params.entries.slice(0, 20).map(row => row.soulId))
  expect(f.detail).toHaveBeenCalledTimes(20)
  const last = await reader.load(1)
  expect(last).toMatchObject({ page: 1, total: 23, hasPrevious: true, hasNext: false })
  expect(last.rows).toHaveLength(3); expect(f.detail).toHaveBeenCalledTimes(23)
  expect((await reader.load(0)).rows).toHaveLength(20)
})
it('retains every unavailable private ID and retries only failed details on that page', async () => {
  const f = await fixture(3); f.detail.mockRejectedValueOnce(new Error('not found')).mockRejectedValueOnce(new Error('offline'))
  const reader = f.create(), first = await reader.load()
  expect(first.total).toBe(3); expect(first.partial).toBe(true)
  expect(first.rows.map(row => row.soulId)).toEqual(f.params.entries.map(row => row.soulId))
  expect(first.rows[0]).toMatchObject({ status: 'UNAVAILABLE', detail: null, error: 'not found' })
  expect((await reader.retryFailed()).partial).toBe(false); expect(f.detail).toHaveBeenCalledTimes(5)
})
it('empty decrypted entries really are empty and perform no asset reads', async () => {
  const f = await fixture(0), page = await f.create().load()
  expect(page).toEqual({ page: 0, pageCount: 1, total: 0, rows: [], hasPrevious: false, hasNext: false, partial: false })
  expect(f.detail).not.toHaveBeenCalled()
})
it.each(['onChainId', 'originalPackageId', 'viewerAddress'] as const)('an out-of-scope %s never becomes a valid bookmarked card', async field => {
  const f = await fixture(1); f.detail.mockResolvedValueOnce({ ...f.model, onChainId: f.params.entries[0].soulId, [field]: id(999) })
  expect((await f.create().load()).rows[0]).toMatchObject({ soulId: f.params.entries[0].soulId, status: 'UNAVAILABLE', error: 'PRIVATE_BOOKMARK_ROWS_DETAIL_SCOPE_MISMATCH' })
})
it('captures private entries, public release and dependency callbacks before asynchronous reading', async () => {
  const f = await fixture(1), reader = f.create(), original = structuredClone(f.params.entries[0])
  f.params.entries[0].soulId = id(999); f.params.config.native.soulidityOriginalPackageId = id(999)
  f.dependencies.detail = vi.fn(async () => { throw new Error('replacement callback') })
  expect((await reader.load()).rows[0]).toMatchObject({ ...original, status: 'AVAILABLE' })
  expect(f.detail).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ native: expect.objectContaining({ soulidityOriginalPackageId: id(1) }) }) }), expect.anything())
})
it('bounds parallel reads to four and rejects concurrent pagination', async () => {
  const f = await fixture(8), pending: Array<() => void> = []
  f.detail.mockImplementation(async ({ soulId }) => { await new Promise<void>(done => pending.push(done)); return { ...f.model, onChainId: soulId } })
  const reader = f.create(), page = reader.load()
  await vi.waitFor(() => expect(pending).toHaveLength(4))
  expect(f.detail).toHaveBeenCalledTimes(4)
  await expect(reader.load(0)).rejects.toThrow('ROWS_BUSY')
  pending.splice(0).forEach(done => done())
  await vi.waitFor(() => expect(pending).toHaveLength(4)); pending.splice(0).forEach(done => done())
  expect((await page).rows).toHaveLength(8)
})
it('lifetime cancellation ends ignored transport waits and rejects late details instead of caching them', async () => {
  const f = await fixture(1); let release!: (value: typeof f.model) => void
  f.detail.mockImplementationOnce(() => new Promise(done => { release = done }))
  const reader = f.create(), pending = reader.load(); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.lifetime.abort(new Error('wallet replaced'))
  await expect(pending).rejects.toThrow('wallet replaced')
  release({ ...f.model, onChainId: f.params.entries[0].soulId })
  await expect(reader.load()).rejects.toThrow('wallet replaced')
})
it.each([-1, 0.5, 2, Number.NaN])('rejects invalid page %s rather than silently clamping or dropping entries', async page => {
  const f = await fixture()
  await expect(f.create().load(page)).rejects.toThrow('ROWS_PAGE_INVALID')
  expect(f.detail).not.toHaveBeenCalled()
})
it.each(['duplicate', 'invalid-id', 'unknown-field', 'invalid-date', 'wrong-release'] as const)('rejects malformed row scope: %s', async problem => {
  const f = await fixture(1)
  if (problem === 'duplicate') f.params.entries.push(f.params.entries[0])
  else if (problem === 'invalid-id') f.params.entries[0].soulId = 'SQL-row-id'
  else if (problem === 'unknown-field') Object.assign(f.params.entries[0], { name: 'private' })
  else if (problem === 'invalid-date') f.params.entries[0].createdAt = 'yesterday'
  else f.params.deployment.callablePackageId = id(999)
  expect(() => f.create()).toThrow()
})
