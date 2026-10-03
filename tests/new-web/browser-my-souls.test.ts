import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveKioskItemFieldId } from '@soulidity/sdk'
import { createBrowserMySouls, MY_SOULS_SECTIONS } from '../../web/lib/soulidity/browser-my-souls'
import { createBrowserOwnedSouls } from '../../web/lib/soulidity/browser-owned-souls'
import { createBrowserSoulDetailModel, detailDigest } from './fixtures/browser-soul-detail-fixture'
import { deferred, id, mySoulsFixture } from './fixtures/my-souls'

afterEach(() => vi.restoreAllMocks())
it('starts unscanned, keeps independent provenance and freezes snapshots', () => {
  const f = mySoulsFixture(), scan = createBrowserMySouls(f.params, f.dependencies), snapshot = scan.snapshot()
  expect(snapshot.portfolio.coverage).toEqual({ owned: 'UNSCANNED', collections: 'UNSCANNED', activity: 'UNSCANNED' })
  expect(snapshot).toMatchObject({ consistency: 'INDEPENDENT_NON_ATOMIC_READSETS', notAuthorization: true })
  expect(snapshot.portfolio.totals.listedValueAtomic).toBeNull()
  expect(Object.isFrozen(snapshot.progress.owned)).toBe(true); expect(Object.isFrozen(snapshot.portfolio.collections)).toBe(true)
  expect(f.factories.owned).not.toHaveBeenCalled()
})
it('merges three concurrent channels in reverse completion order without lost updates', async () => {
  const f = mySoulsFixture(), o = deferred<ReturnType<typeof f.owned>>(), c = deferred<ReturnType<typeof f.collections>>(), a = deferred<ReturnType<typeof f.activity>>()
  f.reads.owned.mockReturnValueOnce(o.promise); f.reads.collections.mockReturnValueOnce(c.promise); f.reads.activity.mockReturnValueOnce(a.promise)
  const scan = createBrowserMySouls(f.params, f.dependencies), jobs = MY_SOULS_SECTIONS.map(section => scan.next(section))
  expect(MY_SOULS_SECTIONS.every(section => scan.snapshot().progress[section].busy)).toBe(true)
  a.resolve(f.activity()); await jobs[2]
  expect(scan.snapshot().portfolio.grants).toHaveLength(1); expect(scan.snapshot().portfolio.coverage.owned).toBe('UNSCANNED')
  c.resolve(f.collections()); await jobs[1]; o.resolve(f.owned()); await jobs[0]
  expect(scan.snapshot().portfolio).toMatchObject({ coverage: { owned: 'COMPLETE', collections: 'COMPLETE', activity: 'COMPLETE' } })
  expect(scan.snapshot().portfolio.collections).toHaveLength(1); expect(scan.snapshot().portfolio.grants).toHaveLength(1)
  expect(scan.snapshot().progress.collections).toMatchObject({ pages: 1, stage: 'COLLECTIONS', checkpoint: '100' })
  expect(scan.snapshot().progress.activity).toMatchObject({ pages: 1, stage: 'SoulGrantIssued', checkpoint: '100' })
})
it('replaces cumulative pages, never appends duplicate rows or double counts', async () => {
  const f = mySoulsFixture()
  f.reads.collections.mockResolvedValueOnce(f.collections('PARTIAL', 1)).mockResolvedValueOnce(f.collections('COMPLETE', 2))
  f.reads.activity.mockResolvedValueOnce(f.activity('PARTIAL', 1)).mockResolvedValueOnce(f.activity('COMPLETE', 2))
  const scan = createBrowserMySouls(f.params, f.dependencies)
  await Promise.all(MY_SOULS_SECTIONS.map(section => scan.next(section)))
  const first = scan.snapshot()
  await Promise.all([scan.next('collections'), scan.next('activity')])
  expect(scan.snapshot().portfolio.collections).toHaveLength(2); expect(scan.snapshot().portfolio.grants).toHaveLength(2)
  expect(scan.snapshot().portfolio.purchases).toHaveLength(2); expect(first.portfolio.collections).toHaveLength(1)
  expect(scan.snapshot().progress.collections.pages).toBe(2)
})
it('empty Owned does not block created-sold Collections, received grants or purchases', async () => {
  const f = mySoulsFixture(), scan = createBrowserMySouls(f.params, f.dependencies)
  await scan.next('owned'); await Promise.all([scan.next('collections'), scan.next('activity')])
  expect(scan.snapshot().portfolio.owned).toEqual([])
  expect(scan.snapshot().portfolio.collections[0].relationship).toBe('CREATED_SOLD')
  expect(scan.snapshot().portfolio.grants[0].granteeAddress).toBe(f.owner)
  expect(scan.snapshot().portfolio.purchases[0].paidAtomic).toBe('9007199254740993')
  expect(f.factories.collections.mock.calls[0]?.[0]).not.toHaveProperty('heldCollectionRightIds')
})
it.each(MY_SOULS_SECTIONS)('retries failed %s through the same reader and retains other channels', async section => {
  const f = mySoulsFixture(), scan = createBrowserMySouls(f.params, f.dependencies)
  f.reads[section].mockRejectedValueOnce(new Error('same cursor offline'))
  await Promise.all(MY_SOULS_SECTIONS.map(name => scan.next(name)))
  expect(scan.snapshot().progress[section]).toMatchObject({ pages: 0, status: 'UNSCANNED', error: 'same cursor offline', busy: false })
  expect(MY_SOULS_SECTIONS.filter(name => name !== section).every(name => scan.snapshot().progress[name].status === 'COMPLETE')).toBe(true)
  await scan.next(section)
  expect(scan.snapshot().progress[section]).toMatchObject({ pages: 1, error: null, status: 'COMPLETE' })
  expect(f.factories[section]).toHaveBeenCalledOnce(); expect(f.reads[section]).toHaveBeenCalledTimes(2)
})
it.each(['success', 'failure'] as const)('joins a paused transport that ignores abort and handles its late %s', async outcome => {
  const f = mySoulsFixture(), late = deferred<ReturnType<typeof f.collections>>(), pause = new AbortController()
  f.reads.collections.mockReturnValueOnce(late.promise)
  const scan = createBrowserMySouls(f.params, f.dependencies), first = scan.next('collections', { signal: pause.signal })
  await Promise.resolve(); expect(f.reads.collections).toHaveBeenCalledOnce(); pause.abort(); await first
  expect(scan.snapshot().progress.collections).toMatchObject({ busy: false, pages: 0, error: null })
  const resumed = scan.next('collections')
  expect(f.reads.collections).toHaveBeenCalledOnce()
  if (outcome === 'success') late.resolve(f.collections('PARTIAL'))
  else late.reject(new Error('late offline'))
  await resumed
  expect(scan.snapshot().progress.collections.pages).toBe(outcome === 'success' ? 1 : 0)
  await scan.next('collections')
  expect(f.reads.collections).toHaveBeenCalledTimes(2)
  expect(scan.snapshot().progress.collections).toMatchObject({ status: 'COMPLETE', error: null })
})
it('latches a late paused page before resume without advancing again after terminal completion', async () => {
  const f = mySoulsFixture(), late = deferred<ReturnType<typeof f.owned>>(), pause = new AbortController()
  f.reads.owned.mockReturnValueOnce(late.promise)
  const scan = createBrowserMySouls(f.params, f.dependencies), first = scan.next('owned', { signal: pause.signal })
  await Promise.resolve(); expect(f.reads.owned).toHaveBeenCalledOnce()
  pause.abort(); await first; late.resolve(f.owned()); await late.promise; await Promise.resolve(); await Promise.resolve()
  await scan.next('owned'); expect(f.reads.owned).toHaveBeenCalledOnce(); expect(scan.snapshot().progress.owned.pages).toBe(1)
})
it.each(MY_SOULS_SECTIONS)('rejects overlapping %s calls without a second advance', async section => {
  const f = mySoulsFixture(), late = deferred<any>()
  f.reads[section].mockReturnValueOnce(late.promise)
  const scan = createBrowserMySouls(f.params, f.dependencies), first = scan.next(section)
  await expect(scan.next(section)).rejects.toThrow('SECTION_BUSY')
  late.resolve(f[section]()); await first; expect(f.reads[section]).toHaveBeenCalledOnce()
})
it.each(['COMPLETE', 'LIMIT_REACHED'] as const)('all %s states stop future reads without claiming a limit is complete', async status => {
  const f = mySoulsFixture()
  f.reads.owned.mockResolvedValue(f.owned(status)); f.reads.collections.mockResolvedValue(f.collections(status)); f.reads.activity.mockResolvedValue(f.activity(status))
  const scan = createBrowserMySouls(f.params, f.dependencies)
  await Promise.all(MY_SOULS_SECTIONS.map(section => scan.next(section)))
  await Promise.all(MY_SOULS_SECTIONS.map(section => scan.next(section)))
  for (const section of MY_SOULS_SECTIONS) { expect(f.reads[section]).toHaveBeenCalledOnce(); expect(scan.snapshot().progress[section].status).toBe(status) }
  expect(scan.snapshot().portfolio.totals.ownedComplete).toBe(status === 'COMPLETE')
})
it('an activity evidence limit is terminal even when the reducer remains partial', async () => {
  const f = mySoulsFixture(); f.reads.activity.mockResolvedValue({ ...f.activity('PARTIAL'), limitReason: 'EVIDENCE_BYTES_LIMIT' })
  const scan = createBrowserMySouls(f.params, f.dependencies); await scan.next('activity'); await scan.next('activity')
  expect(scan.snapshot().progress.activity).toMatchObject({ status: 'LIMIT_REACHED', limitReason: 'EVIDENCE_BYTES_LIMIT' })
  expect(f.reads.activity).toHaveBeenCalledOnce()
})
it('missing discovery config fails only its channels while Owned still completes', async () => {
  const f = mySoulsFixture(); f.config.discoveryEndpoint = null
  const scan = createBrowserMySouls(f.params, f.dependencies)
  await Promise.all(MY_SOULS_SECTIONS.map(section => scan.next(section)))
  expect(scan.snapshot().progress.owned.status).toBe('COMPLETE')
  for (const section of ['collections', 'activity'] as const) {
    expect(scan.snapshot().progress[section]).toMatchObject({ status: 'UNSCANNED', error: 'MY_SOULS_DISCOVERY_UNAVAILABLE' })
    expect(f.factories[section]).not.toHaveBeenCalled()
  }
})
it('captures config before any lazy reader is created and requires a canonical owner', async () => {
  const f = mySoulsFixture(), expected = structuredClone(f.config)
  expect(() => createBrowserMySouls({ ...f.params, owner: '0x5' }, f.dependencies)).toThrow('canonical')
  const scan = createBrowserMySouls(f.params, f.dependencies)
  f.config.marketConfigId = id(999); f.config.native.soulidityOriginalPackageId = id(998)
  await scan.next('collections')
  expect(f.factories.collections).toHaveBeenCalledWith(expect.objectContaining({ viewerAddress: id(5), deployment: expect.objectContaining({ marketConfigId: expected.marketConfigId, originalPackageId: id(1) }) }))
})
it('rejects cross-wallet candidate pages without replacing already accepted data', async () => {
  const f = mySoulsFixture(), scan = createBrowserMySouls(f.params, f.dependencies)
  f.reads.collections.mockResolvedValueOnce(f.collections('PARTIAL'))
  await scan.next('collections')
  f.reads.collections.mockResolvedValueOnce(mySoulsFixture(id(99)).collections())
  await scan.next('collections')
  expect(scan.snapshot().portfolio.collections[0].creatorAddress).toBe(f.owner)
  expect(scan.snapshot().progress.collections).toMatchObject({ pages: 1, error: 'SOUL_PORTFOLIO_COLLECTION_SCOPE_MISMATCH' })
})
it('bounds an ignored transport by the section deadline and joins the retained flight on retry', async () => {
  const f = mySoulsFixture(), deadline = new AbortController(), late = deferred<ReturnType<typeof f.owned>>()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  f.reads.owned.mockReturnValueOnce(late.promise)
  const scan = createBrowserMySouls(f.params, f.dependencies), first = scan.next('owned')
  await Promise.resolve(); expect(f.reads.owned).toHaveBeenCalledOnce(); deadline.abort(); await first
  expect(scan.snapshot().progress.owned.error).toBe('MY_SOULS_READ_TIMEOUT')
  vi.restoreAllMocks(); const retry = scan.next('owned'); late.resolve(f.owned()); await retry
  expect(f.reads.owned).toHaveBeenCalledOnce(); expect(scan.snapshot().progress.owned.error).toBeNull()
})
it('lifetime cancellation rejects active handoffs and all future reads even when transport resolves late', async () => {
  const f = mySoulsFixture(), late = deferred<ReturnType<typeof f.owned>>()
  f.reads.owned.mockReturnValueOnce(late.promise)
  const scan = createBrowserMySouls(f.params, f.dependencies), read = scan.next('owned'), rejected = expect(read).rejects.toThrow('retired scope')
  await Promise.resolve(); expect(f.reads.owned).toHaveBeenCalledOnce()
  f.lifetime.abort(new Error('retired scope')); await rejected; late.resolve(f.owned()); await late.promise
  expect(() => scan.snapshot()).toThrow('retired scope'); await expect(scan.next('collections')).rejects.toThrow('retired scope')
})
it('rejects invalid sections and already-aborted calls without starting a reader', async () => {
  const f = mySoulsFixture(), scan = createBrowserMySouls(f.params, f.dependencies), abort = new AbortController()
  await expect(scan.next('private' as never)).rejects.toThrow('SECTION_INVALID')
  abort.abort(new Error('paused')); await expect(scan.next('owned', { signal: abort.signal })).rejects.toThrow('paused')
  expect(f.factories.owned).not.toHaveBeenCalled()
})
it('composes the actual Owned inventory, custody and detail readers over the existing raw BCS fixture', async () => {
  const f = mySoulsFixture(), raw = f.raw
  raw.tables.set(raw.state.current_kiosk_id, [{ parent: raw.state.current_kiosk_id,
    fieldId: deriveKioskItemFieldId(raw.state.current_kiosk_id, raw.soul.id), kind: 2, childId: raw.soul.id,
    name: { name: '0x2::kiosk::Item', value: bcs.Address.serialize(raw.soul.id).toBytes() }, valueType: `${id(1)}::soul::Soul` }])
  const scan = createBrowserMySouls(f.params, { ...f.dependencies, owned: createBrowserOwnedSouls })
  await Promise.all(MY_SOULS_SECTIONS.map(section => scan.next(section)))
  expect(scan.snapshot().portfolio.owned[0]).toMatchObject({ onChainId: raw.soul.id, isOwner: true, effectiveGrantCount: '1',
    paidAccessKindConfigs: [expect.objectContaining({ priceAtomic: '9007199254740993' })] })
  expect(scan.snapshot().portfolio.collections).toHaveLength(1); expect(scan.snapshot().portfolio.purchases).toHaveLength(1)
})
it('retains actual Owned hydration of the same inventory cursor after a failed first detail read', async () => {
  const f = mySoulsFixture(), { compose } = await createBrowserSoulDetailModel(false), model = compose()
  const page = { ...f.owned().inventory, expectedItemCount: 1, scannedFields: 1,
    items: [{ itemId: model.onChainId, type: `${id(1)}::soul::Soul`, fieldId: deriveKioskItemFieldId(model.currentKioskId, model.onChainId), version: '1', digest: detailDigest }] }
  const inventoryNext = vi.fn(async () => page), detail = vi.fn(async () => model).mockRejectedValueOnce(new Error('detail offline'))
  const scan = createBrowserMySouls(f.params, { ...f.dependencies,
    owned: (params, deps) => createBrowserOwnedSouls(params, { ...deps, inventory: () => ({ next: inventoryNext }), detail }) })
  await scan.next('owned'); expect(scan.snapshot().progress.owned.error).toBe('detail offline')
  await scan.next('owned'); expect(scan.snapshot().portfolio.owned).toHaveLength(1)
  expect(inventoryNext).toHaveBeenCalledOnce(); expect(detail).toHaveBeenCalledTimes(2)
})
