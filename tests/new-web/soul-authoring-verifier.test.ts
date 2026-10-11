import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { authoringZeroFileVerifierFixture, authoringPaidCoverVerifierFixture } from './fixtures/soul-authoring-verifier'
import { SoulAuthoringEventCodecs } from '../../web/lib/soulidity/soul-authoring-history'
import { createSoulAuthoringVerifier } from '../../web/lib/soulidity/soul-authoring-verifier'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'

afterEach(() => vi.restoreAllMocks())
it('recovers the paid public cover through real Walrus and authoring proofs without another payment', async () => {
  const f = await authoringPaidCoverVerifierFixture(), result = await f.query()
  expect(result.status).toBe('SUCCEEDED')
  if (result.status !== 'SUCCEEDED') throw Error('Expected proof')
  expect(result.receipt.business.mints).toEqual([])
  expect(result.receipt.consumption?.indices).toEqual([0])
  expect(result.receipt.consumption?.registerDigest).toBe(f.register.packet.digest)
  expect(result.receipt.registration).toEqual(f.upload.registration)
  expect(f.w.base.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('cold recovery uses a new verifier instance and independently proves the direct uploader consumption API', async () => {
  const f = await authoringPaidCoverVerifierFixture()
  const cold = createSoulAuthoringVerifier({ client: f.w.transport as any, preparation: structuredClone(f.p), journal: f.journal, uploads: f.uploads })
  expect((await cold.query(f.consume, f.controller.signal)).status).toBe('SUCCEEDED')
  const input = { preparation: f.p.preparation, registration: f.upload.registration!, packet: {
    bytes: f.consume.packet.bytes, digest: f.consume.packet.digest }, indices: [0], certificates: f.upload.certificates, signal: f.controller.signal }
  expect((await cold.verifyConsumption(input)).registerDigest).toBe(f.register.packet.digest)
  await expect(cold.verifyConsumption({ ...input, indices: [] })).rejects.toThrow('CONSUMPTION_PLAN_INDICES')
})
it('rejects fully rehashed public cover ownership changes after valid storage certification', async () => {
  const f = await authoringPaidCoverVerifierFixture(), blobId = f.upload.registration!.blobs[0].objectId
  const row = f.w.rows.get(`${blobId}:12`)!, raw = bcs.Object.parse(row.bcs.value)
  const changed = f.w.base.object(blobId, 12, row.objectType, raw.data.Move!.contents, { AddressOwner: id(999) }, f.consume.packet.digest)
  const owner = bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: id(999) }).toBytes())
  f.effects.V2!.changedObjects.find(([key]) => key === blobId)![1].outputState.ObjectWrite = [changed.digest, owner]
  await expect(f.query()).rejects.toThrow('PUBLIC_BLOB_RECIPIENT')
})
it('rejects two independently checkpointed but contradictory effect snapshots for the exact consume packet', async () => {
  const f = await authoringPaidCoverVerifierFixture(), get = f.w.transport.ledgerService.getTransaction
  const original = get.getMockImplementation()!; let currentReads = 0
  get.mockImplementation(async input => {
    if (input.digest === f.consume.packet.digest && ++currentReads === 2) f.effects.V2!.gasUsed.storageCost = '999'
    return original(input)
  })
  await expect(f.query()).rejects.toThrow('PROOF_QUERY_CONTRADICTION')
})
it.each(['missing-register', 'wrong-manifest-event', 'missing-certificate', 'changed-certificate'] as const)
  ('rejects paid-cover recovery with %s', async mode => {
    const f = await authoringPaidCoverVerifierFixture()
    if (mode === 'missing-register') f.journal.history.mockResolvedValue([])
    if (mode === 'missing-certificate') f.upload.certificates = []
    if (mode === 'changed-certificate') f.upload.certificates[0].certificate = f.upload.certificates[0].certificate.slice(0, -4) + 'AAAA'
    if (mode === 'wrong-manifest-event') {
      const e = f.registerEvents.find(e => e.type_.name === 'MintManifestCommittedV1')!, codec = SoulAuthoringEventCodecs.MintManifestCommittedV1
      const value = codec.parse(e.contents); value.manifest_hash[0] ^= 1; e.contents = codec.serialize(value).toBytes()
    }
    await expect(f.query()).rejects.toThrow()
    expect(f.w.base.client.core.executeTransaction).not.toHaveBeenCalled()
  })
