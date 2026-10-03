import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase58 } from '@mysten/sui/utils'
import { singleUploadFixture, uid } from './fixtures/walrus-single-upload'
import { readWalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { inspectWalrusRegisteredBlobForRebase } from '../../web/lib/upload/walrus-single-upload'

// Real pinned Walrus SDK register/certify graphs, local Ed25519 signed bytes,
// canonical Sui effects and Blob BCS. Chain responses/encoding/quorum are fixture
// boundaries, not Move VM, real payment, key-server or mainnet acceptance.
const Blob = bcs.struct('InspectionBlob', { id: bcs.Address, registered_epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(),
  encoding_type: bcs.u8(), certified_epoch: bcs.option(bcs.u32()), storage: bcs.struct('InspectionStorage', {
    id: bcs.Address, start_epoch: bcs.u32(), end_epoch: bcs.u32(), storage_size: bcs.u64(),
  }), deletable: bcs.bool() })
let local: Map<string, string>
beforeEach(() => {
  local = new Map()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => local.set(k, v) } })
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, fn: (lock: object) => unknown) => fn({}) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No live HTTP in fixture') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture(mode: 'missing' | 'completed' | 'no-cert' | 'unpaid' = 'missing') {
  // This controlled attachment checks exact command/pure-byte replay, not an
  // executed Soulidity Move ABI. Walrus register/certify are the actual SDK graph.
  const attachment = { scope: 'content-append:original-signed-envelope', append: (tx: Transaction, blob: string) => {
    tx.moveCall({ target: `${uid(7)}::content::append`, arguments: [tx.object(blob), tx.pure.u64(2), tx.pure.string('exact-original-envelope')] })
  } }
  const f = await singleUploadFixture(attachment)
  const execute = f.client.core.executeTransaction.getMockImplementation()!
  if (mode === 'no-cert') f.write.mockRejectedValueOnce(new Error('fixture-stop-before-certificate'))
  else if (mode !== 'completed') f.client.core.executeTransaction.mockImplementation(async args => {
    const register = Transaction.from(args.transaction).getData().commands.some(c => c.MoveCall?.function === 'register_blob')
    if (mode === 'unpaid' || !register) throw new Error('fixture-stop-before-execution')
    return execute(args)
  })
  if (mode === 'completed') await f.run()
  else await expect(f.run()).rejects.toThrow(/^fixture-stop-/)
  const record = readWalrusSingleRecord(f.key)!
  const getObject = f.client.core.getObject.getMockImplementation()!
  // Existing SDK flow fixture intentionally omits Core metadata it never uses.
  // Supply the exact fixture effects' reference and actual Core owner enum shape.
  f.client.core.getObject.mockImplementation(async args => {
    const { object } = await getObject(args)
    return { object: { ...object, version: mode === 'completed' ? '3' : '2', digest: toBase58(new Uint8Array(32).fill(5)),
      owner: { $kind: 'AddressOwner', ...object.owner } } }
  })
  const objectImpl = f.client.core.getObject.getMockImplementation()!
  const queryImpl = f.client.ledgerService.getTransaction.getMockImplementation()!
  const getAddress = vi.fn(() => { throw new Error('Inspection cannot ask wallet authority') })
  const sign = vi.fn(async () => { throw new Error('Inspection cannot sign') })
  const beforeWrite = vi.fn(async () => { throw new Error('Inspection cannot enter write preflight') })
  const execution = { client: f.execution.client, getAddress, sign, beforeWrite }
  const createClient = vi.fn(f.createClient)
  const get = vi.fn(() => { throw new Error('Inspection cannot read local WAL') })
  const set = vi.fn(() => { throw new Error('Inspection cannot write local WAL') })
  const lock = vi.fn(() => { throw new Error('Inspection cannot lock local WAL') })
  vi.stubGlobal('window', { localStorage: { getItem: get, setItem: set } })
  vi.stubGlobal('navigator', { locks: { request: lock } })
  f.sign.mockClear(); f.write.mockClear(); f.relayWrite.mockClear(); f.approve.mockClear(); f.client.core.executeTransaction.mockClear()
  const flow = vi.spyOn(f.walrus, 'writeBlobFlow'), storage = vi.spyOn(f.walrus, 'storageCost').mockClear()
  const inspect = async (overrides: Partial<Parameters<typeof inspectWalrusRegisteredBlobForRebase>[0]> = {}) => {
    const before = structuredClone(record), journal = [...local.entries()]
    try { return await inspectWalrusRegisteredBlobForRebase({ record, operationScope: f.intent.operationScope,
      execution, attachment, createClient, ...overrides }) }
    finally {
      expect(record).toEqual(before); expect([...local.entries()]).toEqual(journal)
      for (const fn of [getAddress, sign, beforeWrite, get, set, lock, f.sign, f.write, f.relayWrite, f.approve,
        f.client.core.executeTransaction, flow, storage]) expect(fn).not.toHaveBeenCalled()
    }
  }
  const expired = () => f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: BigInt(record.certify!.expirationEpoch) + 1n } } })
  return { ...f, record, attachment, inspect, expired, objectImpl, queryImpl, createClient }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function certifyResponse(f: Fixture, status: 'SUCCEEDED' | 'FAILED' | 'PENDING') {
  const source = bcs.TransactionEffects.parse(f.records.get(f.record.register!.digest)!.effects).V2!
  const effects = bcs.TransactionEffects.serialize({ V2: { ...source, transactionDigest: f.record.certify!.digest,
    lamportVersion: '3', changedObjects: [], status: status === 'FAILED'
      ? { Failure: { error: { InsufficientGas: true }, command: 0 } } : { Success: true } } }).toBytes()
  const tx = f.record.certify!
  return { response: { transaction: { digest: tx.digest, transaction: { digest: tx.digest,
    bcs: { value: fromBase64(tx.bytes) } },
    effects: { status: { success: status !== 'FAILED' }, bcs: { value: effects } },
    ...(status === 'PENDING' ? {} : { checkpoint: 1n }) } } }
}
function currentObject(f: Fixture, mutate: (object: any) => void, afterOnly = false) {
  let reads = 0
  f.client.core.getObject.mockImplementation(async args => {
    const result = await f.objectImpl(args)
    if (++reads >= (afterOnly ? 4 : 3)) mutate(result.object)
    return result
  })
}
function blobChange(object: any, mutate: (blob: ReturnType<typeof Blob.parse>) => void) {
  const blob = Blob.parse(object.content); mutate(blob); object.content = Blob.serialize(blob).toBytes()
}

