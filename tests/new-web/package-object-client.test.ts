import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { createRequire } from 'node:module'
import type { UnaryCall as RpcUnaryCall } from '@protobuf-ts/runtime-rpc'
import { PACKAGE_IDENTITY_LIMITS, withPackageObjectIdentity } from '../../web/lib/sui/package-object-client'

// Root and web install separate copies; assert against the public runtime
// resolved by the production web module, not a structurally identical class.
const { UnaryCall } = createRequire(new URL('../../web/package.json', import.meta.url))('@protobuf-ts/runtime-rpc') as typeof import('@protobuf-ts/runtime-rpc')

type Row = NonNullable<Awaited<ReturnType<SuiGrpcClient['ledgerService']['getObject']>>['response']['object']>
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1))
function fixture(n = 40) {
  const data = { data: { Package: { id: id(n), version: '2',
    moduleMap: new Map([['sample', new Uint8Array([1, 2, 3])]]),
    typeOriginTable: [{ moduleName: 'sample', datatypeName: 'Item', package: id(30) }],
    linkageTable: new Map([[id(2), { upgradedId: id(2), upgradedVersion: '0' }]]) } },
  owner: { Immutable: true as const }, previousTransaction: digest, storageRebate: '0' }
  const bytes = bcs.Object.serialize(data).toBytes()
  const row: Row = { objectId: id(n), version: 2n, digest: toBase58(blake2b(
    new Uint8Array([...new TextEncoder().encode('Object::'), ...bytes]), { dkLen: 32 })),
  owner: { kind: 4 }, bcs: { value: bytes }, package: { modules: [], typeOrigins: [], linkage: [] } }
  return { data, row }
}
function setRaw(row: Row, data: ReturnType<typeof fixture>['data']) {
  const bytes = bcs.Object.serialize(data, { maxSize: 5 * 1024 * 1024 }).toBytes()
  row.bcs = { value: bytes }
  row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...bytes]), { dkLen: 32 }))
}
const mask = { paths: ['package'] }
function setup() {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://invalid.example' })
  const calls: RpcUnaryCall[] = []
  function call<I extends object, O extends object>(request: I, response: O | Promise<O>) {
    // Use the real UnaryCall implementation, including its FinishedUnaryCall.
    const result = new UnaryCall({ name: 'Fixture' } as RpcUnaryCall<I, O>['method'], { request: 'header' }, request,
      Promise.resolve({ header: 'original' }), Promise.resolve(response), Promise.resolve({ code: 'OK', detail: '' }),
      Promise.resolve({ trailer: 'original' }))
    calls.push(result); return result
  }
  const rows = new Map([[id(40), fixture().row]])
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(request => call(request, { object: structuredClone(rows.get(request.objectId!)) }))
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(request => call(request, {
    objects: request.requests.map(r => rows.has(r.objectId!)
      ? { result: { oneofKind: 'object' as const, object: structuredClone(rows.get(r.objectId!)!) } }
      : { result: { oneofKind: 'error' as const, error: { code: 5, message: 'not found', details: [] } } }) }))
  const identity = vi.spyOn(client.movePackageService, 'getPackage').mockImplementation(request => call(request, {
    package: { storageId: request.packageId, originalId: id(30), version: 2n, modules: [], typeOrigins: [], linkage: [] } }))
  return { client, rows, get, batch, identity, calls, call }
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('native package identity transport', () => {
  it('authenticates omitted projections, normalizes raw arrays and preserves UnaryCall APIs', async () => {
    const f = setup(), wrapped = withPackageObjectIdentity(f.client)
    const result = wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask })
    expect(result).toBeInstanceOf(UnaryCall)
    expect(result.headers).toBe(f.calls[0].headers); expect(result.status).toBe(f.calls[0].status)
    expect(result.trailers).toBe(f.calls[0].trailers); expect(result.requestHeaders).toBe(f.calls[0].requestHeaders)
    const response = await result.response
    expect((await result).response).toBe(response)
    expect(response.object?.package).toEqual({ storageId: id(40), originalId: id(30), version: 2n,
      modules: [{ name: 'sample', contents: new Uint8Array([1, 2, 3]), functions: [], datatypes: [] }],
      typeOrigins: [{ moduleName: 'sample', datatypeName: 'Item', packageId: id(30) }],
      linkage: [{ originalId: id(2), upgradedId: id(2), upgradedVersion: 0n }] })
    expect(f.identity.mock.calls[0][0]).toEqual({ packageId: id(40) })
    expect(f.identity.mock.calls[0][1]?.abort).toBe(f.get.mock.calls[0][1]?.abort)
    expect(f.get.mock.calls[0][0].readMask?.paths).toEqual(expect.arrayContaining(['object_id', 'version', 'digest', 'owner', 'bcs', 'package']))
    expect(f.rows.get(id(40))?.package?.storageId).toBeUndefined()
  })
  it.each([undefined, { paths: ['object_id', 'contents'] }])('bypasses default/nonpackage masks unchanged: %j', async readMask => {
    const f = setup(), wrapped = withPackageObjectIdentity(f.client), request = { objectId: id(40), readMask }
    const result = wrapped.ledgerService.getObject(request)
    expect(result).toBe(f.calls[0]); await result
    expect(f.get.mock.calls[0][0]).toBe(request); expect(f.identity).not.toHaveBeenCalled()
  })
  it('supports wildcard and partial masks, refuses historical substitution', async () => {
    const f = setup(), wrapped = withPackageObjectIdentity(f.client)
    await wrapped.ledgerService.getObject({ objectId: id(40), readMask: { paths: ['*'] } })
    f.identity.mockImplementation(request => f.call(request, { package: { storageId: id(40), originalId: id(30), version: 3n, modules: [], typeOrigins: [], linkage: [] } }))
    await expect(wrapped.ledgerService.getObject({ objectId: id(40), version: 2n, readMask: { paths: ['package.original_id'] } })).rejects.toThrow('SUPPLEMENT_IDENTITY_MISMATCH')
  })
  it.each([
    ['hash', (row: Row) => { row.digest = digest }],
    ['owner', (row: Row) => { row.owner = { kind: 1, address: id(7) } }],
    ['version', (row: Row) => { row.version = 3n }],
    ['storage projection', (row: Row) => { row.package!.storageId = id(8) }],
    ['version projection', (row: Row) => { row.package!.version = 1n }],
    ['module', (row: Row) => { row.package!.modules = [{ name: 'sample', contents: new Uint8Array([9]), functions: [], datatypes: [] }] }],
    ['origin', (row: Row) => { row.package!.typeOrigins = [{ moduleName: 'sample', datatypeName: 'Item', packageId: id(8) }] }],
    ['link', (row: Row) => { row.package!.linkage = [{ originalId: id(2), upgradedId: id(2), upgradedVersion: 1n }] }],
    ['duplicate', (row: Row) => { row.package!.modules = Array.from({ length: 2 }, () => ({ name: 'sample', functions: [], datatypes: [] })) }],
    ['trailing bytes', (row: Row) => { row.bcs!.value = new Uint8Array([...row.bcs!.value!, 0]) }],
  ] as const)('rejects unauthenticated %s before supplemental transport', async (_, mutate) => {
    const f = setup(); mutate(f.rows.get(id(40))!)
    await expect(withPackageObjectIdentity(f.client).ledgerService.getObject({ objectId: id(40), readMask: mask })).rejects.toThrow('PACKAGE_OBJECT_')
    expect(f.identity).not.toHaveBeenCalled()
  })
  it.each(['original', 'storage', 'version', 'canonical'])('rejects %s supplemental disagreement', async field => {
    const f = setup(); f.rows.get(id(40))!.package!.originalId = id(30)
    f.identity.mockImplementation(request => f.call(request, { package: { storageId: field === 'storage' ? id(41) : id(40),
      originalId: field === 'original' ? id(31) : field === 'canonical' ? '0x1' : id(30),
      version: field === 'version' ? 3n : 2n, modules: [], typeOrigins: [], linkage: [] } }))
    await expect(withPackageObjectIdentity(f.client).ledgerService.getObject({ objectId: id(40), readMask: mask })).rejects.toThrow('PACKAGE_OBJECT_')
  })
  it('keeps server status intact when local authentication rejects response', async () => {
    const f = setup(); f.rows.get(id(40))!.digest = digest
    const result = withPackageObjectIdentity(f.client).ledgerService.getObject({ objectId: id(40), readMask: mask })
    await expect(result.response).rejects.toThrow('DIGEST_MISMATCH')
    await expect(result).rejects.toThrow('DIGEST_MISMATCH')
    expect(await result.status).toEqual({ code: 'OK', detail: '' })
  })
  it('bounds stalled supplementation and aborts without publishing late identity', async () => {
    vi.useFakeTimers()
    const f = setup(), abort = new AbortController()
    f.identity.mockImplementation(request => f.call(request, new Promise(() => {})))
    const first = withPackageObjectIdentity(f.client, abort.signal).ledgerService.getObject({ objectId: id(40), readMask: mask })
    const rejected = expect(first.response).rejects.toThrow('ABORTED')
    await vi.advanceTimersByTimeAsync(0); abort.abort(); await rejected
    const second = withPackageObjectIdentity(f.client).ledgerService.getObject({ objectId: id(40), readMask: mask }, { timeout: 10 })
    const timedOut = expect(second.response).rejects.toThrow('DEADLINE')
    await vi.advanceTimersByTimeAsync(10); await timedOut
    expect(vi.getTimerCount()).toBe(0)
  })
  it('batch preserves error/Move rows and enforces row identity and size', async () => {
    const f = setup(), move = { ...fixture(41).row, package: undefined }
    f.rows.set(id(41), move)
    const wrapped = withPackageObjectIdentity(f.client)
    const call = wrapped.ledgerService.batchGetObjects({ requests: [40, 41, 42].map(n => ({ objectId: id(n) })), readMask: mask })
    expect(call).toBeInstanceOf(UnaryCall)
    const result = await call
    expect(result.response.objects[1].result).toEqual({ oneofKind: 'object', object: move })
    expect(result.response.objects[2].result.oneofKind).toBe('error'); expect(f.identity).toHaveBeenCalledTimes(1)
    await expect(wrapped.ledgerService.batchGetObjects({ requests: [{ objectId: id(40), version: 7n }], readMask: mask })).rejects.toThrow('REQUEST_MISMATCH')
    expect(() => wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 101 }, () => ({ objectId: id(40) })), readMask: mask })).toThrow('BATCH_BUDGET')
  })
  it('shares four supplemental slots across concurrent single and batch calls', async () => {
    const f = setup(), pending: (() => void)[] = []; let active = 0, max = 0
    f.identity.mockImplementation(request => {
      active++; max = Math.max(max, active)
      return f.call(request, new Promise(resolve => pending.push(() => { active--; resolve({ package: {
        storageId: request.packageId, originalId: id(30), version: 2n, modules: [], typeOrigins: [], linkage: [] } }) })))
    })
    const wrapped = withPackageObjectIdentity(f.client)
    const batch = wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 8 }, () => ({ objectId: id(40) })), readMask: mask })
    const single = wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask })
    for (let i = 0; i < 12; i++) { await new Promise(resolve => setTimeout(resolve, 0)); pending.splice(0).forEach(finish => finish()) }
    await Promise.all([batch, single]); expect(max).toBe(PACKAGE_IDENTITY_LIMITS.concurrent); expect(f.identity).toHaveBeenCalledTimes(9)
  })
  it.each(['empty modules', 'module name', 'empty module bytes', 'origin module', 'origin name', 'origin id', 'link id', 'module count', 'origin count', 'link count', 'raw bytes'])('rejects bounded but invalid raw package: %s', async kind => {
    const f = setup(), { data } = fixture(), pkg = data.data.Package
    if (kind === 'empty modules') pkg.moduleMap.clear()
    if (kind === 'module name') pkg.moduleMap.set('bad::name', new Uint8Array([1]))
    if (kind === 'empty module bytes') pkg.moduleMap.set('sample', new Uint8Array())
    if (kind === 'origin module') pkg.typeOriginTable[0].moduleName = 'missing'
    if (kind === 'origin name') pkg.typeOriginTable[0].datatypeName = 'bad::name'
    if (kind === 'origin id') pkg.typeOriginTable[0].package = id(0)
    if (kind === 'link id') pkg.linkageTable.set(id(0), { upgradedId: id(2), upgradedVersion: '0' })
    if (kind === 'module count') pkg.moduleMap = new Map(Array.from({ length: 513 }, (_, i) => [`m${i}`, new Uint8Array([1])]))
    if (kind === 'origin count') pkg.typeOriginTable = Array.from({ length: 4097 }, (_, i) => ({ moduleName: 'sample', datatypeName: `T${i}`, package: id(30) }))
    if (kind === 'link count') pkg.linkageTable = new Map(Array.from({ length: 1025 }, (_, i) => [id(i + 1), { upgradedId: id(i + 1), upgradedVersion: '0' }]))
    if (kind === 'raw bytes') pkg.moduleMap.set('sample', new Uint8Array(PACKAGE_IDENTITY_LIMITS.objectBytes))
    setRaw(f.rows.get(id(40))!, data)
    await expect(withPackageObjectIdentity(f.client).ledgerService.getObject({ objectId: id(40), readMask: mask })).rejects.toThrow('PACKAGE_OBJECT_')
    expect(f.identity).not.toHaveBeenCalled()
  })
  it('rejects additional identity attempts at the explicit session budget without retry', async () => {
    const f = setup(), wrapped = withPackageObjectIdentity(f.client)
    for (let i = 0; i < PACKAGE_IDENTITY_LIMITS.attempts / 100; i++) {
      await wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 100 }, () => ({ objectId: id(40) })), readMask: mask })
    }
    await expect(wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask })).rejects.toThrow('SESSION_BUDGET')
    expect(f.identity).toHaveBeenCalledTimes(PACKAGE_IDENTITY_LIMITS.attempts)
    // Unrelated reads remain available after the package budget is exhausted.
    await wrapped.ledgerService.getObject({ objectId: id(40) })
  }, 30_000)
  it('bounds cumulative authenticated bytes independently of the attempt count', async () => {
    const f = setup(), { data } = fixture()
    data.data.Package.moduleMap.set('sample', new Uint8Array(4 * 1024 * 1024 - 1024).fill(1))
    setRaw(f.rows.get(id(40))!, data)
    const size = f.rows.get(id(40))!.bcs!.value!.length, count = Math.floor(PACKAGE_IDENTITY_LIMITS.totalBytes / size)
    // Do not retain hundreds of full fixture responses in spy call history.
    f.get.mockImplementation(request => f.call(request, { object: f.rows.get(id(40))! }))
    const wrapped = withPackageObjectIdentity(f.client)
    for (let i = 0; i < count; i++) {
      await wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask }); f.calls.length = 0
    }
    await expect(wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask })).rejects.toThrow('SESSION_BUDGET')
    expect(f.identity).toHaveBeenCalledTimes(count); expect(count).toBeLessThan(PACKAGE_IDENTITY_LIMITS.attempts)
    // This intentionally authenticates the full 512 MiB session budget through
    // real BCS parse/serialize + BLAKE2b, not mocked accounting. Shared CI exceeded
    // 30s for the 128 near-4-MiB reads; allow CPU contention without changing the
    // adapter's per-request deadline, byte ceiling, or expected rejection.
  }, 120_000)
  it('cancels queued identity work and preserves the actual remote failure', async () => {
    const f = setup(), abort = new AbortController()
    f.identity.mockImplementation(request => f.call(request, new Promise(() => {})))
    const wrapped = withPackageObjectIdentity(f.client, abort.signal)
    const call = wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 8 }, () => ({ objectId: id(40) })), readMask: mask })
    const rejection = expect(call.response).rejects.toThrow('ABORTED')
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.identity).toHaveBeenCalledTimes(4)
    abort.abort(); await rejection; await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.identity).toHaveBeenCalledTimes(4)
    const failure = new Error('controlled remote UNAVAILABLE')
    f.identity.mockImplementation(request => f.call(request, Promise.reject(failure)))
    await expect(withPackageObjectIdentity(f.client).ledgerService.getObject({ objectId: id(40), readMask: mask })).rejects.toBe(failure)
  })
  it('preserves default batches and authenticates a per-row package mask', async () => {
    const f = setup(), wrapped = withPackageObjectIdentity(f.client)
    const plain = wrapped.ledgerService.batchGetObjects({ requests: [{ objectId: id(40) }] })
    expect(plain).toBe(f.calls[0]); await plain; expect(f.identity).not.toHaveBeenCalled()
    // Model the official service: the parent mask overrides individual masks.
    f.batch.mockImplementation(request => f.call(request, { objects: request.requests.map(row => {
      const source = structuredClone(f.rows.get(row.objectId!)!), paths = request.readMask?.paths ?? ['object_id', 'version', 'digest']
      if (!paths.includes('bcs')) source.bcs = undefined
      if (!paths.includes('package')) source.package = undefined
      return { result: { oneofKind: 'object' as const, object: source } }
    }) }))
    const mixed = await wrapped.ledgerService.batchGetObjects({ requests: [
      { objectId: id(40), readMask: mask }, { objectId: id(40), readMask: { paths: ['object_id', 'contents'] } }],
    readMask: { paths: ['previous_transaction'] } })
    expect(mixed.response.objects[0].result.oneofKind === 'object' && mixed.response.objects[0].result.object.package?.storageId).toBe(id(40))
    expect(f.identity).toHaveBeenCalledTimes(1)
    expect(f.batch.mock.calls.at(-1)?.[0].readMask?.paths).toEqual(expect.arrayContaining(['package', 'bcs', 'contents', 'previous_transaction']))
  })
  it('retains canceled non-cooperative RPC slots until their underlying calls settle', async () => {
    const f = setup(), abort = new AbortController(), pending: (() => void)[] = []
    f.identity.mockImplementation(request => f.call(request, new Promise(resolve => pending.push(() => resolve({ package: {
      storageId: request.packageId, originalId: id(30), version: 2n, modules: [], typeOrigins: [], linkage: [] } })))))
    const wrapped = withPackageObjectIdentity(f.client)
    const first = wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 4 }, () => ({ objectId: id(40) })), readMask: mask }, { abort: abort.signal })
    const rejected = expect(first.response).rejects.toThrow('ABORTED')
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.identity).toHaveBeenCalledTimes(4)
    abort.abort(); await rejected
    const next = wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask })
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.identity).toHaveBeenCalledTimes(4)
    pending.shift()!()
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.identity).toHaveBeenCalledTimes(5)
    pending.splice(0).forEach(settle => settle()); await next
  })
  it('cannot lose a release between a full-slot observation and waiter registration', async () => {
    // Cover each deterministic microtask boundary of the real UnaryCall chain,
    // not a standalone semaphore model or a wall-clock-dependent race.
    const ticks = async (count: number) => { for (let i = 0; i < count; i++) await Promise.resolve() }
    for (let boundary = 0; boundary < 40; boundary++) {
      const f = setup(), abort = new AbortController(), pending: (() => void)[] = []
      f.identity.mockImplementation(request => f.call(request, new Promise(resolve => pending.push(() => resolve({ package: {
        storageId: request.packageId, originalId: id(30), version: 2n, modules: [], typeOrigins: [], linkage: [] } })))))
      const wrapped = withPackageObjectIdentity(f.client, abort.signal)
      const first = wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 4 }, () => ({ objectId: id(40) })), readMask: mask })
      const observed: Promise<unknown>[] = [first.response.catch(() => {})]
      try {
        await ticks(80); expect(f.identity).toHaveBeenCalledTimes(4)
        const initial = pending.splice(0)
        if (boundary < 20) { initial.forEach(settle => settle()); if (boundary) await ticks(boundary - 1) }
        const fifth = wrapped.ledgerService.getObject({ objectId: id(40), readMask: mask })
        observed.push(fifth.response.catch(() => {}))
        if (boundary >= 20) { if (boundary > 20) await ticks(boundary - 21); initial.forEach(settle => settle()) }
        await ticks(100)
        expect(f.identity.mock.calls.length, `microtask boundary ${boundary}`).toBe(5)
        pending.splice(0).forEach(settle => settle()); await Promise.all([first, fifth])
      } finally {
        abort.abort(); pending.splice(0).forEach(settle => settle()); await Promise.all(observed)
      }
    }
  })
  it('hands an available slot onward when the awakened queue head is canceled', async () => {
    const ticks = async (count: number) => { for (let i = 0; i < count; i++) await Promise.resolve() }
    for (let boundary = 0; boundary < 25; boundary++) {
      const f = setup(), parent = new AbortController(), canceled = new AbortController()
      const pending: { id: string | undefined; finish: () => void }[] = []
      f.rows.set(id(41), fixture(41).row); f.rows.set(id(42), fixture(42).row)
      f.identity.mockImplementation(request => f.call(request, new Promise(resolve => pending.push({ id: request.packageId,
        finish: () => resolve({ package: { storageId: request.packageId, originalId: id(30), version: 2n,
          modules: [], typeOrigins: [], linkage: [] } }) }))))
      const wrapped = withPackageObjectIdentity(f.client, parent.signal)
      const first = wrapped.ledgerService.batchGetObjects({ requests: Array.from({ length: 4 }, () => ({ objectId: id(40) })), readMask: mask })
      const observed: Promise<unknown>[] = [first.response.catch(() => {})]
      try {
        await ticks(80)
        const head = wrapped.ledgerService.getObject({ objectId: id(41), readMask: mask }, { abort: canceled.signal })
        const tail = wrapped.ledgerService.getObject({ objectId: id(42), readMask: mask })
        observed.push(head.response.catch(() => {}), tail.response.catch(() => {}))
        await ticks(80); expect(f.identity).toHaveBeenCalledTimes(4)
        pending.shift()!.finish()
        if (boundary) await ticks(boundary - 1)
        canceled.abort(); await ticks(80)
        // If the head obtained a real RPC before cancellation, finish that
        // actual transport before expecting another slot, per the prior guard.
        pending.filter(row => row.id === id(41)).forEach(row => row.finish())
        await ticks(80)
        expect(f.identity.mock.calls.some(([request]) => request.packageId === id(42)), `cancel boundary ${boundary}`).toBe(true)
      } finally { parent.abort(); pending.forEach(row => row.finish()); await Promise.all(observed) }
    }
  })
})
