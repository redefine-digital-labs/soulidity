import { expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { fromHex, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { historicalObjectOutput, readHistoricalMoveObject } from '../../web/lib/sui/historical-object'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const tx = toBase58(new Uint8Array(32).fill(8)), prior = toBase58(new Uint8Array(32).fill(9))
const type = normalizeStructTag(`${id(2)}::example::Content`)
function fixture(created = false) {
  const contents = new Uint8Array([...fromHex(id(4)), 1, 2, 3])
  const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! },
    hasPublicTransfer: false, version: '12', contents } }, owner: { Shared: { initialSharedVersion: '3' } },
  previousTransaction: tx, storageRebate: '0' }).toBytes())
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
    status: { Success: true }, executedEpoch: '1', gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: tx, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '12',
    changedObjects: [[id(4), { inputState: created ? { NotExist: true } : { Exist: [['11', prior], object.owner] },
      outputState: { ObjectWrite: [prior, object.owner] }, idOperation: created ? { Created: true } : { None: true } }]],
    unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes())
  const row = { objectId: id(4), version: 12n, digest: '', previousTransaction: tx, objectType: type,
    owner: { kind: 3, version: 3n }, contents: { value: contents }, bcs: { value: new Uint8Array() } }
  function rehash() {
    row.bcs.value = bcs.Object.serialize(object).toBytes()
    row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...row.bcs.value]), { dkLen: 32 }))
    effects.V2!.changedObjects[0][1].outputState.ObjectWrite![0] = row.digest
  }
  rehash()
  const getObject = vi.fn(async () => ({ response: { object: row } }))
  const client = { ledgerService: { getObject }, core: { getObject: vi.fn(() => { throw Error('Latest object forbidden') }) } }
  const params = { client: client as never, effects, transactionDigest: tx, objectId: id(4), type,
    signal: new AbortController().signal, mode: created ? 'created' as const : 'mutated' as const }
  return { object, effects, row, rehash, client, params, read: () => readHistoricalMoveObject(params) }
}