it('paid registration with no recorded certify packet is only NO_RECORDED_PACKET, not proof no hidden wallet signature exists', async () => {
  const f = await fixture('no-cert'), result = await f.inspect()
  expect(result.status).toBe('REBASE_AVAILABLE')
  if (result.status !== 'REBASE_AVAILABLE') throw new Error('Expected inspection')
  expect(result.retirement).toEqual({ kind: 'NO_RECORDED_PACKET', digest: null, observedSuiEpoch: null })
  expect(result).toMatchObject({ blobObjectId: f.blobObjectId, blobVersion: '2', observedWalrusEpoch: 9, storageEndEpoch: 12 })
})
it('known successful certification returns COMPLETED without retry, local WAL mutation, signing or upload', async () => {
  const f = await fixture('completed')
  f.record.certify!.phase = 'SIGNED'
  const result = await f.inspect()
  expect(result.status).toBe('COMPLETED')
  if (result.status !== 'COMPLETED') throw new Error('Expected completion')
  expect(result.result.certifyTxDigest).toBe(f.record.certify!.digest)
  expect(f.record.certify!.phase).toBe('SIGNED')
})
it('unconfirmed registration cannot be treated as paid from local SIGNED flags', async () => {
  const f = await fixture('unpaid')
  await expect(f.inspect()).rejects.toThrow('WALRUS_REGISTER_NOT_FINAL')
})
it('strictly expired missing certify packet may be inspected only after a second exact-digest query', async () => {
  const f = await fixture(); f.expired(); f.client.ledgerService.getTransaction.mockClear()
  const result = await f.inspect()
  expect(result.status).toBe('REBASE_AVAILABLE')
  if (result.status !== 'REBASE_AVAILABLE') throw new Error('Expected inspection')
  expect(result.retirement).toEqual({ kind: 'EXPIRED', digest: f.record.certify!.digest,
    observedSuiEpoch: String(BigInt(f.record.certify!.expirationEpoch) + 1n) })
  expect(f.client.ledgerService.getTransaction.mock.calls.filter(([args]) => args.digest === f.record.certify!.digest)).toHaveLength(2)
})
it.each([-1n, 0n])('missing certify at expiration offset %s is still executable and cannot rebase', async offset => {
  const f = await fixture()
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: BigInt(f.record.certify!.expirationEpoch) + offset } } })
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_PREDECESSOR_STILL_EXECUTABLE')
})

