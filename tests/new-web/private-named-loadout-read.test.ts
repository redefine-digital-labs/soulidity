import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnaryCall, type RpcTransport } from '@protobuf-ts/runtime-rpc'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { readPrivateNamedLoadoutHead } from '../../packages/soulidity-sdk/src/private-named-loadout-read'
import { privateNamedLoadoutFixture, privateId } from './fixtures/private-named-loadout'
import { deriveKioskItemFieldId } from '../../packages/soulidity-sdk/src/kiosk-item-custody'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('reads exact raw constant head, scope and receipt window without touching equipment or private data', async () => {
  const f = privateNamedLoadoutFixture(), result = await f.read()
  expect(result).toMatchObject({ scope: f.scope, revision: '2', emptyReason: null, headFieldId: f.headFieldId,
    head: { ciphertext: f.ref, receipts: [{ requestId: '01'.repeat(32), revision: '1', capture: f.capture }, { revision: '2', capture: null }] } })
  expect(f.batch).toHaveBeenCalledTimes(10)
  expect(f.get).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toMatch(/"name"|"count"|plaintext|secret/)
  expect(Object.isFrozen(result.head?.receipts)).toBe(true)
  expect(f.batch.mock.calls.every(([_request, opts]) => opts?.abort instanceof AbortSignal)).toBe(true)
})

it('treats proven absence and a prior owner epoch as revision zero, including transfer-back', async () => {
  const f = privateNamedLoadoutFixture()
  f.rows.delete(f.headFieldId)
  expect(await f.read()).toMatchObject({ revision: '0', head: null, emptyReason: 'ABSENT', headFieldVersion: null })
  f.head.ownership_epoch = '1'; f.head.owner = privateId(99); f.putHead()
  expect(await f.read()).toMatchObject({ revision: '0', head: null, emptyReason: 'PRIOR_EPOCH', headFieldVersion: '3' })
  f.head.owner = f.scope.owner; f.putHead()
  expect(await f.read()).toMatchObject({ revision: '0', head: null, emptyReason: 'PRIOR_EPOCH' })
})

it.each(['future', 'same-epoch-owner', 'soul', 'state', 'version', 'revision-zero'] as const)('rejects impossible head scope %s', async problem => {
  const f = privateNamedLoadoutFixture()
  if (problem === 'future') f.head.ownership_epoch = '3'
  if (problem === 'same-epoch-owner') f.head.owner = privateId(99)
  if (problem === 'soul') f.head.soul_id = privateId(99)
  if (problem === 'state') f.head.state_id = privateId(99)
  if (problem === 'version') f.head.version = 2
  if (problem === 'revision-zero') f.head.revision = '0'
  f.putHead(); await expect(f.read()).rejects.toThrow()
})

it.each(['owner', 'epoch', 'soul', 'state-id', 'schema', 'royalty', 'counter', 'alias'] as const)('rejects raw State %s', async problem => {
  const f = privateNamedLoadoutFixture()
  if (problem === 'owner') f.state.current_owner = privateId(99)
  if (problem === 'epoch') f.state.ownership_epoch = '3'
  if (problem === 'soul') f.state.soul_id = privateId(99)
  if (problem === 'state-id') f.state.id = privateId(99)
  if (problem === 'schema') f.state.version = '2'
  if (problem === 'royalty') f.state.creator_royalty_bps = 10001
  if (problem === 'counter') f.state.active_grant_count = '1'
  if (problem === 'alias') f.state.config_ext.id = f.state.current_kiosk_id
  if (problem === 'state-id') {
    f.putState(); f.rows.set(f.scope.stateId, f.rows.get(privateId(99)))
  } else f.putState()
  await expect(f.read()).rejects.toThrow()
})

