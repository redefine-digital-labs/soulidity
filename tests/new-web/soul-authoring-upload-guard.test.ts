import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Blob as WalrusBlob } from '../../web/node_modules/@mysten/walrus/dist/contracts/walrus/blob.mjs'
import { authoringPaidCoverVerifierFixture } from './fixtures/soul-authoring-verifier'
import { createSoulAuthoringUploadGuard } from '../../web/lib/soulidity/soul-authoring-upload-guard'
import type { SoulAuthoringPacketRecord } from '../../web/lib/soulidity/soul-authoring-packet'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await authoringPaidCoverVerifierFixture(), blob = f.upload.registration!.blobs[0]
  f.journal.history.mockImplementation(async () => [])
  f.journal.read.mockImplementation(async () => structuredClone(f.register))
  let current = structuredClone(f.w.rows.get(`${blob.objectId}:${blob.version}`))
  const historical = f.w.transport.ledgerService.getObject.getMockImplementation()!
  const liveReads = vi.fn(async () => ({ response: { object: structuredClone(current) } }))
  f.w.transport.ledgerService.getObject.mockImplementation(async input => input.version === undefined
    ? liveReads() : historical(input))
  const authoring = { read: vi.fn(async () => structuredClone(f.p)) }
  const walrus = { reset: vi.fn(), systemState: vi.fn(async () => ({ committee: { epoch: 9 } })) }
  const getTarget = vi.fn(() => structuredClone(f.p.manifest.request.target))
  const lifetime = { signal: f.controller.signal, getAddress: vi.fn(() => f.p.manifest.request.author), isCurrent: vi.fn(() => true) }
  const guard = createSoulAuthoringUploadGuard({ client: f.w.transport as any, walrus: walrus as any,
    preparation: f.p, lifetime, getTarget, authoring, uploads: f.uploads, journal: f.journal })
  const input = { preparation: f.p.preparation, registration: f.upload.registration!, indices: [0], signal: f.controller.signal }
  function mutate(edit: (raw: ReturnType<typeof bcs.Object.parse>) => void, version = 11) {
    const raw = bcs.Object.parse(current.bcs.value); edit(raw)
    current = f.w.base.object(blob.objectId, version, current.objectType, raw.data.Move!.contents, raw.owner, raw.previousTransaction)
  }
  return { ...f, guard, input, authoring, walrus, lifetime, getTarget, liveReads, mutate,
    getCurrent: () => current, setCurrent: (value: typeof current) => { current = value },
    run: () => guard.beforeBlobWrite(input) }
}
it('permits only the paid unconsumed Blob, using real complete registration proof and two fresh reads', async () => {
  const f = await fixture(); await f.run()
  expect(f.liveReads).toHaveBeenCalledTimes(2)
  expect(f.walrus.reset).toHaveBeenCalledTimes(1)
  expect(f.walrus.systemState).toHaveBeenCalledTimes(1)
  expect(f.w.base.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('allows a higher owned reference only when the entire original Blob contents remain unchanged', async () => {
  const f = await fixture(); f.mutate(() => {}, 11); await f.run()
})
it.each(['owner', 'certified', 'storage-id', 'storage-size', 'payload'] as const)('rejects rehashed %s changes despite a valid registration receipt', async change => {
  const f = await fixture()
  f.mutate(raw => {
    if (change === 'owner') { raw.owner = bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: id(999) }).toBytes()); return }
    const blob = WalrusBlob.parse(raw.data.Move!.contents)
    if (change === 'certified') blob.certified_epoch = 9
    if (change === 'storage-id') blob.storage.id = id(999)
    if (change === 'storage-size') blob.storage.storage_size = String(BigInt(blob.storage.storage_size) + 1n)
    if (change === 'payload') blob.size = String(BigInt(blob.size) + 1n)
    raw.data.Move!.contents = WalrusBlob.serialize(blob).toBytes()
  })
  await expect(f.run()).rejects.toThrow(change === 'owner' ? 'BYTES_OR_OWNER_CHANGED' : 'CONTENT_CHANGED')
})
it('rejects changed current BCS under an unchanged claimed digest', async () => {
  const f = await fixture(), row = structuredClone(f.getCurrent())
  row.bcs.value[row.bcs.value.length - 1] ^= 1; f.setCurrent(row)
  await expect(f.run()).rejects.toThrow('BYTES_OR_OWNER_CHANGED')
})
it.each([8, 12, NaN])('rejects unavailable/expired storage epoch %s without node writes', async epoch => {
  const f = await fixture(); f.walrus.systemState.mockResolvedValue({ committee: { epoch } })
  await expect(f.run()).rejects.toThrow('PAID_STORAGE_EXPIRED_OR_WRONG_EPOCH')
  expect(f.liveReads).toHaveBeenCalledTimes(1)
})
it('rejects a reference change during the uncached epoch read', async () => {
  const f = await fixture()
  f.walrus.systemState.mockImplementation(async () => { f.mutate(() => {}, 11); return { committee: { epoch: 9 } } })
  await expect(f.run()).rejects.toThrow('UNCONSUMED_BLOB_CHANGED_RETRY')
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'] as const)('keeps unknown %s parent query-only even with healthy paid storage', async phase => {
  const f = await fixture(), pending = structuredClone(f.consume)
  pending.packet.phase = phase
  if (phase === 'SIGNED') pending.packet.signature = 'AQ=='
  f.journal.history.mockImplementation(async () => [structuredClone(f.register)])
  f.journal.read.mockImplementation(async () => pending)
  f.w.ledgers.delete(pending.packet.digest)
  const read = f.w.transport.ledgerService.getTransaction.getMockImplementation()!
  f.w.transport.ledgerService.getTransaction.mockImplementation(async arg => {
    if (arg.digest === pending.packet.digest) throw Object.assign(Error('Not found'), { code: 'NOT_FOUND' })
    return read(arg)
  })
  await expect(f.run()).rejects.toThrow('UNRESOLVED_PACKET_QUERY_ONLY')
  expect(f.liveReads).not.toHaveBeenCalled()
})
it('does not confuse a safely cancelled unsigned attempt with an unknown signed attempt', async () => {
  const f = await fixture(), cancelled: SoulAuthoringPacketRecord = structuredClone(f.consume)
  cancelled.packet.phase = 'CANCELLED'; cancelled.packet.signature = null
  f.journal.history.mockImplementation(async () => [cancelled])
  const read = f.w.transport.ledgerService.getTransaction.getMockImplementation()!
  f.w.transport.ledgerService.getTransaction.mockImplementation(async arg => {
    if (arg.digest === cancelled.packet.digest) throw Object.assign(Error('Not found'), { code: 'NOT_FOUND' })
    return read(arg)
  })
  await f.run()
})
it('rejects actual consumed Blob even when the uploader missed durable consumption acceptance', async () => {
  const f = await fixture()
  f.journal.history.mockImplementation(async () => [structuredClone(f.register)])
  f.journal.read.mockImplementation(async () => structuredClone(f.consume))
  await expect(f.run()).rejects.toThrow('BLOB_ALREADY_CONSUMED')
  expect(f.liveReads).not.toHaveBeenCalled()
})
it.each(['release', 'wallet', 'generation', 'durable-parent', 'chain'] as const)('blocks %s drift before current-Blob reads', async kind => {
  const f = await fixture()
  if (kind === 'release') f.getTarget.mockImplementation(() => ({ ...f.p.manifest.request.target, callablePackageId: id(999) }))
  if (kind === 'wallet') f.lifetime.getAddress.mockReturnValue(id(999))
  if (kind === 'generation') f.lifetime.isCurrent.mockReturnValue(false)
  if (kind === 'durable-parent') f.authoring.read.mockRejectedValue(Error('Storage unavailable'))
  if (kind === 'chain') f.w.transport.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId: 'wrong-chain' } })
  await expect(f.run()).rejects.toThrow()
  expect(f.liveReads).not.toHaveBeenCalled()
})
it('rejects a new parent head appearing during live reads', async () => {
  const f = await fixture()
  f.walrus.systemState.mockImplementation(async () => {
    f.journal.read.mockImplementation(async () => structuredClone(f.consume)); return { committee: { epoch: 9 } }
  })
  await expect(f.run()).rejects.toThrow('PARENT_CHANGED_RETRY')
})
it('rejects changed uploader checkpoints during live reads', async () => {
  const f = await fixture()
  f.walrus.systemState.mockImplementation(async () => { f.upload.revision++; return { committee: { epoch: 9 } } })
  await expect(f.run()).rejects.toThrow('UPLOAD_CHANGED_RETRY')
})
it('honors abort during the live epoch read', async () => {
  const f = await fixture()
  f.walrus.systemState.mockImplementation(async () => { f.controller.abort(Error('Cancelled')); return { committee: { epoch: 9 } } })
  await expect(f.run()).rejects.toThrow('Cancelled')
})
