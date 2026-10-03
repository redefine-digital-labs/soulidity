import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { Blob } from '../../web/node_modules/@mysten/walrus/dist/contracts/walrus/blob.mjs'
import { System } from '../../web/node_modules/@mysten/walrus/dist/contracts/walrus/system.mjs'
import { observeHistoricalWalrusBlob } from '../../web/lib/upload/walrus-single-upload'
import { uid } from './fixtures/walrus-single-upload'
import { historicalWalrusFixture } from './fixtures/walrus-historical-completion'

type Fixture = Awaited<ReturnType<typeof historicalWalrusFixture>>
function rehash(f: Fixture, row: any, object = bcs.Object.parse(row.bcs.value)) {
  row.bcs.value = bcs.Object.serialize(object).toBytes(); row.contents.value = object.data.Move!.contents
  row.digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...row.bcs.value]), { dkLen: 32 }))
  for (const record of f.records.values()) {
    if (record.effects.V2!.lamportVersion === String(row.version)) {
      const change = record.effects.V2!.changedObjects.find(([id]) => id === row.objectId)
      if (change) change[1].outputState.ObjectWrite![0] = row.digest
    }
    const readonly = record.effects.V2!.unchangedConsensusObjects.find(([id, change]) => id === row.objectId && change.ReadOnlyRoot?.[0] === String(row.version))
    if (readonly) readonly[1].ReadOnlyRoot![1] = row.digest
  }
}
function rewriteCertify(f: Fixture, edit: (data: TransactionDataBuilder) => void) {
  const old = f.record.certify!, data = TransactionDataBuilder.fromBytes(fromBase64(old.bytes)); edit(data)
  const bytes = data.build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes), receipt = f.records.get(old.digest)!
  f.record.certify = { ...old, bytes: toBase64(bytes), digest }; f.records.delete(old.digest)
  receipt.bytes = bytes; receipt.effects.V2!.transactionDigest = digest; f.records.set(digest, receipt)
  for (const row of f.rows.values()) if (row.previousTransaction === old.digest) {
    row.previousTransaction = digest
    const object = bcs.Object.parse(row.bcs.value); object.previousTransaction = digest; rehash(f, row, object)
  }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('proves old completion using real WASM and both historical packages, without current Blob, wallet, download or storage', async () => {
  const f = await historicalWalrusFixture(), before = structuredClone(f.record)
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No live network') }))
  const result = await f.query()
  expect(result.status).toBe('CERTIFIED')
  if (result.status === 'CERTIFIED') {
    expect(result.result.blobObjectId).toBe(f.blobObjectId)
    expect(result.effects).toEqual(f.records.get(f.record.certify!.digest)!.effects)
  }
  expect(f.record).toEqual(before)
  for (const fn of [f.client.core.getObject, f.client.core.executeTransaction, f.client.ledgerService.getEpoch,
    f.execution.getAddress, f.execution.sign, f.execution.beforeWrite, f.readBlob, f.write]) expect(fn).not.toHaveBeenCalled()
})
it('rejects changed source before historical object reads', async () => {
  const f = await historicalWalrusFixture(); f.params.payload[0] ^= 1
  await expect(f.query()).rejects.toThrow('WALRUS_SOURCE_BYTES_MISMATCH')
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it('rejects full historical Blob BCS with a relabelled effects digest', async () => {
  const f = await historicalWalrusFixture(); f.certifiedBlob.bcs.value[40] ^= 1
  await expect(f.query()).rejects.toThrow('HISTORICAL_OBJECT_BCS_DIGEST_MISMATCH')
})
it.each(['register', 'certify'] as const)('returns UNKNOWN when %s receipt is absent, without metadata or current reads', async stage => {
  const f = await historicalWalrusFixture(); f.records.delete(f.record[stage]!.digest)
  expect((await f.query()).status).toBe('UNKNOWN')
  expect(f.createClient).not.toHaveBeenCalled()
})
it('does not accept a mutable/current System in place of the historical readonly root', async () => {
  const f = await historicalWalrusFixture(); f.records.get(f.record.certify!.digest)!.effects.V2!.unchangedConsensusObjects = []
  await expect(f.query()).rejects.toThrow('HISTORICAL_OBJECT_READONLY_ROOT_REQUIRED')
})
it('aborts a nonsettling historical query and never publishes a late result', async () => {
  const f = await historicalWalrusFixture()
  f.client.ledgerService.getObject.mockImplementation(() => new Promise(() => {}))
  const pending = f.query(); f.controller.abort(Error('query cancelled'))
  await expect(pending).rejects.toThrow('query cancelled')
})
it.each(['signature', 'message', 'bitmap'] as const)('rejects a rewritten finalized %s pure input against the original certificate', async field => {
  const f = await historicalWalrusFixture()
  rewriteCertify(f, data => {
    const index = data.commands[0].MoveCall!.arguments[field === 'signature' ? 2 : field === 'bitmap' ? 3 : 4].Input!
    data.inputs[index] = { $kind: 'Pure', Pure: { bytes: bcs.byteVector().serialize([255]).toBase64() } }
  })
  await expect(f.query()).rejects.toThrow(field === 'bitmap' ? 'WALRUS_HISTORICAL_BITMAP_INVALID' : 'WALRUS_HISTORICAL_CERTIFICATE_MISMATCH')
})
it('rejects an extra finalized command outside the trusted attachment graph', async () => {
  const f = await historicalWalrusFixture()
  rewriteCertify(f, data => { data.commands.push(structuredClone(data.commands[0])) })
  await expect(f.query()).rejects.toThrow('WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
})
it('rejects certify against a different historical package even with rehashed readonly System BCS', async () => {
  const f = await historicalWalrusFixture(), object = bcs.Object.parse(f.oldSystem.bcs.value)
  const system = System.parse(object.data.Move!.contents); system.package_id = uid(88)
  object.data.Move!.contents = System.serialize(system).toBytes(); rehash(f, f.oldSystem, object)
  await expect(f.query()).rejects.toThrow('WALRUS_HISTORICAL_CERTIFY_PREFIX_MISMATCH')
})
it.each(['expiredAtCertification', 'changedStorage', 'uncertified'] as const)('rejects rehashed historical %s Blob', async field => {
  const f = await historicalWalrusFixture(), object = bcs.Object.parse(f.certifiedBlob.bcs.value), blob = Blob.parse(object.data.Move!.contents)
  if (field === 'expiredAtCertification') blob.certified_epoch = blob.storage.end_epoch
  if (field === 'changedStorage') blob.storage.id = uid(500)
  if (field === 'uncertified') blob.certified_epoch = null
  object.data.Move!.contents = Blob.serialize(blob).toBytes(); rehash(f, f.certifiedBlob, object)
  await expect(f.query()).rejects.toThrow('WALRUS_HISTORICAL_BLOB_LINEAGE_MISMATCH')
})
it('does not allow duplicate readonly System entries', async () => {
  const f = await historicalWalrusFixture(), e = f.records.get(f.record.certify!.digest)!.effects.V2!
  e.unchangedConsensusObjects.push(structuredClone(e.unchangedConsensusObjects[0]))
  await expect(f.query()).rejects.toThrow('HISTORICAL_OBJECT_READONLY_ROOT_REQUIRED')
})
it('returns FAILED for an original finalized failure without encoding or querying current state', async () => {
  const f = await historicalWalrusFixture(), receipt = f.records.get(f.record.certify!.digest)!
  receipt.effects.V2!.status = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...receipt.effects.V2!,
    status: { Failure: { error: { InsufficientGas: true }, command: 0 } } } }).toBytes()).V2!.status
  expect((await f.query()).status).toBe('FAILED'); expect(f.createClient).not.toHaveBeenCalled()
})
it('captures source and record before asynchronous chain lookup', async () => {
  const f = await historicalWalrusFixture(), expected = f.record.certify!.digest
  const pending = f.query(); f.params.payload.fill(0); f.record.intent.payloadHash = '0'.repeat(64)
  const result = await pending
  expect(result.status).toBe('CERTIFIED')
  if (result.status === 'CERTIFIED') expect(result.result.certifyTxDigest).toBe(expected)
})
it.each(['MATCHES_ORIGINAL', 'EXPIRED', 'TRANSFERRED', 'NOT_FOUND'] as const)('observes %s current storage independently from historical completion', async mode => {
  const f = await historicalWalrusFixture(), expectedOwner = uid(250)
  expect((await f.query()).status).toBe('CERTIFIED')
  const owner = mode === 'TRANSFERRED' ? uid(251) : expectedOwner
  f.client.core.getObject.mockImplementation(async () => {
    if (mode === 'NOT_FOUND') throw { code: 'NOT_FOUND' }
    return { object: { objectId: f.blobObjectId, type: f.certifiedBlob.objectType, content: f.certifiedBlob.contents.value,
      owner: { $kind: 'ObjectOwner', ObjectOwner: owner } } } as any
  })
  vi.spyOn(f.walrus, 'getBlobType').mockReturnValue(f.certifiedBlob.objectType)
  f.stateSpy.mockResolvedValue({ committee: { epoch: mode === 'EXPIRED' ? 12 : 10 } } as any)
  const result = await observeHistoricalWalrusBlob({ record: f.record, expectedOwner,
    execution: f.execution, createClient: f.createClient, signal: f.controller.signal })
  expect(result.status).toBe(mode === 'MATCHES_ORIGINAL' ? 'MATCHES_ORIGINAL' : mode === 'NOT_FOUND' ? 'UNAVAILABLE' : 'CHANGED')
  expect(f.readBlob).not.toHaveBeenCalled(); expect(f.execution.sign).not.toHaveBeenCalled()
})