it('actual effects without a checkpoint are PENDING, never finalized failure or missing', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockImplementation(async args => args.digest === f.record.certify!.digest
    ? certifyResponse(f, 'PENDING') : f.queryImpl(args))
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_PREDECESSOR_PENDING')
})
it('finalized failed effects permit rebase without requiring packet expiration', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockImplementation(async args => args.digest === f.record.certify!.digest
    ? certifyResponse(f, 'FAILED') : f.queryImpl(args))
  f.client.ledgerService.getEpoch.mockClear()
  const result = await f.inspect()
  expect(result.status).toBe('REBASE_AVAILABLE')
  if (result.status !== 'REBASE_AVAILABLE') throw new Error('Expected inspection')
  expect(result.retirement).toEqual({ kind: 'FAILED', digest: f.record.certify!.digest, observedSuiEpoch: null })
  expect(f.client.ledgerService.getEpoch).not.toHaveBeenCalled()
})
it('second query sees successful certification and returns COMPLETED rather than replacing it', async () => {
  const f = await fixture('completed'); f.expired(); let calls = 0
  f.client.ledgerService.getTransaction.mockImplementation(async args => {
    if (args.digest === f.record.certify!.digest && calls++ === 0) throw { code: 'NOT_FOUND' }
    return f.queryImpl(args)
  })
  const result = await f.inspect()
  expect(result.status).toBe('COMPLETED')
  expect(calls).toBeGreaterThanOrEqual(2)
})
it.each(['PENDING', 'FAILED', 'RPC'] as const)('expired packet second query %s is not silently treated as MISSING', async status => {
  const f = await fixture(); f.expired(); let calls = 0
  f.client.ledgerService.getTransaction.mockImplementation(async args => {
    if (args.digest !== f.record.certify!.digest) return f.queryImpl(args)
    if (++calls === 1) throw { code: 'NOT_FOUND' }
    if (status === 'RPC') throw new Error('second-query-network-error')
    return certifyResponse(f, status)
  })
  if (status === 'FAILED') {
    const result = await f.inspect()
    expect(result.status).toBe('REBASE_AVAILABLE')
    if (result.status !== 'REBASE_AVAILABLE') throw new Error('Expected inspection')
    expect(result.retirement.kind).toBe('FAILED')
  } else await expect(f.inspect()).rejects.toThrow(status === 'RPC' ? 'second-query-network-error' : 'WALRUS_REBASE_PREDECESSOR_PENDING')
  expect(calls).toBe(2)
})
it('first query network failure cannot be interpreted as missing or trigger epoch fallback', async () => {
  const f = await fixture(); f.client.ledgerService.getEpoch.mockClear()
  f.client.ledgerService.getTransaction.mockRejectedValue(new Error('query-network-error'))
  await expect(f.inspect()).rejects.toThrow('query-network-error')
  expect(f.client.ledgerService.getEpoch).not.toHaveBeenCalled()
})
it('local FAILED phase is not chain finality while the packet remains executable', async () => {
  const f = await fixture(); f.record.certify!.phase = 'FAILED'
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_PREDECESSOR_STILL_EXECUTABLE')
})
it('forged failed RPC status cannot override successful canonical effects', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockImplementation(async args => {
    if (args.digest !== f.record.certify!.digest) return f.queryImpl(args)
    const value = certifyResponse(f, 'SUCCEEDED'); value.response.transaction.effects.status.success = false; return value
  })
  await expect(f.inspect()).rejects.toThrow('WALRUS_EFFECTS_STATUS_MISMATCH')
})
it.each(['PENDING', 'FAILED'] as const)('registration %s proof blocks rebase even when local phase says SUCCEEDED', async status => {
  const f = await fixture('no-cert')
  f.client.ledgerService.getTransaction.mockImplementation(async args => {
    const result = await f.queryImpl(args)
    if (status === 'PENDING') delete (result.response.transaction as { checkpoint?: bigint }).checkpoint
    else {
      const parsed = bcs.TransactionEffects.parse(result.response.transaction.effects.bcs.value)
      parsed.V2!.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: 0 } }
      result.response.transaction.effects.bcs.value = bcs.TransactionEffects.serialize(parsed).toBytes()
      result.response.transaction.effects.status.success = false
    }
    return result
  })
  await expect(f.inspect()).rejects.toThrow('WALRUS_REGISTER_NOT_FINAL')
})
it.each([undefined, 12, -1n, 18446744073709551616n])('invalid Sui epoch %s cannot retire a missing packet', async epoch => {
  const f = await fixture()
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch } } } as any)
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_PREDECESSOR_STILL_EXECUTABLE')
})

