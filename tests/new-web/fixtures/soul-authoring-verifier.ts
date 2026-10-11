import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, fromHex, toBase64 } from '@mysten/sui/utils'
import { soulAuthoringHistoryFixture } from './soul-authoring-history'
import { activityEvidenceFixture, activityGenesis, activityHash } from './activity-transaction-evidence'
import { prepareWalrusBatch, walrusBatchPreparationHash, walrusBatchJsonHash } from '../../../web/lib/upload/walrus-batch-preparation'
import { createWalrusBatchRecord } from '../../../web/lib/upload/walrus-batch-store'
import { soulAuthoringUploadScope, resolveSoulAuthoringImage } from '../../../web/lib/soulidity/soul-authoring-manifest'
import { createSoulAuthoringTransactionComposer } from '../../../web/lib/soulidity/soul-authoring-transaction'
import { soulAuthoringPlan } from '../../../web/lib/soulidity/soul-authoring-runner'
import { SoulAuthoringEventsBcs, SoulAuthoringEventCodecs } from '../../../web/lib/soulidity/soul-authoring-history'
import { createSoulAuthoringVerifier } from '../../../web/lib/soulidity/soul-authoring-verifier'
import type { SoulAuthoringPreparation } from '../../../web/lib/soulidity/soul-authoring-store'
import type { SoulAuthoringPacketRecord } from '../../../web/lib/soulidity/soul-authoring-packet'
import { batchHistoryFixture } from './walrus-batch-history'

/** Whole real proof composition, with canonical ledger/checkpoint/Object bytes
 * supplied by a controlled transport. No business/Walrus verifier is mocked.
 * This is not a validator execution, live storage payment or wallet test. */
export async function authoringZeroFileVerifierFixture(newKiosk = false) {
  const f = await soulAuthoringHistoryFixture({ register: 'collection', list: true, newKiosk }), old = f.build()
  const request = structuredClone(f.request); request.mints = []
  const preparation = await prepareWalrusBatch({ scope: soulAuthoringUploadScope(request), files: [], storageEpochs: request.storageEpochs,
    client: {} as any, protector: null, lifetime: { signal: f.controller.signal, getAddress: () => request.author, isCurrent: () => true } })
  const p: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', preparation,
    manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request, preparationHash: walrusBatchPreparationHash(preparation), sealContext: null, sidecars: [] } }
  const oldData = Transaction.from(old.record.packet.bytes).getData(), tx = new Transaction()
  const composer = createSoulAuthoringTransactionComposer(p.manifest, preparation), selected = old.record.plan.step
  if (selected.kind !== 'REGISTER') throw Error('Expected registration fixture')
  composer.appendRegistrationBusiness(tx, selected.kiosk)
  const data = tx.getData()
  data.inputs = data.inputs.map(input => {
    if (!input.UnresolvedObject) return input
    const id = input.UnresolvedObject.objectId, found = oldData.inputs.find(i => i.Object?.ImmOrOwnedObject?.objectId === id || i.Object?.SharedObject?.objectId === id)
    if (!found) throw Error('Missing fixture input reference'); return found
  })
  data.sender = request.author; data.gasData = oldData.gasData; data.expiration = oldData.expiration
  const bytes = TransactionDataBuilder.restore(data).build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const record: SoulAuthoringPacketRecord = { ...old.record, plan: soulAuthoringPlan(p, selected), packet: { ...old.record.packet, bytes: toBase64(bytes), digest } }
  const effects = old.context.effects; effects.V2!.transactionDigest = digest
  for (const [objectId, change] of effects.V2!.changedObjects) {
    if (!change.outputState.ObjectWrite) continue
    const row = f.rows.get(`${objectId}:12`), full = bcs.Object.parse(row.bcs.value)
    full.previousTransaction = digest; row.previousTransaction = digest; row.bcs.value = bcs.Object.serialize(full).toBytes()
    row.digest = activityHash('Object', row.bcs.value); change.outputState.ObjectWrite[0] = row.digest
  }
  const events = SoulAuthoringEventsBcs.parse(old.context.events)
  events[0].contents = SoulAuthoringEventCodecs.MintManifestCommittedV1.serialize({ author: request.author, manifest_hash: fromHex(composer.manifestHash) }).toBytes()
  const checkpoint = await activityEvidenceFixture()
  const client = { ledgerService: {
    getServiceInfo: vi.fn(async () => ({ response: { chainId: activityGenesis } })), getObject: f.getObject,
    getTransaction: vi.fn(async ({ digest: requested }: { digest: string }) => {
      if (requested !== record.packet.digest) throw Object.assign(Error('Not found'), { code: 'NOT_FOUND' })
      const rawEvents = SoulAuthoringEventsBcs.serialize(events).toBytes()
      effects.V2!.eventsDigest = activityHash('TransactionEvents', rawEvents)
      return { response: { transaction: { digest: requested, transaction: { digest: requested, bcs: { value: fromBase64(record.packet.bytes) } },
        checkpoint: 100n, effects: { bcs: { value: bcs.TransactionEffects.serialize(effects).toBytes() }, transactionDigest: requested,
          status: { success: effects.V2!.status.$kind === 'Success' } }, events: { bcs: { value: rawEvents } } } } }
    }),
    getCheckpoint: vi.fn(async () => {
      checkpoint.summaryData.sequence_number = '100'; checkpoint.summaryData.epoch = effects.V2!.executedEpoch
      checkpoint.contentsData.V2!.transactions[1].digest = { transaction: record.packet.digest,
        effects: activityHash('TransactionEffects', bcs.TransactionEffects.serialize(effects).toBytes()) }
      checkpoint.rehashContents(); return { response: { checkpoint: structuredClone(checkpoint.checkpoint) } }
    }),
  } }
  const journal = { read: vi.fn(async () => structuredClone(record) as SoulAuthoringPacketRecord | null), history: vi.fn(async () => [] as SoulAuthoringPacketRecord[]) }
  const uploads = { read: vi.fn(async () => createWalrusBatchRecord(preparation)) }
  const verifier = createSoulAuthoringVerifier({ client: client as any, preparation: p, journal, uploads })
  return { ...f, p, record, effects, rawEvents: events, client, journal, uploads, verifier,
    query: () => verifier.query(record, f.controller.signal),
    verifyRegistration: () => verifier.verifyRegistration({ preparation, packet: { bytes: record.packet.bytes, digest: record.packet.digest }, signal: f.controller.signal }) }
}

