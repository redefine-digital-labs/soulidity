import { afterEach, describe, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { UnaryCall, type RpcTransport } from '@protobuf-ts/runtime-rpc'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { readPrivateWalletBookmarksHead } from '../../packages/soulidity-sdk/src/private-wallet-bookmarks-read'
import { privateWalletBookmarksFixture, bookmarkId } from './fixtures/private-wallet-bookmarks'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('reads a verified package, stable registry and exact owner field without Profile/asset dependencies', async () => {
  const f = privateWalletBookmarksFixture(), result = await f.read()
  expect(result).toMatchObject({ scope: f.scope, revision: '2', emptyReason: null, registryVersion: '3',
    headFieldId: f.headFieldId, head: { ciphertext: f.ref, receipts: [{ requestId: '01'.repeat(32), revision: '1' }, { revision: '2' }] } })
  expect(f.get).toHaveBeenCalledTimes(1)
  expect(f.get.mock.calls[0][0]).toMatchObject({ objectId: f.deployment.callablePackageId })
  expect(f.batch).toHaveBeenCalledTimes(4)
  expect(f.batch.mock.calls.map(([request]) => request.requests[0].objectId)).toEqual([
    f.scope.registryId, f.headFieldId, f.headFieldId, f.scope.registryId,
  ])
  expect(f.fetcher).not.toHaveBeenCalled()
  expect(f.registry.profile_count).toBe('0')
  expect(JSON.stringify(result)).not.toMatch(/"name"|"count"|plaintext|secret|soulId|profileId/)
  expect([result, result.scope, result.head, result.head?.receipts, result.head?.receipts[0], result.head?.ciphertext].every(Object.isFrozen)).toBe(true)
  expect(f.batch.mock.calls.every(([_request, opts]) => opts?.abort instanceof AbortSignal)).toBe(true)
  expect(f.batch.mock.calls[0][0].readMask?.paths).toContain('bcs')
})

it('accepts only reread NOT_FOUND as absent and isolates switch-away/back without a profile', async () => {
  const f = privateWalletBookmarksFixture(), owner = f.scope.owner
  f.scope.owner = bookmarkId(99)
  expect(await f.read()).toMatchObject({ revision: '0', head: null, emptyReason: 'ABSENT', headFieldVersion: null })
  f.scope.owner = owner
  expect(await f.read()).toMatchObject({ revision: '2', emptyReason: null })
  f.rows.delete(f.headFieldId)
  expect(await f.read()).toMatchObject({ revision: '0', head: null, emptyReason: 'ABSENT', headFieldDigest: null })
})

it.each(['version', 'owner', 'registry', 'revision-zero', 'key-version', 'key-owner', 'field-id'] as const)(
  'rejects rehashed Head/DF scope mismatch %s', async problem => {
    const f = privateWalletBookmarksFixture()
    if (problem === 'version') f.head.version = 2
    if (problem === 'owner') f.head.owner = bookmarkId(99)
    if (problem === 'registry') f.head.registry_id = bookmarkId(99)
    if (problem === 'revision-zero') f.head.revision = '0'
    if (problem === 'key-version') f.headField.name.version = 2
    if (problem === 'key-owner') f.headField.name.owner = bookmarkId(99)
    if (problem === 'field-id') f.headField.id = bookmarkId(99)
    f.putHead(); await expect(f.read()).rejects.toThrow('HEAD_SCOPE_MISMATCH')
  })

it.each(['uid', 'schema', 'by-owner', 'by-index', 'by-handle', 'zero-table', 'alias'] as const)(
  'rejects rehashed registry %s rather than treating it as an empty owner directory', async problem => {
    const f = privateWalletBookmarksFixture()
    if (problem === 'uid') f.registry.id = bookmarkId(99)
    if (problem === 'schema') f.registry.version = '2'
    if (problem === 'by-owner') f.registry.by_owner.size = '1'
    if (problem === 'by-index') f.registry.by_index.size = '1'
    if (problem === 'by-handle') f.registry.by_handle.size = '1'
    if (problem === 'zero-table') f.registry.by_handle.id = bookmarkId(0)
    if (problem === 'alias') f.registry.by_index.id = f.registry.by_owner.id
    f.putRegistry(); await expect(f.read()).rejects.toThrow()
  })

it.each(['id', 'type', 'digest', 'missing-full-bcs', 'wrong-hash', 'contents-projection', 'object-version', 'parent-projection',
  'parent-bcs', 'shared-birth', 'public-transfer', 'trailing', 'oversized'] as const)(
  'rejects full Object envelope mismatch %s', async problem => {
    const f = privateWalletBookmarksFixture(), row = f.rows.get(f.headFieldId), object = f.objects.get(f.headFieldId)!
    if (problem === 'id') row.objectId = bookmarkId(99)
    if (problem === 'type') row.objectType = `${bookmarkId(99)}::profile::BookmarksHeadV1`
    if (problem === 'digest') row.digest = 'invalid'
    if (problem === 'missing-full-bcs') delete row.bcs
    if (problem === 'wrong-hash') { object.storageRebate = '1'; row.bcs.value = bcs.Object.serialize(object).toBytes() }
    if (problem === 'contents-projection') row.contents.value = new Uint8Array([1])
    if (problem === 'object-version') row.version = 4n
    if (problem === 'parent-projection') row.owner.address = bookmarkId(99)
    if (problem === 'parent-bcs') { object.owner = { ObjectOwner: bookmarkId(99), $kind: 'ObjectOwner' }; f.rehashObject(f.headFieldId) }
    if (problem === 'shared-birth') {
      const registry = f.objects.get(f.scope.registryId)!
      registry.owner = { Shared: { initialSharedVersion: '4' }, $kind: 'Shared' }; f.rehashObject(f.scope.registryId)
    }
    if (problem === 'public-transfer') { object.data.Move!.hasPublicTransfer = true; f.rehashObject(f.headFieldId) }
    if (problem === 'trailing') row.bcs.value = new Uint8Array([...row.bcs.value, 0])
    if (problem === 'oversized') row.bcs.value = new Uint8Array(17 * 1024)
    await expect(f.read()).rejects.toThrow()
  })

it.each(['registry', 'head'] as const)('rejects rehashed trailing typed contents %s', async target => {
  const f = privateWalletBookmarksFixture(), objectId = target === 'registry' ? f.scope.registryId : f.headFieldId
  const object = f.objects.get(objectId)!
  object.data.Move!.contents = new Uint8Array([...object.data.Move!.contents, 0]); f.rehashObject(objectId)
  await expect(f.read()).rejects.toThrow('NONCANONICAL_BCS')
})

describe('configured package full-BCS type-origin authority', () => {
  it.each(['whole', 'storageId', 'originalId', 'version'])('allows absent redundant package projection %s', async field => {
    const f = privateWalletBookmarksFixture(), row = f.rows.get(f.deployment.callablePackageId)
    row.package = { storageId: f.deployment.callablePackageId, originalId: f.deployment.originalPackageId, version: 2n }
    if (field === 'whole') delete row.package
    else delete row.package[field]
    expect((await f.read()).revision).toBe('2')
  })
  it('uses full Move BCS when redundant contents projections are absent', async () => {
    const f = privateWalletBookmarksFixture()
    for (const row of f.rows.values()) delete row.contents
    expect((await f.readCiphertext()).ciphertext).toEqual(f.ciphertext)
  })
  it.each(['digest', 'storageId', 'originalId', 'version', 'owner'])('rejects package projection contradiction %s', async field => {
    const f = privateWalletBookmarksFixture(), row = f.rows.get(f.deployment.callablePackageId)
    if (field === 'digest') row.digest = f.rows.get(f.headFieldId).digest
    else if (field === 'owner') row.owner.kind = 1
    else row.package[field] = field === 'version' ? 99n : bookmarkId(99)
    await expect(f.read()).rejects.toThrow()
  })
  it.each(['origin', 'missing-origin', 'duplicate-origin', 'id', 'version', 'immutable', 'module-name', 'link-id'] as const)(
    'rejects rehashed package semantic contradiction %s even when configured digest follows it', async problem => {
      const f = privateWalletBookmarksFixture(), pkg = f.packageData.data.Package!
      if (problem === 'origin') pkg.typeOriginTable[1].package = bookmarkId(99)
      if (problem === 'missing-origin') pkg.typeOriginTable.pop()
      if (problem === 'duplicate-origin') pkg.typeOriginTable.push(structuredClone(pkg.typeOriginTable[0]))
      if (problem === 'id') pkg.id = bookmarkId(99)
      if (problem === 'version') pkg.version = '0'
      if (problem === 'immutable') f.packageData.owner = { AddressOwner: bookmarkId(99), $kind: 'AddressOwner' }
      if (problem === 'module-name') pkg.moduleMap.set('_', new Uint8Array([1]))
      if (problem === 'link-id') pkg.linkageTable.set(bookmarkId(0), { upgradedId: bookmarkId(1), upgradedVersion: '0' })
      f.putPackage(); await expect(f.read()).rejects.toThrow()
    })
})

it.each(['empty', 'missing-row', 'duplicate-request', 'bad-revision', 'bad-request', 'bad-hash', 'head-ref', 'over-budget'] as const)(
  'rejects invalid bounded receipt history %s', async problem => {
    const f = privateWalletBookmarksFixture()
    if (problem === 'empty') f.head.receipts = []
    if (problem === 'missing-row') f.head.receipts.pop()
    if (problem === 'duplicate-request') f.head.receipts[1].request_id = f.head.receipts[0].request_id
    if (problem === 'bad-revision') f.head.receipts[0].revision = '2'
    if (problem === 'bad-request') f.head.receipts[0].request_id = Array(32).fill(0)
    if (problem === 'bad-hash') f.head.receipts[0].ciphertext.sha256 = Array(31).fill(1)
    if (problem === 'head-ref') f.head.ciphertext.blob_object_id = bookmarkId(99)
    if (problem === 'over-budget') f.head.receipts[0].ciphertext.byte_length = '16777217'
    f.putHead(); await expect(f.read()).rejects.toThrow()
  })

it('retains exactly 32 bounded receipts and lossless u64 maximum revision', async () => {
  const f = privateWalletBookmarksFixture(), max = 18446744073709551615n
  f.head.revision = String(max)
  f.head.receipts = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(f.head.receipts[1]),
    revision: String(max - 31n + BigInt(i)), request_id: Array(32).fill(i + 1) }))
  f.putHead()
  const result = await f.read()
  expect(result.revision).toBe(String(max)); expect(result.head?.receipts[0].revision).toBe(String(max - 31n))
  f.head.receipts.push(structuredClone(f.head.receipts[0])); f.putHead()
  await expect(f.read()).rejects.toThrow('RECEIPT_WINDOW_MISMATCH')
})