it.each([false, true])('authenticates complete canonical Object BCS for created=%s at effects version only', async created => {
  const f = fixture(created), result = await f.read()
  expect(result.bytes).toEqual(f.row.contents.value)
  expect(result.reference.created).toBe(created)
  expect(f.client.ledgerService.getObject).toHaveBeenCalledWith(expect.objectContaining({ objectId: id(4), version: 12n }), expect.anything())
  expect(f.client.core.getObject).not.toHaveBeenCalled()
  result.bytes[32] = 99
  expect(f.row.contents.value[32]).toBe(1)
})
it('rejects contents relabelled with the genuine digest', async () => {
  const f = fixture(); f.row.contents.value = new Uint8Array([...fromHex(id(4)), 99])
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
})
it('rejects full BCS changed without updating its effects digest', async () => {
  const f = fixture(); f.object.storageRebate = '100'; f.row.bcs.value = bcs.Object.serialize(f.object).toBytes()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_DIGEST_MISMATCH')
})
it.each(['type', 'uid', 'version', 'previousTransaction', 'owner'] as const)('rejects rehashed wrong %s despite matching row and effects digest', async field => {
  const f = fixture(), move = f.object.data.Move!
  if (field === 'type') move.type.Other!.name = 'Wrong'
  if (field === 'uid') move.contents[31] = 5
  if (field === 'version') move.version = '13'
  if (field === 'previousTransaction') f.object.previousTransaction = prior
  if (field === 'owner') f.object.owner = bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: id(6) }).toBytes())
  f.rehash()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
})
it('rejects trailing bytes even when digest is recomputed', async () => {
  const f = fixture(); f.row.bcs.value = new Uint8Array([...f.row.bcs.value, 0])
  f.row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...f.row.bcs.value]), { dkLen: 32 }))
  f.effects.V2!.changedObjects[0][1].outputState.ObjectWrite![0] = f.row.digest
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_BCS_DIGEST_MISMATCH')
})
it.each(['duplicate', 'unchanged', 'absent'] as const)('rejects %s output identity before RPC', async mode => {
  const f = fixture(), e = f.effects.V2!
  if (mode === 'duplicate') e.changedObjects.push(structuredClone(e.changedObjects[0]))
  if (mode === 'absent') e.changedObjects = []
  if (mode === 'unchanged') e.unchangedConsensusObjects.push([id(4), { $kind: 'PerEpochConfig', PerEpochConfig: true }])
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_OUTPUT_NOT_UNIQUE')
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it.each(['zero', 'same', 'future', 'missing', 'created-existing'] as const)('rejects impossible %s input lineage', async mode => {
  const f = fixture(mode === 'created-existing'), change = f.effects.V2!.changedObjects[0][1]
  if (mode === 'created-existing') change.inputState = fixture().effects.V2!.changedObjects[0][1].inputState
  else if (mode === 'missing') change.inputState = { $kind: 'NotExist', NotExist: true }
  else change.inputState.Exist![0][0] = mode === 'zero' ? '0' : mode === 'same' ? '12' : '13'
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_INVALID_LINEAGE')
})
it('enforces requested lifetime and detaches owner references', () => {
  const f = fixture()
  expect(() => historicalObjectOutput(f.effects, id(4), 'created')).toThrow('HISTORICAL_OBJECT_LIFETIME_MISMATCH')
  const ref = historicalObjectOutput(f.effects, id(4)); ref.owner.Shared!.initialSharedVersion = '100'
  expect(f.effects.V2!.changedObjects[0][1].outputState.ObjectWrite![1].Shared!.initialSharedVersion).toBe('3')
})
it.each([0n, 13n])('rejects invalid shared birth %s authenticated in all object representations', async version => {
  const f = fixture(); f.object.owner.Shared!.initialSharedVersion = String(version)
  f.effects.V2!.changedObjects[0][1].outputState.ObjectWrite![1].Shared!.initialSharedVersion = String(version)
  f.row.owner.version = version; f.rehash()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_INVALID_SHARED_BIRTH')
})
it('rejects mismatched RPC owner metadata', async () => {
  const f = fixture(); f.row.owner.version = 4n
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_OWNER_MISMATCH')
})
it('captures effects and request identity before awaiting RPC', async () => {
  const f = fixture(), pending = f.read()
  f.effects.V2!.changedObjects = []; f.params.objectId = id(99); f.params.type = `${id(2)}::wrong::Wrong`
  await expect(pending).resolves.toMatchObject({ reference: { version: 12n } })
})

function readonlyFixture() {
  const f = fixture()
  f.object.previousTransaction = prior
  f.row.previousTransaction = prior
  f.rehash()
  const change = structuredClone(f.effects.V2!.changedObjects[0])
  f.effects.V2!.changedObjects = []
  f.effects.V2!.lamportVersion = '20'
  f.effects.V2!.unchangedConsensusObjects = [[id(4), { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['12', f.row.digest] }]]
  const params = { ...f.params, mode: 'readonly' as const }
  function rehash() {
    f.row.bcs.value = bcs.Object.serialize(f.object).toBytes()
    f.row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...f.row.bcs.value]), { dkLen: 32 }))
    f.effects.V2!.unchangedConsensusObjects[0][1].ReadOnlyRoot![1] = f.row.digest
  }
  return { ...f, change, params, rehash, read: () => readHistoricalMoveObject(params) }
}

it('proves an unchanged shared root using its own older previous transaction and exact consensus version', async () => {
  const f = readonlyFixture(), result = await f.read()
  expect(result.object.previousTransaction).toBe(prior)
  expect(result.reference).toMatchObject({ version: 12n, digest: f.row.digest, created: false,
    inputVersion: 12n, inputDigest: f.row.digest, owner: { Shared: { initialSharedVersion: '3' } },
    inputOwner: { Shared: { initialSharedVersion: '3' } } })
  expect(f.client.ledgerService.getObject).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ objectId: id(4), version: 12n }), expect.anything())
  expect(f.client.core.getObject).not.toHaveBeenCalled()
  result.reference.owner.Shared!.initialSharedVersion = '99'
  expect(result.reference.inputOwner!.Shared!.initialSharedVersion).toBe('3')
  expect(result.object.owner.Shared!.initialSharedVersion).toBe('3')
})