/** Public cover-only consume: actual installed Walrus register/certify graph,
 * System/Blob history and authoring Collection graph all run through production
 * proof code. BLS finality/Move execution/storage availability remain controlled. */
export async function authoringPaidCoverVerifierFixture() {
  const f = await authoringZeroFileVerifierFixture(true), w = await batchHistoryFixture(1, false, f.p.manifest.request.author)
  const originalConsume = await w.consumption() // construct controlled chain outputs before replacing the fixture-only business suffix
  const request = structuredClone(f.p.manifest.request)
  request.collection!.image = { kind: 'FILE', fileIndex: 0 }; request.storageEpochs = w.preparation.manifest.storageEpochs
  const preparation = structuredClone(w.preparation)
  preparation.manifest.scope = soulAuthoringUploadScope(request); preparation.manifestHash = walrusBatchJsonHash(preparation.manifest)
  const p: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', preparation,
    manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request, preparationHash: walrusBatchPreparationHash(preparation), sealContext: null, sidecars: [] } }
  const composer = createSoulAuthoringTransactionComposer(p.manifest, preparation)
  const data = Transaction.from(w.register.bytes).getData(), fake = data.commands.pop()!.MoveCall!
  if (fake.arguments[0].$kind !== 'Input' || fake.arguments[0].Input !== data.inputs.length - 1) throw Error('Fixture manifest input not last')
  data.inputs.pop()
  const tx = Transaction.from(TransactionDataBuilder.restore(data).build())
  composer.appendRegistrationBusiness(tx, { kind: 'NEW', kioskId: null, capId: null })
  const registerData = tx.getData(), businessInputs = Transaction.from(f.record.packet.bytes).getData().inputs
  registerData.inputs = registerData.inputs.map(input => {
    if (!input.UnresolvedObject) return input
    const value = businessInputs.find(i => i.Object?.SharedObject?.objectId === input.UnresolvedObject!.objectId)
    if (!value) throw Error('Unresolved business fixture input'); return value
  })
  const registerBytes = TransactionDataBuilder.restore(registerData).build()
  const register: SoulAuthoringPacketRecord = { ...f.record, plan: soulAuthoringPlan(p, f.record.plan.step),
    packet: { ...f.record.packet, bytes: toBase64(registerBytes), digest: TransactionDataBuilder.getDigestFromBytes(registerBytes) } }
  const registerEffects = w.registerEffects; registerEffects.V2!.transactionDigest = register.packet.digest
  // Rebind the controlled Walrus outputs to the actual composed packet.
  for (const [objectId, change] of registerEffects.V2!.changedObjects) if (change.outputState.ObjectWrite) {
    const row = w.rows.get(`${objectId}:10`), raw = bcs.Object.parse(row.bcs.value)
    const updated = w.base.object(objectId, 10, row.objectType, raw.data.Move!.contents, raw.owner, register.packet.digest)
    change.outputState.ObjectWrite[0] = updated.digest
  }
  // Business outputs share the registration's lamport version. Its preexisting
  // registry input is version9; new Kiosk and Collection are born at version10.
  for (const [objectId, change] of f.effects.V2!.changedObjects) {
    const row = f.rows.get(`${objectId}:12`), raw = bcs.Object.parse(row.bcs.value)
    if (objectId === f.ids.collection || objectId === f.ids.kiosk || objectId === f.ids.listing) raw.owner.Shared!.initialSharedVersion = '10'
    const right = f.specs.get('right')!
    if (objectId === right.objectId) raw.data.Move!.contents = right.codec.serialize({ ...right.value,
      image_url: resolveSoulAuthoringImage(request.collection!.image, request, preparation) }).toBytes()
    if (change.inputState.Exist) {
      const old = f.rows.get(`${objectId}:11`), input = bcs.Object.parse(old.bcs.value)
      const before = w.base.object(objectId, 9, old.objectType, input.data.Move!.contents, input.owner, input.previousTransaction)
      change.inputState.Exist[0] = ['9', before.digest]
    }
    const output = w.base.object(objectId, 10, row.objectType, raw.data.Move!.contents, raw.owner, register.packet.digest)
    change.outputState.ObjectWrite = [output.digest, raw.owner]; registerEffects.V2!.changedObjects.push([objectId, change])
  }
  const businessEvents = structuredClone(f.rawEvents)
  businessEvents[0].contents = SoulAuthoringEventCodecs.MintManifestCommittedV1.serialize({ author: request.author, manifest_hash: fromHex(composer.manifestHash) }).toBytes()
  const registerEvents = [...w.registerEvents, ...businessEvents]
  const consumeData = Transaction.from(originalConsume.packet.bytes).getData(); consumeData.commands.pop()
  consumeData.inputs.forEach(input => {
    const ref = input.Object?.ImmOrOwnedObject
    if (ref?.objectId === w.blobValues[0].id) ref.digest = w.rows.get(`${ref.objectId}:10`)!.digest
  })
  const consumeBytes = TransactionDataBuilder.restore(consumeData).build()
  const consume: SoulAuthoringPacketRecord = { ...register, plan: soulAuthoringPlan(p, { kind: 'MINT', chunk: { mintIndices: [], includePublicFiles: true,
    collectionObjectId: f.ids.collection, kiosk: { kind: 'EXISTING', kioskId: f.ids.kiosk, capId: f.ids.cap } } }),
    packet: { ...register.packet, bytes: toBase64(consumeBytes), digest: TransactionDataBuilder.getDigestFromBytes(consumeBytes) } }
  const effects = originalConsume.effects; effects.V2!.transactionDigest = consume.packet.digest
  const blobId = w.blobValues[0].id, oldBlob = w.rows.get(`${blobId}:12`), fullBlob = bcs.Object.parse(oldBlob.bcs.value)
  const blob = w.base.object(blobId, 12, oldBlob.objectType, fullBlob.data.Move!.contents, { AddressOwner: request.author }, consume.packet.digest)
  const change = effects.V2!.changedObjects.find(([id]) => id === blobId)![1]
  change.inputState.Exist![0] = ['10', w.rows.get(`${blobId}:10`)!.digest]
  change.outputState.ObjectWrite = [blob.digest, bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: request.author }).toBytes())]
  w.ledgers.clear()
  w.ledgers.set(register.packet.digest, { packet: register.packet, effects: registerEffects, events: registerEvents, checkpoint: 1n })
  w.ledgers.set(consume.packet.digest, { packet: consume.packet, effects, events: originalConsume.events, checkpoint: 2n })
  const journal = { read: vi.fn(async () => structuredClone(consume) as SoulAuthoringPacketRecord | null),
    history: vi.fn(async () => [structuredClone(register)]) }
  const upload = createWalrusBatchRecord(preparation), uploads = { read: vi.fn(async () => structuredClone(upload)) }
  const verifier = createSoulAuthoringVerifier({ client: w.transport as any, preparation: p, journal, uploads })
  upload.registration = await verifier.verifyRegistration({ preparation, packet: { bytes: register.packet.bytes, digest: register.packet.digest }, signal: f.controller.signal })
  upload.certificates = originalConsume.params.certificates
  return { p, register, consume, registerEffects, effects, registerEvents, upload, journal, uploads, verifier, w,
    controller: f.controller, query: () => verifier.query(consume, f.controller.signal) }
}