it.each(['type', 'id', 'parent', 'digest', 'object-version', 'birth', 'trailing', 'budget', 'field-key', 'field-id'] as const)(
  'rejects raw DF envelope or BCS mismatch %s', async problem => {
    const f = privateNamedLoadoutFixture()
    if (problem === 'field-key') { f.headField.name.version = 2; f.putHead() }
    if (problem === 'field-id') { f.headField.id = privateId(99); f.putHead() }
    const row = f.rows.get(f.headFieldId)
    if (problem === 'type') row.objectType = `${privateId(99)}::soul::HeadV1`
    if (problem === 'id') row.objectId = privateId(99)
    if (problem === 'parent') row.owner.address = f.scope.soulId
    if (problem === 'digest') row.digest = 'invalid'
    if (problem === 'object-version') row.version = 0n
    if (problem === 'birth') f.rows.get(f.scope.stateId).owner.version = 4n
    if (problem === 'trailing') row.contents.value = new Uint8Array([...row.contents.value, 0])
    if (problem === 'budget') row.contents.value = new Uint8Array(16 * 1024 + 1)
    await expect(f.read()).rejects.toThrow()
  })

it.each(['pointer-owner', 'pointer-value', 'pointer-key', 'soul-custody', 'soul-creator'] as const)('rejects identity linkage %s', async problem => {
  const f = privateNamedLoadoutFixture()
  if (problem === 'pointer-owner') f.rows.get(f.pointerId).owner.address = f.scope.stateId
  if (problem === 'pointer-value') { f.pointer.value = privateId(99); f.putPointer() }
  if (problem === 'pointer-key') { f.pointer.name.version = 2; f.putPointer() }
  if (problem === 'soul-custody') f.rows.get(f.scope.soulId).owner.address = privateId(99)
  if (problem === 'soul-creator') { f.soul.creator = privateId(99); f.putSoul() }
  await expect(f.read()).rejects.toThrow()
})

it.each(['empty', 'missing-row', 'duplicate-request', 'bad-revision', 'bad-request', 'bad-hash', 'head-ref', 'capture-hash'] as const)(
  'rejects invalid bounded receipt history %s even for prior epochs', async problem => {
    const f = privateNamedLoadoutFixture(); f.head.ownership_epoch = '1'
    if (problem === 'empty') f.head.receipts = []
    if (problem === 'missing-row') f.head.receipts.pop()
    if (problem === 'duplicate-request') f.head.receipts[1].request_id = f.head.receipts[0].request_id
    if (problem === 'bad-revision') f.head.receipts[0].revision = '2'
    if (problem === 'bad-request') f.head.receipts[0].request_id = Array(32).fill(0)
    if (problem === 'bad-hash') f.head.receipts[0].ciphertext.sha256 = Array(31).fill(1)
    if (problem === 'head-ref') f.head.ciphertext.blob_object_id = privateId(99)
    if (problem === 'capture-hash') f.head.receipts[0].capture!.commitment = Array(32).fill(0)
    f.putHead(); await expect(f.read()).rejects.toThrow()
  })

it('keeps u64 head/receipt/epoch values lossless beyond Number.MAX_SAFE_INTEGER', async () => {
  const f = privateNamedLoadoutFixture(), max = 18446744073709551615n
  f.scope.ownershipEpoch = String(max); f.state.ownership_epoch = String(max); f.head.ownership_epoch = String(max)
  f.head.revision = String(max)
  f.head.receipts = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(f.head.receipts[1]),
    revision: String(max - 31n + BigInt(i)), request_id: Array(32).fill(i + 1) }))
  f.putState(); f.putHead()
  const result = await f.read()
  expect(result.revision).toBe(String(max)); expect(result.head?.receipts[0].revision).toBe(String(max - 31n))
})

it('does not turn transport errors or malformed optional results into absence', async () => {
  const f = privateNamedLoadoutFixture()
  f.batch.mockRejectedValueOnce(new Error('transport unavailable'))
  await expect(f.read()).rejects.toThrow('transport unavailable')
  const original = f.batch.getMockImplementation()!
  f.batch.mockImplementation(((args: any, opts: any) => args.requests[0].objectId === f.headFieldId
    ? Promise.resolve({ response: { objects: [{ result: { oneofKind: 'error', error: { code: 14 } } }] } })
    : original(args, opts)) as any)
  await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
  f.batch.mockResolvedValueOnce({ response: { objects: [] } } as any)
  await expect(f.read()).rejects.toThrow('INCOMPLETE_RESPONSE')
})

