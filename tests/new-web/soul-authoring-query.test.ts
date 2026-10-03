import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58 } from '@mysten/sui/utils'
import { batchHistoryFixture } from './fixtures/walrus-batch-history'
import { soulAuthoringRequestFixture } from './fixtures/soul-authoring'
import { soulAuthoringUploadScope } from '../../web/lib/soulidity/soul-authoring-manifest'
import { prepareWalrusBatch, walrusBatchPreparationHash } from '../../web/lib/upload/walrus-batch-preparation'
import type { SoulAuthoringPreparation } from '../../web/lib/soulidity/soul-authoring-store'
import type { SoulAuthoringPacketRecord } from '../../web/lib/soulidity/soul-authoring-packet'
import { soulAuthoringPlan } from '../../web/lib/soulidity/soul-authoring-runner'
import { querySoulAuthoringPacket } from '../../web/lib/soulidity/soul-authoring-query'

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const f = await batchHistoryFixture(0), request = soulAuthoringRequestFixture(f.preparation.manifest.scope.owner)
  request.collection = { name: 'Empty', description: 'Raw query fixture', image: request.mints[0].image, extraRoyaltyBps: 0,
    tradeable: true, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }; request.mints = []
  const upload = await prepareWalrusBatch({ scope: soulAuthoringUploadScope(request), files: [], storageEpochs: request.storageEpochs,
    client: {} as any, protector: null, lifetime: { signal: f.controller.signal, getAddress: () => request.author, isCurrent: () => true } })
  const preparation: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', preparation: upload,
    manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request, preparationHash: walrusBatchPreparationHash(upload), sealContext: null, sidecars: [] } }
  const record: SoulAuthoringPacketRecord = { schema: 'soulidity.soul-authoring-packet.v1', plan: soulAuthoringPlan(preparation,
    { kind: 'REGISTER', kiosk: { kind: 'NEW', kioskId: null, capId: null } }),
  packet: { ...f.register, expirationEpoch: '20', phase: 'SIGNED', signature: 'AQ==' } }
  // Raw chain/checkpoint bytes are controlled, with actual canonical codecs.
  // The business callback is deliberately fake; no authoring-success claim.
  const proveSuccess = vi.fn(async () => ({ controlledBusinessReceipt: true }))
  const params = { client: f.transport as any, preparation, record, signal: f.controller.signal, proveSuccess }
  return { ...f, params, proveSuccess, query: () => querySoulAuthoringPacket(params) }
}
it('requires full business proof after exact bytes/effects/checkpoint/events, never current ownership', async () => {
  const f = await fixture(), result = await f.query()
  expect(result).toEqual({ status: 'SUCCEEDED', checkpoint: '1', receipt: { controlledBusinessReceipt: true } })
  expect(f.proveSuccess).toHaveBeenCalledTimes(1)
  expect(f.base.client.core.getObject).not.toHaveBeenCalled(); expect(f.base.client.core.executeTransaction).not.toHaveBeenCalled()
})
it('only exact NOT_FOUND is missing; transport failures never authorize a replacement', async () => {
  const f = await fixture()
  f.transport.ledgerService.getTransaction.mockRejectedValueOnce(Object.assign(Error('not found'), { code: 'NOT_FOUND' }))
  expect(await f.query()).toEqual({ status: 'MISSING' })
  f.transport.ledgerService.getTransaction.mockRejectedValueOnce(Error('offline'))
  await expect(f.query()).rejects.toThrow('offline'); expect(f.proveSuccess).not.toHaveBeenCalled()
})
it('uncheckpointed raw execution remains pending', async () => {
  const f = await fixture(), read = f.transport.ledgerService.getTransaction.getMockImplementation()!
  f.transport.ledgerService.getTransaction.mockImplementationOnce(async input => {
    const value = await read(input); delete (value.response.transaction as any).checkpoint; return value
  })
  expect(await f.query()).toEqual({ status: 'PENDING' }); expect(f.proveSuccess).not.toHaveBeenCalled()
})
it('recognizes finalized failure only after checkpoint membership, without claiming a business receipt', async () => {
  const f = await fixture()
  f.registerEffects.V2!.status = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { ...f.registerEffects.V2!,
    status: { Failure: { error: { InsufficientGas: true }, command: null } } } }).toBytes()).V2!.status
  expect(await f.query()).toEqual({ status: 'FAILED', checkpoint: '1' })
  expect(f.transport.ledgerService.getCheckpoint).toHaveBeenCalled(); expect(f.proveSuccess).not.toHaveBeenCalled()
})
it('a business proof failure never becomes successful creation', async () => {
  const f = await fixture(); f.proveSuccess.mockRejectedValueOnce(Error('wrong content UID'))
  await expect(f.query()).rejects.toThrow('wrong content UID')
  await expect(querySoulAuthoringPacket({ ...f.params, proveSuccess: undefined as any })).rejects.toThrow('BUSINESS_VERIFIER_REQUIRED')
})
it.each(['bytes', 'status', 'effects-digest', 'events', 'epoch', 'checkpoint'])('rejects raw %s contradiction', async variant => {
  const f = await fixture(), read = f.transport.ledgerService.getTransaction.getMockImplementation()!
  f.transport.ledgerService.getTransaction.mockImplementationOnce(async input => {
    const value = await read(input), r = value.response.transaction
    if (variant === 'bytes') r.transaction.bcs.value[0] ^= 1
    if (variant === 'status') r.effects.status.success = false
    if (variant === 'effects-digest') r.effects.transactionDigest = toBase58(new Uint8Array(32).fill(8))
    if (variant === 'events') r.events.bcs.value[0] ^= 1
    if (variant === 'epoch') { const e = bcs.TransactionEffects.parse(r.effects.bcs.value); e.V2!.executedEpoch = '21'; r.effects.bcs.value = bcs.TransactionEffects.serialize(e).toBytes() }
    if (variant === 'checkpoint') { const e = bcs.TransactionEffects.parse(r.effects.bcs.value); e.V2!.gasUsed.storageCost = '99'; r.effects.bcs.value = bcs.TransactionEffects.serialize(e).toBytes() }
    return value
  })
  await expect(f.query()).rejects.toThrow(); expect(f.proveSuccess).not.toHaveBeenCalled()
})
it('checks chain identity even when the transaction would be missing', async () => {
  const f = await fixture(); f.transport.ledgerService.getServiceInfo.mockResolvedValueOnce({ response: { chainId: 'wrong-chain' } })
  await expect(f.query()).rejects.toThrow('CHAIN_MISMATCH'); expect(f.transport.ledgerService.getTransaction).not.toHaveBeenCalled()
})