it.each([false, true])('proves zero-file Collection registration through the real verifier stack, newKiosk=%s', async newKiosk => {
  const f = await authoringZeroFileVerifierFixture(newKiosk), result = await f.query()
  expect(result.status).toBe('SUCCEEDED')
  if (result.status !== 'SUCCEEDED') throw Error('Expected proved success')
  expect(result.receipt.registration.blobs).toEqual([])
  expect(result.receipt.business.collection?.collectionId).toBe(f.ids.collection)
  expect(result.receipt.business.collection?.listingId).toBe(f.ids.listing)
  expect(result.receipt.consumption).toBeNull(); expect(f.uploads.read).not.toHaveBeenCalled()
  expect((await f.verifyRegistration()).packet.digest).toBe(f.record.packet.digest)
})
it('recovers an archived exact registration, without requiring the current head to be that transaction', async () => {
  const f = await authoringZeroFileVerifierFixture()
  f.journal.read.mockResolvedValue(null); f.journal.history.mockResolvedValue([f.record])
  expect((await f.query()).status).toBe('SUCCEEDED')
})
it.each(['missing', 'duplicate'] as const)('rejects %s durable registration rather than accepting remote success alone', async mode => {
  const f = await authoringZeroFileVerifierFixture()
  if (mode === 'missing') f.journal.read.mockResolvedValue(null)
  else f.journal.history.mockResolvedValue([f.record])
  await expect(f.query()).rejects.toThrow(mode === 'missing' ? 'DURABLE_PROOF_PACKET_REQUIRED' : 'PROOF_HISTORY_ALIAS_OR_BUDGET')
  expect(f.getObject).not.toHaveBeenCalled()
})
it('never reuses an earlier successful business receipt for the next query', async () => {
  const f = await authoringZeroFileVerifierFixture(); expect((await f.query()).status).toBe('SUCCEEDED')
  const codec = SoulAuthoringEventCodecs.MintManifestCommittedV1, value = codec.parse(f.rawEvents[0].contents)
  value.manifest_hash[0] ^= 1; f.rawEvents[0].contents = codec.serialize(value).toBytes()
  await expect(f.query()).rejects.toThrow('MANIFEST_EVENT_HASH')
})
it('does not consult storage or business proof for an explicitly missing remote transaction', async () => {
  const f = await authoringZeroFileVerifierFixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce(Object.assign(Error('Not found'), { code: 'NOT_FOUND' }))
  expect(await f.query()).toEqual({ status: 'MISSING' }); expect(f.journal.read).not.toHaveBeenCalled()
})
it('does not conflate finalized failure with a created Collection', async () => {
  const f = await authoringZeroFileVerifierFixture()
  f.effects.V2!.status = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...f.effects.V2!,
    status: { Failure: { error: { InsufficientGas: true }, command: null } } } }).toBytes()).V2!.status
  expect(await f.query()).toEqual({ status: 'FAILED', checkpoint: '100' }); expect(f.journal.read).not.toHaveBeenCalled()
})
it('checks full chain identity for direct uploader registration verification too', async () => {
  const f = await authoringZeroFileVerifierFixture()
  f.client.ledgerService.getServiceInfo.mockResolvedValueOnce({ response: { chainId: 'wrong-chain' } })
  await expect(f.verifyRegistration()).rejects.toThrow('CHAIN_MISMATCH'); expect(f.journal.read).not.toHaveBeenCalled()
})
it('preserves cancellation and unavailable durable history as retryable failures', async () => {
  const f = await authoringZeroFileVerifierFixture(); f.journal.history.mockRejectedValueOnce(Error('History unavailable'))
  await expect(f.query()).rejects.toThrow('History unavailable')
  f.controller.abort(Error('cancelled verification')); await expect(f.query()).rejects.toThrow('cancelled verification')
})