it.each(['state', 'head', 'absence'] as const)('rejects changed read-set %s instead of returning mixed evidence', async problem => {
  const f = privateNamedLoadoutFixture(), original = f.batch.getMockImplementation()!
  if (problem === 'absence') f.rows.delete(f.headFieldId)
  let stateReads = 0, headReads = 0
  f.batch.mockImplementation(((args: any, opts: any) => {
    const wanted = args.requests[0].objectId
    if (wanted === f.scope.stateId && ++stateReads === 2 && problem === 'state') f.rows.get(wanted).version = 4n
    if (wanted === f.headFieldId && ++headReads === 2) {
      if (problem === 'head') f.rows.get(wanted).version = 4n
      if (problem === 'absence') f.putHead()
    }
    return original(args, opts)
  }) as any)
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})

it('rejects wrong chain and cancels a transport that ignores abort without publishing late data', async () => {
  const f = privateNamedLoadoutFixture()
  f.deployment.chainIdentifier = 'ffffffff'; await expect(f.read()).rejects.toThrow('WRONG_CHAIN')
  f.deployment.chainIdentifier = '01010101'
  let resolve!: (value: any) => void
  f.batch.mockImplementationOnce((() => new Promise(done => { resolve = done })) as any)
  const controller = new AbortController(), pending = f.read(controller.signal)
  while (!resolve) await Promise.resolve()
  controller.abort(new Error('wallet changed'))
  await expect(pending).rejects.toThrow('wallet changed')
  resolve({ response: { objects: [] } }); await Promise.resolve()
})

it('executes the raw reader through real SDK UnaryCall transport and preserves abort options', async () => {
  const f = privateNamedLoadoutFixture(), calls: UnaryCall<any, any>[] = []
  const transport: RpcTransport = {
    mergeOptions: options => ({ ...options }),
    unary(method, request: any, options) {
      expect(method.localName).toBe('batchGetObjects'); expect(options.abort).toBeInstanceOf(AbortSignal)
      const response = { objects: request.requests.map((entry: any) => ({ result: {
        oneofKind: 'object', object: structuredClone(f.rows.get(entry.objectId)),
      } })) }
      const call = new UnaryCall(method, options.meta ?? {}, request, Promise.resolve({}), Promise.resolve(response as any),
        Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}))
      calls.push(call); return call
    },
    serverStreaming() { throw new Error('unexpected streaming') },
    clientStreaming() { throw new Error('unexpected streaming') },
    duplex() { throw new Error('unexpected streaming') },
  }
  const client = new SuiGrpcClient({ network: 'mainnet', transport })
  vi.spyOn(client.core, 'getChainIdentifier').mockImplementation(f.client.core.getChainIdentifier.bind(f.client.core))
  expect(await readPrivateNamedLoadoutHead({ client, deployment: f.deployment, scope: f.scope })).toMatchObject({ revision: '2' })
  expect(calls).toHaveLength(10); expect(calls.every(call => call instanceof UnaryCall)).toBe(true)
})

