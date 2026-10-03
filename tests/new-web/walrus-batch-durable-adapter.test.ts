import { afterEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { batchDurableFixture } from './fixtures/walrus-batch-durable'
import { decodeWalrusBatchCertificate, encodeWalrusBatchCertificate, inspectWalrusBatchCertificate } from '../../web/lib/upload/walrus-batch-certificate'
import { exportWalrusBatchPreparation, importWalrusBatchPreparation } from '../../web/lib/upload/walrus-batch-preparation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it.each(['resolve', 'reject', 'abort'] as const)('keeps uploader lock until delayed certificate CAS settles: %s', async outcome => {
  const f = await batchDurableFixture({ files: 1, privateFiles: false }); await f.register()
  const save = vi.mocked(f.memory.store.compareAndSwap).getMockImplementation()!
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(f.memory.store.compareAndSwap).mockImplementationOnce(async (...args) => {
    entered(); await gate
    if (outcome === 'reject') throw Error('Disk failed')
    return save(...args)
  })
  vi.useFakeTimers()
  const result = f.adapter.completeUploads().catch(error => error)
  await reached
  if (outcome === 'abort') f.controller.abort(Error('Cancelled'))
  await vi.advanceTimersByTimeAsync(31000)
  await expect(f.memory.store.exclusive('test', async () => {})).rejects.toThrow('busy')
  expect(f.memory.get()!.certificates).toHaveLength(0)
  release(); const settled = await result
  await expect(f.memory.store.exclusive('test', async () => true)).resolves.toBe(true)
  if (outcome === 'resolve') expect(settled.certificates).toHaveLength(1)
  else expect(settled).toBeInstanceOf(Error)
  expect(f.memory.get()!.certificates).toHaveLength(outcome === 'reject' ? 0 : 1)
})
it('keeps uploader lock until archive settles rather than permitting a late deletion', async () => {
  const f = await batchDurableFixture({ files: 0 }); await f.register()
  const archive = vi.mocked(f.memory.store.archive).getMockImplementation()!
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(f.memory.store.archive).mockImplementationOnce(async (...args) => { entered(); await gate; return archive(...args) })
  vi.useFakeTimers(); const result = f.adapter.archiveCompleted(); await reached
  await vi.advanceTimersByTimeAsync(31000)
  await expect(f.memory.store.exclusive('test', async () => {})).rejects.toThrow('busy')
  expect(f.memory.get()).not.toBe(null); release(); await result
  expect(f.memory.get()).toBe(null)
})
it('composes N real SDK registrations into one parent PTB and never signs or broadcasts', async () => {
  const f = await batchDurableFixture(), registered = await f.register()
  const commands = registered.tx.getData().commands
  expect(commands.filter(command => command.MoveCall?.function === 'register_blob')).toHaveLength(3)
  expect(commands.filter(command => command.TransferObjects)).toHaveLength(3)
  expect(f.memory.get()!.registration!.packet).toEqual(registered.packet)
  expect(f.base.sign).not.toHaveBeenCalled(); expect(f.base.client.core.executeTransaction).not.toHaveBeenCalled()
  await expect(f.adapter.appendRegisterCalls(new Transaction())).rejects.toThrow('REGISTER_ALREADY_PRESENT')
})
it('rebuilds real BLS certificates from confirmations without node writes, preserving one checkpoint per blob', async () => {
  const f = await batchDurableFixture(); await f.register(); f.encode.mockClear()
  const result = await f.adapter.completeUploads()
  expect(result.certificates.map(value => value.index)).toEqual([0, 1, 2])
  expect(f.memory.checkpoints.map(value => value.certificates.length)).toEqual([0, 1, 2, 3])
  expect(f.write).not.toHaveBeenCalled(); expect(f.encode).not.toHaveBeenCalled()
  for (const row of result.certificates) {
    const certificate = decodeWalrusBatchCertificate(row.certificate)
    expect(certificate.signature.length).toBe(96); expect(encodeWalrusBatchCertificate(certificate)).toBe(row.certificate)
    expect(inspectWalrusBatchCertificate(row.certificate, { blobId: result.preparation.manifest.files[row.index].encoding.blobId,
      blobObjectId: result.registration!.blobs[row.index].objectId, epoch: 9, committee: { n_shards: 4, members: [{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }] } }).epoch).toBe(9)
  }
})
it('uploads real freshly re-encoded slivers through the same batch SDK only when confirmations are absent', async () => {
  const f = await batchDurableFixture(); await f.register(); f.encode.mockClear(); f.setConfirmationsMissing(true)
  const result = await f.adapter.completeUploads()
  expect(f.write).toHaveBeenCalledTimes(3); expect(f.encode).toHaveBeenCalledTimes(3)
  expect(result.certificates).toHaveLength(3)
  const starts = f.write.mock.calls.map(([call]) => call.objectId)
  expect(starts).toEqual(result.registration!.blobs.map(blob => blob.objectId))
  expect(f.nodeWrite).toHaveBeenCalledTimes(12)
  expect(f.base.sign).not.toHaveBeenCalled(); expect(f.protector.protect).toHaveBeenCalledTimes(1)
})
it('an actual cold adapter resumes saved ciphertext and re-proves registration without re-registering or unlocking', async () => {
  const f = await batchDurableFixture(); await f.register(); const original = f.memory.get()!
  const cold = f.adapterFor(importWalrusBatchPreparation(exportWalrusBatchPreparation(f.preparation)))
  f.encode.mockClear(); f.protector.protect = vi.fn(async () => { throw Error('must not re-encrypt') })
  await cold.completeUploads()
  expect(f.memory.get()!.registration).toEqual(original.registration)
  expect(f.verifiers.verifyRegistration).toHaveBeenCalledTimes(2); expect(f.encode).not.toHaveBeenCalled()
  expect(f.base.sign).not.toHaveBeenCalled()
})
it('retains per-file progress when a later storage checkpoint fails; retry only continues the same paid root', async () => {
  const f = await batchDurableFixture(); await f.register()
  const save = f.memory.store.compareAndSwap
  vi.mocked(save).mockImplementationOnce(async (key, expected, next) => {
    // Use the actual fixture CAS for item 0 then fail the next write.
    const snapshot = f.memory.get()!
    expect(snapshot.revision).toBe(next.revision - 1); f.memory.corrupt(next); void key; void expected
  }).mockRejectedValueOnce(Error('injected checkpoint failure'))
  await expect(f.adapter.completeUploads()).rejects.toThrow('injected checkpoint failure')
  expect(f.memory.get()!.certificates.map(value => value.index)).toEqual([0])
  const root = f.memory.get()!.registration!.packet
  await f.adapter.completeUploads()
  expect(f.memory.get()!.certificates).toHaveLength(3); expect(f.memory.get()!.registration!.packet).toEqual(root)
  expect(f.base.sign).not.toHaveBeenCalled()
})
it.each([[0, 0], [-1], [0.5], [NaN], [Infinity], [3], []].map(indices => ({ indices })))(
  'rejects malformed certificate indices $indices before any network or transaction mutation', async ({ indices }) => {
  const f = await batchDurableFixture(); await f.register(); f.confirmations.mockClear()
  const tx = new Transaction()
  expect(() => f.adapter.appendCertifyCalls(tx, indices)).toThrow('INDICES_INVALID')
  expect(tx.getData().commands).toHaveLength(0); expect(f.confirmations).not.toHaveBeenCalled()
})
it('consumed chunks are re-proved historically and never read as currently owned; remaining indices still certify', async () => {
  const f = await batchDurableFixture(); await f.register(); await f.consume([0, 1])
  f.verifiers.beforeBlobWrite = vi.fn(async ({ indices }: { indices: number[] }) => { if (indices.some(index => index !== 2)) throw Error('consumed blob must not be read as owned') })
  const cold = f.adapterFor(f.preparation); f.confirmations.mockClear()
  await cold.completeUploads()
  expect(f.confirmations).toHaveBeenCalledTimes(1)
  expect(vi.mocked(f.verifiers.beforeBlobWrite).mock.calls.every(([call]) => call.indices.every(index => index === 2))).toBe(true)
  await expect(cold.appendCertifyCalls(new Transaction(), [0])).rejects.toThrow('CERTIFY_INDEX_ALREADY_CONSUMED_OR_ATTACHED')
  expect(f.base.client.core.getObject).not.toHaveBeenCalled()
})
it('all completed files archive only after re-proving every parent receipt; historical reproof does not query present blobs', async () => {
  const f = await batchDurableFixture(); await f.register(); await f.consume([0, 1, 2])
  vi.mocked(f.verifiers.beforeBlobWrite).mockRejectedValue(Error('no current state allowed'))
  f.confirmations.mockClear(); const archive = await f.adapter.archiveCompleted()
  expect(f.memory.get()).toBeNull(); expect((await f.memory.store.readArchive(archive))!.consumptions).toHaveLength(1)
  expect(f.confirmations).not.toHaveBeenCalled(); expect(f.base.client.core.getObject).not.toHaveBeenCalled()
})
it('a persisted success flag cannot substitute for a production parent proof', async () => {
  const f = await batchDurableFixture(); const { packet } = await f.register(); f.registrations.delete(packet.digest)
  await expect(f.adapter.completeUploads()).rejects.toThrow('unproved parent registration')
  expect(f.confirmations).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
it('rejects a forged registered Blob/root/recipient even when a verifier returns it', async () => {
  const f = await batchDurableFixture(), { packet, proof } = await f.register()
  proof.blobs[0].recipient = `0x${'d'.repeat(64)}`; f.registrations.set(packet.digest, proof)
  await expect(f.adapter.completeUploads()).rejects.toThrow('REGISTER_BLOB_MISMATCH')
  expect(f.write).not.toHaveBeenCalled()
})
it('preserves multiplicity for duplicate public blobIds and rejects aliased registered objectIds', async () => {
  const f = await batchDurableFixture({ privateFiles: false }), { packet, proof } = await f.register()
  expect(new Set(proof.blobs.map(blob => blob.blobId)).size).toBe(1)
  expect(new Set(proof.blobs.map(blob => blob.objectId)).size).toBe(3)
  proof.blobs[1].objectId = proof.blobs[0].objectId; f.registrations.set(packet.digest, proof)
  await expect(f.adapter.completeUploads()).rejects.toThrow('REGISTER_BLOB_MISMATCH')
})
it('rejects a changed shard-count encoding without replacing, paying or writing incompatible slivers', async () => {
  const f = await batchDurableFixture(); await f.register(); const original = f.memory.get()!.registration
  f.setShards(7); f.setConfirmationsMissing(true)
  await expect(f.adapter.completeUploads()).rejects.toThrow('PAID_ENCODING_CHANGED_QUERY_OR_EXPORT')
  expect(f.write).not.toHaveBeenCalled(); expect(f.memory.get()!.registration).toEqual(original)
  expect(f.base.sign).not.toHaveBeenCalled()
})
it('supports confirmations-first continuation even when current shard-count differs, without trying to regenerate old slivers', async () => {
  const f = await batchDurableFixture(); await f.register(); f.encode.mockClear(); f.setShards(7)
  await f.adapter.completeUploads()
  expect(f.memory.get()!.certificates).toHaveLength(3); expect(f.encode).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
it('a wallet generation change during proof lookup prevents all subsequent storage I/O and checkpoints', async () => {
  const f = await batchDurableFixture(), { proof } = await f.register()
  let release: ((value: typeof proof) => void) | undefined
  vi.mocked(f.verifiers.verifyRegistration).mockImplementation(() => new Promise(resolve => { release = resolve }))
  const original = f.memory.get(), pending = f.adapter.completeUploads()
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); f.stale(); release!(proof)
  await expect(pending).rejects.toThrow('LIFETIME_CHANGED')
  expect(f.memory.get()).toEqual(original); expect(f.confirmations).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled()
})
it('abort reaches real SDK node writes and never records a late certificate', async () => {
  const f = await batchDurableFixture(); await f.register(); f.setConfirmationsMissing(true); f.holdNode(0)
  const pending = f.adapter.completeUploads()
  await vi.waitFor(() => expect(f.nodeWrite).toHaveBeenCalled()); f.controller.abort()
  await expect(pending).rejects.toThrow(); f.releaseNode()
  expect(f.memory.get()!.certificates).toHaveLength(0)
})
it('true SDK BLS validation rejects forged peer signatures before certify construction', async () => {
  const f = await batchDurableFixture(); await f.register(); f.invalidSignatures()
  await expect(f.adapter.appendCertifyCalls(new Transaction(), [0])).rejects.toThrow()
  expect(f.memory.get()!.certificates).toHaveLength(0); expect(f.base.sign).not.toHaveBeenCalled()
})
it('certificate wire parser rejects wrong blob, wrong object, duplicated signer and wrong epoch', async () => {
  const f = await batchDurableFixture(); await f.register(); const r = await f.adapter.completeUploads(), value = r.certificates[0].certificate
  const expected = { blobId: f.preparation.manifest.files[0].encoding.blobId, blobObjectId: r.registration!.blobs[0].objectId }
  expect(() => inspectWalrusBatchCertificate(value, { ...expected, epoch: 10 })).toThrow('EPOCH_MISMATCH')
  expect(() => inspectWalrusBatchCertificate(value, { ...expected, blobObjectId: `0x${'e'.repeat(64)}` })).toThrow('MESSAGE_MISMATCH')
  const cert = decodeWalrusBatchCertificate(value); cert.signers.push(cert.signers[0])
  expect(() => encodeWalrusBatchCertificate(cert)).toThrow('SHAPE_INVALID')
  expect(toBase64(decodeWalrusBatchCertificate(value).signature)).not.toBe('')
})