it.each([undefined, 0, 3, 7, 13, 14])('does not treat optional error status %s as NOT_FOUND', async code => {
  const f = privateWalletBookmarksFixture(), original = f.batch.getMockImplementation()!
  f.batch.mockImplementation(((args: any, opts: any) => args.requests[0].objectId === f.headFieldId
    ? Promise.resolve({ response: { objects: [{ result: { oneofKind: 'error', error: { code } } }] } }) : original(args, opts)) as any)
  await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it('rejects unavailable/malformed mandatory responses and raw transport exceptions', async () => {
  const f = privateWalletBookmarksFixture()
  f.batch.mockRejectedValueOnce(new Error('transport unavailable')); await expect(f.read()).rejects.toThrow('transport unavailable')
  f.batch.mockResolvedValueOnce({ response: { objects: [] } } as any); await expect(f.read()).rejects.toThrow('INCOMPLETE_RESPONSE')
  f.batch.mockResolvedValueOnce({ response: { objects: [{ result: { oneofKind: 'error', error: { code: 5 } } }] } } as any)
  await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
  f.rows.delete(f.headFieldId); f.get.mockResolvedValueOnce({ response: {} } as any)
  await expect(f.read()).rejects.toThrow('PACKAGE_REFERENCE_MISMATCH')
})

it.each(['registry', 'head', 'absence', 'disappears'] as const)('rejects changed stable read-set %s', async problem => {
  const f = privateWalletBookmarksFixture(), original = f.batch.getMockImplementation()!
  if (problem === 'absence') f.rows.delete(f.headFieldId)
  let registryReads = 0, headReads = 0
  f.batch.mockImplementation(((args: any, opts: any) => {
    const wanted = args.requests[0].objectId
    if (wanted === f.scope.registryId && ++registryReads === 2 && problem === 'registry') {
      f.objects.get(wanted)!.data.Move!.version = '4'; f.rehashObject(wanted)
    }
    if (wanted === f.headFieldId && ++headReads === 2) {
      if (problem === 'head') { f.objects.get(wanted)!.data.Move!.version = '4'; f.rehashObject(wanted) }
      if (problem === 'absence') f.putHead()
      if (problem === 'disappears') f.rows.delete(f.headFieldId)
    }
    return original(args, opts)
  }) as any)
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})

it('rejects a wrong chain before consulting package or interpreting absence', async () => {
  const f = privateWalletBookmarksFixture(); f.deployment.chainIdentifier = 'ffffffff'
  await expect(f.read()).rejects.toThrow('WRONG_CHAIN')
  expect(f.get).not.toHaveBeenCalled(); expect(f.batch).not.toHaveBeenCalled()
})
it.each(['chain', 'package', 'registry', 'head'] as const)('cancels an abort-ignoring %s transport without returning late data', async stage => {
  const f = privateWalletBookmarksFixture()
  let resolve!: (value: any) => void
  const hang = () => new Promise(done => { resolve = done })
  if (stage === 'chain') f.chain.mockImplementationOnce(hang as any)
  if (stage === 'package') f.get.mockImplementationOnce(hang as any)
  if (stage === 'registry' || stage === 'head') {
    const original = f.batch.getMockImplementation()!
    f.batch.mockImplementation(((args: any, opts: any) => args.requests[0].objectId === (stage === 'head' ? f.headFieldId : f.scope.registryId)
      ? hang() : original(args, opts)) as any)
  }
  const controller = new AbortController(), pending = f.read(controller.signal)
  while (!resolve) await Promise.resolve()
  controller.abort(new Error('wallet changed'))
  await expect(pending).rejects.toThrow('wallet changed')
  resolve({ response: { objects: [] } }); await Promise.resolve()
})
it('owns a bounded deadline even when a client ignores all abort options', async () => {
  const f = privateWalletBookmarksFixture(), timeout = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { expect(ms).toBe(40000); return timeout.signal })
  f.chain.mockImplementationOnce(() => new Promise(() => {}))
  const pending = f.read()
  timeout.abort(new DOMException('read timed out', 'TimeoutError'))
  await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
})

it('executes actual SDK UnaryCall transport with full BCS masks and no discovery/indexer', async () => {
  const f = privateWalletBookmarksFixture(), calls: UnaryCall<any, any>[] = []
  const transport: RpcTransport = {
    mergeOptions: options => ({ ...options }),
    unary(method, request: any, options) {
      expect(['getObject', 'batchGetObjects']).toContain(method.localName)
      expect(options.abort).toBeInstanceOf(AbortSignal); expect(request.readMask.paths).toContain('bcs')
      const response = method.localName === 'getObject' ? { object: structuredClone(f.rows.get(request.objectId)) }
        : { objects: request.requests.map((row: any) => ({ result: { oneofKind: 'object', object: structuredClone(f.rows.get(row.objectId)) } })) }
      const call = new UnaryCall(method, options.meta ?? {}, request, Promise.resolve({}), Promise.resolve(response as any),
        Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}))
      calls.push(call); return call
    },
    serverStreaming() { throw new Error('unexpected streaming') }, clientStreaming() { throw new Error('unexpected streaming') },
    duplex() { throw new Error('unexpected streaming') },
  }
  const client = new SuiGrpcClient({ network: 'mainnet', transport })
  vi.spyOn(client.core, 'getChainIdentifier').mockImplementation(f.client.core.getChainIdentifier.bind(f.client.core))
  expect(await readPrivateWalletBookmarksHead({ client, deployment: f.deployment, scope: f.scope })).toMatchObject({ revision: '2' })
  expect(calls).toHaveLength(5); expect(calls.every(call => call instanceof UnaryCall)).toBe(true)
})