describe('certified ciphertext reads', () => {
  it.each(['missing', 'direct-kiosk', 'changed'] as const)('never downloads private bytes on invalid item custody: %s', async problem => {
    const f = privateNamedLoadoutFixture(), fieldId = deriveKioskItemFieldId(f.state.current_kiosk_id, f.scope.soulId)
    if (problem === 'missing') f.rows.delete(fieldId)
    if (problem === 'direct-kiosk') f.rows.get(f.scope.soulId).owner.address = f.state.current_kiosk_id
    if (problem === 'changed') {
      const original = f.batch.getMockImplementation()!; let reads = 0
      f.batch.mockImplementation(((args: any, opts: any) => {
        if (args.requests[0].objectId === fieldId && ++reads === 2) f.rows.get(fieldId).version = 4n
        return original(args, opts)
      }) as any)
    }
    await expect(f.readCiphertext()).rejects.toThrow()
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled()
  })
  it('checks real Blob BCS, fresh Walrus epochs and exact bytes before and after download', async () => {
    const f = privateNamedLoadoutFixture(), result = await f.readCiphertext()
    expect(result.ciphertext).toEqual(f.ciphertext); expect(result.storageEndEpoch).toBe(10)
    expect(f.freshWalrusState).toHaveBeenCalledTimes(2); expect(f.get).toHaveBeenCalledTimes(2)
    expect(f.batch).toHaveBeenCalledTimes(20)
    expect(f.fetcher).toHaveBeenCalledWith(`${f.storage.aggregatorUrl}/v1/blobs/${f.ref.blobId}`, expect.objectContaining({
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal),
    }))
  })
  it('returns no ciphertext for a proven empty scope without downloading old private state', async () => {
    const f = privateNamedLoadoutFixture(); f.head.ownership_epoch = '1'; f.putHead()
    expect(await f.readCiphertext()).toMatchObject({ snapshot: { revision: '0' }, ciphertext: null, storageEndEpoch: null })
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled()
  })
  it.each(['type', 'id', 'blob-id', 'size', 'encoding', 'uncertified', 'future-cert', 'expired', 'storage-alias', 'trailing'] as const)(
    'rejects Blob proof %s', async problem => {
      const f = privateNamedLoadoutFixture()
      if (problem === 'id') f.blob.id = privateId(99)
      if (problem === 'blob-id') f.blob.blob_id = '1'
      if (problem === 'size') f.blob.size = '5'
      if (problem === 'encoding') f.blob.encoding_type = 2
      if (problem === 'uncertified') f.blob.certified_epoch = null
      if (problem === 'future-cert') f.blob.certified_epoch = 4
      if (problem === 'expired') f.blob.storage.end_epoch = 3
      if (problem === 'storage-alias') f.blob.storage.id = f.blob.id
      f.putBlob()
      if (problem === 'type') f.rows.get(f.ref.blobObjectId).objectType = `${privateId(99)}::blob::Blob`
      if (problem === 'trailing') { const raw = f.rows.get(f.ref.blobObjectId); raw.contents.value = new Uint8Array([...raw.contents.value, 0]) }
      await expect(f.readCiphertext()).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled()
    })
  it.each(['wrong-network-type', 'fractional', 'negative', 'u32-overflow', 'regression', 'expires-during-read'] as const)(
    'rejects fresh Walrus state %s', async problem => {
      const f = privateNamedLoadoutFixture()
      if (problem === 'wrong-network-type') f.freshWalrusState.mockResolvedValue({ blobType: `${privateId(99)}::blob::Blob`, epoch: 3 })
      if (problem === 'fractional') f.freshWalrusState.mockResolvedValue({ blobType: f.storage.blobType, epoch: 3.5 })
      if (problem === 'negative') f.freshWalrusState.mockResolvedValue({ blobType: f.storage.blobType, epoch: -1 })
      if (problem === 'u32-overflow') f.freshWalrusState.mockResolvedValue({ blobType: f.storage.blobType, epoch: 0x1_0000_0000 })
      if (problem === 'regression') f.freshWalrusState.mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 3 })
        .mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 2 })
      if (problem === 'expires-during-read') f.freshWalrusState.mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 3 })
        .mockResolvedValueOnce({ blobType: f.storage.blobType, epoch: 10 })
      await expect(f.readCiphertext()).rejects.toThrow()
    })
  it.each(['status', 'missing-body', 'short', 'long', 'header', 'hash', 'blob-change', 'head-change'] as const)(
    'rejects download/readback %s', async problem => {
      const f = privateNamedLoadoutFixture()
      f.fetcher.mockImplementation(async () => {
        if (problem === 'status') return new Response('failed', { status: 503 })
        if (problem === 'missing-body') return new Response(null)
        if (problem === 'short') return new Response(new Uint8Array([1]))
        if (problem === 'long') return new Response(new Uint8Array(5))
        if (problem === 'header') return new Response(new Uint8Array(f.ciphertext), { headers: { 'content-length': '04' } })
        if (problem === 'hash') return new Response(new Uint8Array(4))
        if (problem === 'blob-change') f.rows.get(f.ref.blobObjectId).version = 4n
        if (problem === 'head-change') f.rows.get(f.headFieldId).version = 4n
        return new Response(new Uint8Array(f.ciphertext))
      })
      await expect(f.readCiphertext()).rejects.toThrow()
    })
  it('bounds a late response cancellation exactly once', async () => {
    const f = privateNamedLoadoutFixture()
    let resolve!: (response: Response) => void
    f.fetcher.mockImplementation(() => new Promise(done => { resolve = done }))
    const controller = new AbortController(), pending = f.readCiphertext({ signal: controller.signal })
    while (!resolve) await Promise.resolve()
    const cancel = vi.fn(), stream = new ReadableStream({ cancel })
    controller.abort(new Error('closed'))
    await expect(pending).rejects.toThrow('closed')
    resolve(new Response(stream)); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('captures immutable scope, release and storage inputs before asynchronous work', async () => {
    const f = privateNamedLoadoutFixture(), owner = f.scope.owner, blobType = f.storage.blobType
    f.freshWalrusState.mockImplementation(async () => ({ blobType, epoch: 3 }))
    const pending = f.readCiphertext()
    f.scope.owner = privateId(99)
    f.deployment.originalPackageId = privateId(99)
    f.storage.aggregatorUrl = 'https://wrong.example.com'
    const result = await pending
    expect(result.snapshot.scope.owner).toBe(owner)
    expect(f.fetcher.mock.calls[0][0]).toBe(`https://walrus.example.com/v1/blobs/${f.ref.blobId}`)
  })
  it('observes a late rejected fetch after caller cancellation without masking active fetch failure', async () => {
    const f = privateNamedLoadoutFixture()
    f.fetcher.mockRejectedValueOnce(new Error('fetch unavailable'))
    await expect(f.readCiphertext()).rejects.toThrow('fetch unavailable')
    let reject!: (error: Error) => void
    f.fetcher.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const controller = new AbortController(), pending = f.readCiphertext({ signal: controller.signal })
    while (!reject) await Promise.resolve()
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    reject(new Error('late transport error'))
    await new Promise(resolve => setImmediate(resolve))
  })
  it('cancels a stalled download reader once when the wallet changes', async () => {
    const f = privateNamedLoadoutFixture(), cancel = vi.fn()
    f.fetcher.mockResolvedValue(new Response(new ReadableStream({ pull() {}, cancel })))
    const controller = new AbortController(), pending = f.readCiphertext({ signal: controller.signal })
    while (!f.fetcher.mock.calls.length) await Promise.resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    controller.abort(new Error('wallet changed'))
    await expect(pending).rejects.toThrow('wallet changed')
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('owns the fetch-to-reader handoff across %i microtasks', async delay => {
    const f = privateNamedLoadoutFixture(), controller = new AbortController(), cancel = vi.fn()
    const response = new Response(new ReadableStream({ pull() {}, cancel })), cancelBody = vi.spyOn(response.body!, 'cancel')
    f.fetcher.mockImplementation(async () => {
      const abort = (left: number) => queueMicrotask(() => left ? abort(left - 1) : controller.abort(new Error('handoff aborted')))
      abort(delay)
      return response
    })
    await expect(f.readCiphertext({ signal: controller.signal })).rejects.toThrow('handoff aborted')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancelBody.mock.calls.length).toBeLessThanOrEqual(1)
    expect(response.body!.locked).toBe(false)
  })
  it.each(['http://walrus.example.com', 'https://user:secret@walrus.example.com', 'https://walrus.example.com?key=secret'])(
    'rejects credential-bearing or insecure storage config', async aggregatorUrl => {
      const f = privateNamedLoadoutFixture()
      await expect(f.readCiphertext({ storage: { ...f.storage, aggregatorUrl } })).rejects.toThrow('INVALID_STORAGE_URL')
      expect(f.freshWalrusState).not.toHaveBeenCalled()
    })
})