it.each(['absent', 'duplicate', 'wrong-kind', 'zero', 'same', 'future', 'overflow', 'bad-digest'] as const)(
  'rejects %s read-only consensus proof before RPC', async mode => {
    const f = readonlyFixture(), e = f.effects.V2!
    if (mode === 'absent') e.unchangedConsensusObjects = []
    if (mode === 'duplicate') e.unchangedConsensusObjects.push(structuredClone(e.unchangedConsensusObjects[0]))
    if (mode === 'wrong-kind') e.unchangedConsensusObjects[0][1] = { $kind: 'PerEpochConfig', PerEpochConfig: true }
    if (mode === 'zero' || mode === 'overflow') e.unchangedConsensusObjects[0][1].ReadOnlyRoot![0] = mode === 'zero' ? '0' : '18446744073709551616'
    if (mode === 'same' || mode === 'future') e.unchangedConsensusObjects[0][1].ReadOnlyRoot![0] = mode === 'same' ? e.lamportVersion : String(BigInt(e.lamportVersion) + 1n)
    if (mode === 'bad-digest') e.unchangedConsensusObjects[0][1].ReadOnlyRoot![1] = toBase58(new Uint8Array(31))
    await expect(f.read()).rejects.toThrow(mode === 'bad-digest' ? 'HISTORICAL_OBJECT_INVALID_DIGEST' : 'HISTORICAL_OBJECT_READONLY_ROOT_REQUIRED')
    expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
  })

it.each(['changed', 'failed', 'wrong-transaction'] as const)('rejects %s effects for a read-only proof', async mode => {
  const f = readonlyFixture()
  if (mode === 'changed') f.effects.V2!.changedObjects.push(f.change)
  if (mode === 'failed') f.effects.V2!.status.$kind = 'Failure' as never
  if (mode === 'wrong-transaction') f.effects.V2!.transactionDigest = prior
  await expect(f.read()).rejects.toThrow(mode === 'wrong-transaction' ? 'HISTORICAL_OBJECT_TRANSACTION_MISMATCH' : 'HISTORICAL_OBJECT_READONLY_EFFECTS_MISMATCH')
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})

it.each(['version', 'digest', 'previousTransaction', 'contents', 'full-object'] as const)(
  'rejects read-only RPC %s substitution', async field => {
    const f = readonlyFixture()
    if (field === 'version') f.row.version = 20n
    if (field === 'digest') f.row.digest = tx
    if (field === 'previousTransaction') f.row.previousTransaction = tx
    if (field === 'contents') f.row.contents.value = new Uint8Array([...fromHex(id(4)), 99])
    if (field === 'full-object') { f.object.storageRebate = '99'; f.row.bcs.value = bcs.Object.serialize(f.object).toBytes() }
    await expect(f.read()).rejects.toThrow(field === 'version' || field === 'digest' ? 'HISTORICAL_OBJECT_REFERENCE_MISMATCH'
      : field === 'full-object' ? 'HISTORICAL_OBJECT_BCS_DIGEST_MISMATCH' : 'HISTORICAL_OBJECT_BCS_OBJECT_MISMATCH')
  })

it.each(['AddressOwner', 'ObjectOwner', 'Immutable'] as const)('rejects authenticated %s in a read-only shared proof', async kind => {
  const f = readonlyFixture()
  f.object.owner = bcs.Owner.parse(bcs.Owner.serialize(kind === 'Immutable' ? { Immutable: true } : { [kind]: id(6) } as never).toBytes())
  f.rehash()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_READONLY_OWNER_NOT_SHARED')
})

it('rejects shared birth beyond the historical version even when below the transaction lamport version', async () => {
  const f = readonlyFixture()
  f.object.owner.Shared!.initialSharedVersion = '13'; f.row.owner.version = 13n; f.rehash()
  await expect(f.read()).rejects.toThrow('HISTORICAL_OBJECT_INVALID_SHARED_BIRTH')
})

it('snapshots the read-only consensus proof before awaiting ledger data', async () => {
  const f = readonlyFixture(), pending = f.read()
  f.effects.V2!.unchangedConsensusObjects = []
  f.params.transactionDigest = prior; f.params.objectId = id(99)
  await expect(pending).resolves.toMatchObject({ reference: { version: 12n, inputDigest: f.row.digest } })
})