it.each([
  ['owner address', (o: any) => { o.owner.AddressOwner = uid(800) }, 'WALRUS_REBASE_BLOB_OWNER_MISMATCH'],
  ['owner variant', (o: any) => { o.owner.$kind = 'ObjectOwner' }, 'WALRUS_REBASE_BLOB_OWNER_MISMATCH'],
  ['object ID', (o: any) => { o.objectId = uid(800) }, 'WALRUS_REBASE_BLOB_OWNER_MISMATCH'],
  ['type', (o: any) => { o.type = `${uid(800)}::blob::Blob` }, 'WALRUS_REBASE_BLOB_OWNER_MISMATCH'],
  ['zero version', (o: any) => { o.version = '0' }, 'WALRUS_REBASE_BLOB_REFERENCE_INVALID'],
  ['noncanonical version', (o: any) => { o.version = '02' }, 'WALRUS_REBASE_BLOB_REFERENCE_INVALID'],
  ['overflow version', (o: any) => { o.version = '18446744073709551616' }, 'WALRUS_REBASE_BLOB_REFERENCE_INVALID'],
  ['short digest', (o: any) => { o.digest = toBase58(new Uint8Array(31)) }, 'WALRUS_REBASE_BLOB_REFERENCE_INVALID'],
  ['BCS UID', (o: any) => blobChange(o, b => { b.id = uid(800) }), 'WALRUS_REBASE_BLOB_NOT_UNCERTIFIED'],
  ['payload size', (o: any) => blobChange(o, b => { b.size = String(BigInt(b.size) + 1n) }), 'WALRUS_REBASE_BLOB_NOT_UNCERTIFIED'],
  ['encoding type', (o: any) => blobChange(o, b => { b.encoding_type = 0 }), 'WALRUS_REBASE_BLOB_NOT_UNCERTIFIED'],
  ['already certified', (o: any) => blobChange(o, b => { b.certified_epoch = 9 }), 'WALRUS_REBASE_BLOB_NOT_UNCERTIFIED'],
  ['not deletable', (o: any) => blobChange(o, b => { b.deletable = false }), 'WALRUS_REBASE_BLOB_NOT_UNCERTIFIED'],
  ['Blob ID hash', (o: any) => blobChange(o, b => { b.blob_id = '2' }), 'WALRUS_REBASE_STORAGE_ROOT_MISMATCH'],
  ['registered/storage epoch', (o: any) => blobChange(o, b => { b.registered_epoch = 8 }), 'WALRUS_REBASE_STORAGE_ROOT_MISMATCH'],
  ['paid duration', (o: any) => blobChange(o, b => { b.storage.end_epoch = 13 }), 'WALRUS_REBASE_STORAGE_ROOT_MISMATCH'],
] as const)('rejects current Blob %s mismatch with canonical raw BCS', async (_name, mutate, error) => {
  const f = await fixture('no-cert'); currentObject(f, mutate)
  await expect(f.inspect()).rejects.toThrow(error)
})
it('rejects trailing Blob content bytes even when all decoded fields match', async () => {
  const f = await fixture('no-cert')
  currentObject(f, object => { object.content = new Uint8Array([...object.content, 0]) })
  await expect(f.inspect()).rejects.toThrow()
})
it.each([8, 12, 13, -1, NaN, 9.5])('Walrus committee epoch %s does not prove a currently usable paid Blob', async epoch => {
  const f = await fixture('no-cert')
  vi.mocked(f.walrus.systemState).mockResolvedValue({ committee: { epoch } } as any)
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_STORAGE_EXPIRED')
})
it.each(['version', 'digest', 'content'] as const)('rereads and rejects %s drift of the current Blob', async field => {
  const f = await fixture('no-cert')
  let reads = 0
  f.client.core.getObject.mockImplementation(async args => {
    const result = await f.objectImpl(args); reads++
    // A later version permits a new digest relative to creation; two latest
    // responses still must agree with each other, beyond that causal check.
    if (field === 'digest' && reads >= 3) result.object.version = '3'
    if (reads >= 4) {
      if (field === 'version') result.object.version = '3'
      else if (field === 'digest') result.object.digest = toBase58(new Uint8Array(32).fill(6))
      else blobChange(result.object, blob => { blob.storage.storage_size = '1001' })
    }
    return result
  })
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_BLOB_CHANGED_RETRY')
})
it.each(['older version', 'same-version different digest'] as const)('current Blob cannot contradict its paid creation reference: %s', async variant => {
  const f = await fixture('no-cert')
  // Actual registration effects create this ID at version 2 / digest 5... .
  // Two mutually consistent latest reads do not make an earlier/impossible ref valid.
  currentObject(f, object => {
    if (variant === 'older version') object.version = '1'
    else object.digest = toBase58(new Uint8Array(32).fill(6))
  })
  await expect(f.inspect()).rejects.toThrow('WALRUS_REBASE_BLOB_CREATION_REFERENCE_MISMATCH')
})
it('permits a stable later Blob reference still owned by the payer, without requiring its old creation digest', async () => {
  const f = await fixture('no-cert'), laterDigest = toBase58(new Uint8Array(32).fill(6))
  currentObject(f, object => { object.version = '3'; object.digest = laterDigest })
  const result = await f.inspect()
  expect(result.status).toBe('REBASE_AVAILABLE')
  expect(result).toMatchObject({ blobVersion: '3', blobDigest: laterDigest })
})
it('does not treat a contradictory Created/Exist effects entry as an authenticated fresh registration', async () => {
  const f = await fixture('no-cert')
  f.client.ledgerService.getTransaction.mockImplementation(async args => {
    const result = await f.queryImpl(args), parsed = bcs.TransactionEffects.parse(result.response.transaction.effects.bcs.value)
    parsed.V2!.changedObjects[0][1].inputState = { $kind: 'Exist', Exist: [['1', toBase58(new Uint8Array(32).fill(5))],
      { $kind: 'AddressOwner', AddressOwner: f.intent.owner }] }
    result.response.transaction.effects.bcs.value = bcs.TransactionEffects.serialize(parsed).toBytes()
    return result
  })
  await expect(f.inspect()).rejects.toThrow('WALRUS_REGISTER_CREATION_EVIDENCE_INVALID')
})
it('rebuilds real SDK certification and rejects changed attachment payload despite identical attachment scope', async () => {
  const f = await fixture(); f.expired()
  const attachment = { ...f.attachment, append: (tx: Transaction, blob: string) => {
    tx.moveCall({ target: `${uid(7)}::content::append`, arguments: [tx.object(blob), tx.pure.u64(2), tx.pure.string('different-envelope')] })
  } }
  await expect(f.inspect({ attachment })).rejects.toThrow('WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
})
it('record absence is not fabricated into a paid registration', async () => {
  const f = await fixture('no-cert')
  const record = { ...f.record, register: null, encoding: null, approved: null }
  await expect(f.inspect({ record })).rejects.toThrow('WALRUS_REBASE_PAID_REGISTER_REQUIRED')
})
it.each(['operation', 'attachment'] as const)('rejects wrong %s scope before any RPC/client creation', async variant => {
  const f = await fixture('no-cert'); f.client.core.getChainIdentifier.mockClear()
  await expect(f.inspect(variant === 'operation' ? { operationScope: 'other' } : { attachment: { ...f.attachment, scope: 'other' } }))
    .rejects.toThrow(variant === 'operation' ? 'WALRUS_RECOVERY_SCOPE_MISMATCH' : 'WALRUS_ATTACHMENT_SCOPE_MISMATCH')
  expect(f.createClient).not.toHaveBeenCalled(); expect(f.client.core.getChainIdentifier).not.toHaveBeenCalled()
})
