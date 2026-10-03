import { afterEach, expect, it, vi } from 'vitest'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { soulAuthoringManifestFixture } from './fixtures/soul-authoring'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { createSoulAuthoringTransactionComposer } from '../../web/lib/soulidity/soul-authoring-transaction'
import { soulAuthoringPlan } from '../../web/lib/soulidity/soul-authoring-runner'
import { assertSoulAuthoringBusinessGraph } from '../../web/lib/soulidity/soul-authoring-graph'
import type { SoulAuthoringPreparation } from '../../web/lib/soulidity/soul-authoring-store'
import type { SoulAuthoringPacketRecord, SoulAuthoringStep } from '../../web/lib/soulidity/soul-authoring-packet'

afterEach(() => vi.restoreAllMocks())
async function fixture(kind: 'REGISTER' | 'ORDINARY' | 'IMPORTED' | 'JOINED' | 'EMPTY', newKiosk = false) {
  const f = await soulAuthoringManifestFixture(r => {
    if (kind === 'REGISTER' || kind === 'EMPTY') {
      r.collection = { name: 'Collection', description: 'Metadata', image: kind === 'EMPTY' ? { kind: 'FILE', fileIndex: 0 } : r.mints[0].image,
        extraRoyaltyBps: 100, tradeable: true, maxSupply: null, floorPriceAtomic: '12', listingPriceAtomic: '34' }
      if (kind === 'EMPTY') r.mints = []
    } else {
      r.mints[0].kind = kind; r.mints[0].listingPriceAtomic = '100'
      r.bindCollectionId = id(70)
      if (kind !== 'ORDINARY') r.mints[0].originRef = 'Original provenance'
      if (kind === 'JOINED') r.mints[0].source = { objectId: id(71), objectType: `${id(72)}::source::Item` }
    }
  })
  const preparation: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', manifest: f.manifest, preparation: f.preparation }
  const kiosk = newKiosk ? { kind: 'NEW' as const, kioskId: null, capId: null } : { kind: 'EXISTING' as const, kioskId: id(80), capId: id(81) }
  const step: SoulAuthoringStep = kind === 'REGISTER' ? { kind: 'REGISTER', kiosk } : { kind: 'MINT',
    chunk: { mintIndices: kind === 'EMPTY' ? [] : [0], includePublicFiles: true, collectionObjectId: id(70), kiosk } }
  const blobIds = f.preparation.manifest.files.map((_, i) => id(90 + i))
  const tx = new Transaction(), composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation)
  tx.moveCall({ target: `${id(200)}::walrus_fixture::checked_prefix`, arguments: [tx.pure.u64(777)] })
  if (step.kind === 'REGISTER') composer.appendRegistrationBusiness(tx, kiosk)
  else composer.prepareMintBusiness(f.preparation, blobIds, step.chunk).append(tx)
  function packet(data = tx.getData()): SoulAuthoringPacketRecord {
    data.inputs = data.inputs.map(i => i.UnresolvedObject ? Inputs.ObjectRef({ objectId: i.UnresolvedObject.objectId,
      version: '1', digest: toBase58(new Uint8Array(32).fill(6)) }) : i)
    data.sender = f.request.author; data.expiration = { $kind: 'Epoch', Epoch: '10' }
    data.gasData = { owner: f.request.author, price: '1', budget: '100000', payment: [{ objectId: id(900), version: '1', digest: toBase58(new Uint8Array(32).fill(9)) }] }
    const bytes = TransactionDataBuilder.restore(data).build()
    return { schema: 'soulidity.soul-authoring-packet.v1', plan: soulAuthoringPlan(preparation, step),
      packet: { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null } }
  }
  const verify = (record = packet(), skip = [0]) => assertSoulAuthoringBusinessGraph({ preparation, record, walrusCommandIndices: skip, registeredBlobIds: blobIds })
  return { ...f, preparation, tx, packet, verify }
}
it.each(['REGISTER', 'ORDINARY', 'IMPORTED', 'JOINED', 'EMPTY'] as const)('verifies independent %s business graph after a checked uploader prefix', async kind => {
  const f = await fixture(kind); expect(f.verify().businessCommandIndices.length).toBe(f.tx.getData().commands.length - 1)
})
it.each(['REGISTER', 'ORDINARY', 'JOINED'] as const)('preserves new personal Kiosk Result/NestedResult relationships for %s', async kind => {
  const f = await fixture(kind, true); expect(f.verify().businessCommandIndices.length).toBeGreaterThan(3)
})
it.each(['extra-command', 'missing-command', 'callee', 'pure', 'object', 'result', 'type', 'unused-input', 'claimed-business'] as const)('rejects %s without trusting observed suffix as its template', async variant => {
  const f = await fixture('ORDINARY'), data = f.tx.getData()
  if (variant === 'extra-command') data.commands.push(structuredClone(data.commands.at(-1)!))
  if (variant === 'missing-command') data.commands.pop()
  if (variant === 'callee') data.commands.at(-1)!.MoveCall!.function = 'unexpected_function'
  if (variant === 'pure') data.inputs.find(i => i.Pure && i.Pure.bytes !== data.inputs[0].Pure?.bytes)!.Pure!.bytes = toBase64(new Uint8Array([99]))
  if (variant === 'object') data.inputs.find(i => i.UnresolvedObject)!.UnresolvedObject!.objectId = id(999)
  if (variant === 'result') data.commands.at(-1)!.MoveCall!.arguments[0] = { $kind: 'Result', Result: 0 }
  if (variant === 'type') data.commands.find(c => c.MakeMoveVec)!.MakeMoveVec!.type = `${id(888)}::bad::Type`
  if (variant === 'unused-input') data.inputs.push(Inputs.Pure(new Uint8Array([88])))
  expect(() => f.verify(f.packet(data), variant === 'claimed-business' ? [0, 1] : [0])).toThrow()
})
it('rejects duplicate/out-of-range uploader command claims and gas/source aliases', async () => {
  const f = await fixture('ORDINARY'), record = f.packet()
  expect(() => f.verify(record, [0, 0])).toThrow('WALRUS_COMMAND_INDICES')
  expect(() => f.verify(record, [999])).toThrow('WALRUS_COMMAND_INDICES')
  const tx = Transaction.from(record.packet.bytes), data = tx.getData()
  const reference = data.inputs.find(i => i.Object?.ImmOrOwnedObject)!.Object!.ImmOrOwnedObject!
  data.gasData.payment = [reference]
  const bytes = TransactionDataBuilder.restore(data).build()
  expect(() => f.verify({ ...record, packet: { ...record.packet, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) } })).toThrow('GAS_INPUT_ALIAS')
})
it('rejects Receiving substituted for a business object reference', async () => {
  const f = await fixture('ORDINARY'), data = Transaction.from(f.packet().packet.bytes).getData()
  const index = data.inputs.findIndex(i => i.Object?.ImmOrOwnedObject)
  data.inputs[index] = Inputs.ReceivingRef(data.inputs[index].Object!.ImmOrOwnedObject!)
  expect(() => f.verify(f.packet(data))).toThrow('BUSINESS_OBJECT_MISMATCH')
})