describe('certified ciphertext reads', () => {
  it('checks full raw Blob identity, fresh Walrus epoch and exact bytes before/after download', async () => {
    const f = privateWalletBookmarksFixture(), result = await f.readCiphertext()
    expect(result.ciphertext).toEqual(f.ciphertext); expect(result.storageEndEpoch).toBe(10)
    expect(f.freshWalrusState).toHaveBeenCalledTimes(2); expect(f.get).toHaveBeenCalledTimes(4); expect(f.batch).toHaveBeenCalledTimes(8)
    expect(f.fetcher).toHaveBeenCalledWith(`${f.storage.aggregatorUrl}/v1/blobs/${f.ref.blobId}`, expect.objectContaining({
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal),
    }))
  })
  it('returns no bytes only for a proven empty scope, never fetching an old wallet document', async () => {
    const f = privateWalletBookmarksFixture(); f.scope.owner = bookmarkId(99)
    expect(await f.readCiphertext()).toMatchObject({ snapshot: { revision: '0' }, ciphertext: null, storageEndEpoch: null })
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.get.mock.calls.every(([request]) => request.objectId === f.deployment.callablePackageId)).toBe(true)
  })
  it.each(['type', 'id', 'blob-id', 'size', 'encoding', 'uncertified', 'future-cert', 'expired', 'storage-alias', 'full-hash', 'trailing'] as const)(
    'rejects raw/rehashed Blob contradiction %s without downloading', async problem => {
      const f = privateWalletBookmarksFixture()
      if (problem === 'id') f.blob.id = bookmarkId(99)
      if (problem === 'blob-id') f.blob.blob_id = '1'
      if (problem === 'size') f.blob.size = '5'
      if (problem === 'encoding') f.blob.encoding_type = 2
      if (problem === 'uncertified') f.blob.certified_epoch = null
      if (problem === 'future-cert') f.blob.certified_epoch = 4
      if (problem === 'expired') f.blob.storage.end_epoch = 3
      if (problem === 'storage-alias') f.blob.storage.id = f.blob.id
      f.putBlob()
      if (problem === 'type') f.rows.get(f.ref.blobObjectId).objectType = `${bookmarkId(99)}::blob::Blob`
      if (problem === 'full-hash') {
        const obj = f.objects.get(f.ref.blobObjectId)!; obj.storageRebate = '1'
        f.rows.get(f.ref.blobObjectId).bcs.value = bcs.Object.serialize(obj).toBytes()
      }
      if (problem === 'trailing') {
        const obj = f.objects.get(f.ref.blobObjectId)!; obj.data.Move!.contents = new Uint8Array([...obj.data.Move!.contents, 0]); f.rehashObject(f.ref.blobObjectId)
      }
      await expect(f.readCiphertext()).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled()
    })
  it.each(['wrong-type', 'fractional', 'negative', 'overflow', 'regression', 'expires-during-read', 'unavailable'] as const)(
    'never substitutes a cached/Sui epoch for invalid fresh Walrus state %s', async problem => {
      const f = privateWalletBookmarksFixture()
      if (problem === 'wrong-type') f.freshWalrusState.mockResolvedValue({ blobType: `${bookmarkId(99)}::blob::Blob`, epoch: 3 })
      if (problem === 'fractional') f.freshWalrusState.mockResolvedValue({ blobType: f.storage.blobType, epoch: 3.5 })
      if (problem === 'negative') f.freshWalrusState.mockResolvedValue({ blobType: f.storage.blobType, epoch: -1 })
      if (problem === 'overflow') f.freshWalrusState.mockResolvedValue({ blobType: f.storage.blobType, epoch: 0x1_0000_0000 })
      if (problem === 'regression') f.freshWalrusState.mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 3 })
        .mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 2 })
      if (problem === 'expires-during-read') f.freshWalrusState.mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 3 })
        .mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 10 })
      if (problem === 'unavailable') f.freshWalrusState.mockRejectedValue(new Error('Walrus state unavailable'))
      await expect(f.readCiphertext()).rejects.toThrow()
    })
  it.each(['status', 'missing-body', 'short', 'long', 'header', 'hash', 'blob-change', 'head-change', 'registry-change'] as const)(
    'rejects download or final readback %s', async problem => {
      const f = privateWalletBookmarksFixture()
      f.fetcher.mockImplementation(async () => {
        if (problem === 'status') return new Response('failed', { status: 503 })
        if (problem === 'missing-body') return new Response(null)
        if (problem === 'short') return new Response(new Uint8Array([1]))
        if (problem === 'long') return new Response(new Uint8Array(5))
        if (problem === 'header') return new Response(new Uint8Array(f.ciphertext), { headers: { 'content-length': '04' } })
        if (problem === 'hash') return new Response(new Uint8Array(4))
        const changed = problem === 'blob-change' ? f.ref.blobObjectId : problem === 'head-change' ? f.headFieldId
          : problem === 'registry-change' ? f.scope.registryId : null
        if (changed) { f.objects.get(changed)!.data.Move!.version = '4'; f.rehashObject(changed) }
        return new Response(new Uint8Array(f.ciphertext))
      })
      await expect(f.readCiphertext()).rejects.toThrow()
    })
  it('snapshots scope/deployment/storage before async work and rejects no-change lifetime assumptions', async () => {
    const f = privateWalletBookmarksFixture(), owner = f.scope.owner, blobType = f.storage.blobType
    f.freshWalrusState.mockImplementation(async () => ({ blobType, epoch: 3 }))
    const pending = f.readCiphertext()
    f.scope.owner = bookmarkId(99); f.deployment.originalPackageId = bookmarkId(99); f.storage.aggregatorUrl = 'https://wrong.example.com'
    const result = await pending
    expect(result.snapshot.scope.owner).toBe(owner)
    expect(f.fetcher.mock.calls[0][0]).toBe(`https://walrus.example.com/v1/blobs/${f.ref.blobId}`)
  })
  it('owns late resolved and rejected fetches after cancellation', async () => {
    const f = privateWalletBookmarksFixture(), cancel = vi.fn()
    let resolve!: (response: Response) => void
    f.fetcher.mockImplementation(() => new Promise(done => { resolve = done }))
    const controller = new AbortController(), pending = f.readCiphertext({ signal: controller.signal })
    while (!resolve) await Promise.resolve()
    controller.abort(new Error('closed')); await expect(pending).rejects.toThrow('closed')
    resolve(new Response(new ReadableStream({ cancel }))); await new Promise(done => setImmediate(done))
    expect(cancel).toHaveBeenCalledTimes(1)
    let reject!: (error: Error) => void
    f.fetcher.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const next = new AbortController(), again = f.readCiphertext({ signal: next.signal })
    while (!reject) await Promise.resolve()
    next.abort(new Error('cancelled')); await expect(again).rejects.toThrow('cancelled')
    reject(new Error('late transport rejection')); await new Promise(done => setImmediate(done))
  })
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('owns the fetch-to-reader cancellation handoff at microtask %i', async delay => {
    const f = privateWalletBookmarksFixture(), controller = new AbortController(), cancel = vi.fn()
    const response = new Response(new ReadableStream({ pull() {}, cancel })), cancelBody = vi.spyOn(response.body!, 'cancel')
    f.fetcher.mockImplementation(async () => {
      const abort = (left: number) => queueMicrotask(() => left ? abort(left - 1) : controller.abort(new Error('handoff aborted')))
      abort(delay); return response
    })
    await expect(f.readCiphertext({ signal: controller.signal })).rejects.toThrow('handoff aborted')
    await new Promise(done => setImmediate(done))
    expect(cancel).toHaveBeenCalledTimes(1); expect(cancelBody.mock.calls.length).toBeLessThanOrEqual(1)
    expect(response.body!.locked).toBe(false)
  })
  it.each(['http://walrus.example.com', 'https://user:secret@walrus.example.com', 'https://walrus.example.com?key=secret', 'https://walrus.example.com#secret'])(
    'rejects insecure/credential-bearing storage config', async aggregatorUrl => {
      const f = privateWalletBookmarksFixture()
      await expect(f.readCiphertext({ storage: { ...f.storage, aggregatorUrl } })).rejects.toThrow('INVALID_STORAGE_URL')
      expect(f.freshWalrusState).not.toHaveBeenCalled()
    })
})
