import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, fromHex, toBase64 } from '@mysten/sui/utils'
import { deriveMintContentObjectId, SoulPublicBcs, SoulStatePublicBcs, SoulDetailStateBcs,
  SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs, SoulStatePointerKeyV1Bcs,
  SoulPublicKioskBcs, SoulPublicCollectionBcs, KioskItemWrapperBcs, KIOSK_ITEM_WRAPPER_TYPE } from '@soulidity/sdk'
import { Blob as BlobBcs } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/blob.mjs'
import { blobIdToInt } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
// @ts-expect-error Installed SDK runtime utility has no declaration file.
import { encodedBlobLength } from '../../../web/node_modules/@mysten/walrus/dist/utils/index.mjs'
import { authoringZeroFileVerifierFixture } from './soul-authoring-verifier'
import { batchHistoryFixture } from './walrus-batch-history'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './content-append-preparation'
import { soulAuthoringRequestFixture } from './soul-authoring'
import { createWalrusBatchSealProtector } from '../../../web/lib/upload/walrus-batch-seal'
import { prepareWalrusBatch, walrusBatchPreparationHash } from '../../../web/lib/upload/walrus-batch-preparation'
import { createWalrusBatchRecord } from '../../../web/lib/upload/walrus-batch-store'
import { encodeWalrusBatchCertificate } from '../../../web/lib/upload/walrus-batch-certificate'
import { soulAuthoringUploadScope, soulAuthoringSealContext, createSoulAuthoringMaterializer,
  resolveSoulAuthoringImage } from '../../../web/lib/soulidity/soul-authoring-manifest'
import { createSoulAuthoringTransactionComposer } from '../../../web/lib/soulidity/soul-authoring-transaction'
import { soulAuthoringPlan } from '../../../web/lib/soulidity/soul-authoring-runner'
import { SoulAuthoringEventsBcs, SoulAuthoringEventCodecs } from '../../../web/lib/soulidity/soul-authoring-history'
import { createSoulAuthoringVerifier } from '../../../web/lib/soulidity/soul-authoring-verifier'
import { contentEnvelopeKey } from '../../../web/lib/soulidity/content-envelope'
import type { SoulAuthoringPreparation } from '../../../web/lib/soulidity/soul-authoring-store'
import type { SoulAuthoringPacketRecord } from '../../../web/lib/soulidity/soul-authoring-packet'
import type { SoulAuthoringRecovery } from '../../../web/lib/soulidity/soul-authoring-recovery'

const A = bcs.Address, U = bcs.u64(), N = bcs.u32(), S = bcs.string(), B = bcs.bool(), V = bcs.vector(bcs.u8())
const BlobKey = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: U })
const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
const Lock = bcs.struct('Lock', { id: A })
const tag = (type: string) => {
  const parsed = TypeTagSerializer.parseFromStr(type)
  if (!('struct' in parsed)) throw Error('Fixture requires a struct type')
  return parsed.struct
}

/** 23 intended Souls, exactly the first 10 minted and bound. Actual SDK PTBs,
 * encrypted envelopes, WASM Blob metadata and full Object/effect/checkpoint BCS
 * are fed to the unmodified production verifier. Ledger execution/finality and
 * Seal servers remain controlled; this is neither payment nor a wallet test. */
export async function soulAuthoringPartialRecoveryFixture(total = 23, completed = 10) {
  if (!Number.isInteger(total) || completed < 1 || completed >= total || total > 1000)
    throw Error('Expected a genuinely partial Collection')
  const registrationTemplate = await authoringZeroFileVerifierFixture(true)
  const crypto = await contentAppendPreparationFixture(), author = crypto.signer.toSuiAddress()
  const w = await batchHistoryFixture(1 + total * 2, false, author)
  // Reuse the independently encoded historical System upgrade/read-only row.
  await w.consumption([0])
  const request = structuredClone(registrationTemplate.p.manifest.request), t = request.target, pkg = t.originalPackageId
  request.collection!.image = { kind: 'FILE', fileIndex: 0 }
  request.storageEpochs = 3
  const template = soulAuthoringRequestFixture(author).mints[0]
  request.mints = Array.from({ length: total }, (_, index) => {
    const mintNonce = (index + 1).toString(16).padStart(32, '0')
    return { ...structuredClone(template), mintNonce, name: `Partial Soul ${index + 1}`,
      contentObjectId: deriveMintContentObjectId({ ...t, author, mintNonce: fromHex(mintNonce) }),
      image: { kind: 'FILE' as const, fileIndex: 0 }, publicPreview: { tags: ['partial'], previewImages: [{ kind: 'FILE' as const, fileIndex: 0 }] },
      slots: template.slots.map((slot, i) => ({ ...slot, fileIndex: 1 + index * 2 + i })) }
  })
  const lifetime = { signal: crypto.controller.signal, getAddress: () => author, isCurrent: () => true }
  const sealContext = soulAuthoringSealContext(request, crypto.params.sealConfig, '3'.repeat(32))
  const protector = createWalrusBatchSealProtector({ context: sealContext, wallet: crypto.params.wallet, lifetime })
  const preparation = await prepareWalrusBatch({ scope: soulAuthoringUploadScope(request), storageEpochs: 3, lifetime,
    files: [{ file: new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'cover.png', { type: 'image/png' }),
      uploadType: 'public', kind: 'persona-sprite' }, ...request.mints.flatMap((mint, index) => mint.slots.map((_, slot) => ({
      file: new File([`Private original Collection content for Soul ${index + 1}, slot ${slot}. Never stored in plaintext recovery.`], `content-${index + 1}-${slot}.md`, { type: 'text/markdown' }),
      uploadType: 'encrypted' as const, kind: 'soul-content' as const })))],
    client: { reset() {}, systemState: async () => ({ committee: { epoch: 9, n_shards: 10 } }),
      encodeBlob: async (bytes: Uint8Array) => {
        const value = await w.base.walrus.computeBlobMetadata({ bytes, numShards: 10, nonce: new Uint8Array(32) })
        return { ...value, metadata: { V1: { unencoded_length: value.metadata.unencodedLength, encoding_type: value.metadata.encodingType } } }
      } } as any,
    protector: protector.protector })
  const p: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', preparation,
    manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request, preparationHash: walrusBatchPreparationHash(preparation),
      sealContext, sidecars: protector.sidecars(preparation.manifestHash) } }
  const composer = createSoulAuthoringTransactionComposer(p.manifest, preparation), ids = registrationTemplate.ids
  const cache = w.base.client.cache.scope('@mysten/walrus')
  function packageFor(value: string) {
    w.base.walrus.reset(); cache.readSync(['getSystemPackageId'], () => value); cache.readSync(['walType'], () => `${id(6)}::wal::WAL`)
  }
  async function packet(tx: Transaction, register: boolean) {
    await tx.prepareForSerialization({})
    const data = tx.getData()
    data.inputs = data.inputs.map(input => {
      if (!input.UnresolvedObject) return input
      const objectId = input.UnresolvedObject.objectId
      if (objectId === id(88) || objectId === ids.cap || w.blobValues.some(v => v.id === objectId)) {
        const row = w.rows.get(`${objectId}:10`)
        return Inputs.ObjectRef({ objectId, version: row ? '10' : '9', digest: row?.digest ?? w.base.registeredBlob.digest })
      }
      return Inputs.SharedObjectRef({ objectId, initialSharedVersion: [ids.kiosk, ids.collection].includes(objectId) ? '10' : '1',
        mutable: [t.kioskRegistryId, ids.kiosk, ids.collection].includes(objectId) || objectId === w.base.systemId && register })
    })
    data.sender = author; data.expiration = { $kind: 'Epoch', Epoch: '20' }
    data.gasData = { owner: author, price: '1000', budget: '100000000', payment: [{ objectId: id(90), version: '1', digest: w.base.registeredBlob.digest }] }
    const bytes = TransactionDataBuilder.restore(data).build()
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '20', phase: 'SUCCEEDED' as const, signature: null }
  }
  packageFor(w.base.registerPackage)
  const registerTx = new Transaction()
  const blobs = preparation.manifest.files.map(file => registerTx.add(w.base.walrus.registerBlob({ size: file.payloadByteLength,
    epochs: 3, blobId: file.encoding.blobId, rootHash: fromBase64(file.encoding.rootHash), deletable: true, walCoin: registerTx.object(id(88)) })))
  blobs.forEach(blob => registerTx.transferObjects([blob], author))
  const registerStep = { kind: 'REGISTER' as const, kiosk: { kind: 'NEW' as const, kioskId: null, capId: null } }
  composer.appendRegistrationBusiness(registerTx, registerStep.kiosk)
  const register: SoulAuthoringPacketRecord = { schema: 'soulidity.soul-authoring-packet.v1', plan: soulAuthoringPlan(p, registerStep), packet: await packet(registerTx, true) }
  const registerEffects = w.registerEffects; registerEffects.V2!.transactionDigest = register.packet.digest
  const owned = { AddressOwner: author }, shared = { Shared: { initialSharedVersion: '12' } }
  const registerEvents = preparation.manifest.files.map((file, index) => {
    Object.assign(w.blobValues[index], { blob_id: String(blobIdToInt(file.encoding.blobId)), size: String(file.payloadByteLength),
      storage: { ...w.blobValues[index].storage, storage_size: String(encodedBlobLength(file.payloadByteLength, 10)) } })
    return { ...w.registerEvents[index], contents: w.Registered.serialize({ epoch: 9, blob_id: w.blobValues[index].blob_id,
      size: String(file.payloadByteLength), encoding_type: 1, end_epoch: 12, deletable: true, object_id: w.blobValues[index].id }).toBytes() }
  })
  for (const [objectId, change] of registerEffects.V2!.changedObjects) if (change.outputState.ObjectWrite) {
    const row = w.rows.get(`${objectId}:10`), raw = bcs.Object.parse(row.bcs.value), index = w.blobValues.findIndex(blob => blob.id === objectId)
    const next = w.base.object(objectId, 10, row.objectType, index < 0 ? raw.data.Move!.contents : BlobBcs.serialize(w.blobValues[index]).toBytes(), raw.owner, register.packet.digest)
    change.outputState.ObjectWrite[0] = next.digest
  }
  for (const [objectId, changeInput] of registrationTemplate.effects.V2!.changedObjects) {
    const change = structuredClone(changeInput), row = registrationTemplate.rows.get(`${objectId}:12`), raw = bcs.Object.parse(row.bcs.value)
    if (raw.owner.Shared?.initialSharedVersion === '12') raw.owner.Shared.initialSharedVersion = '10'
    const right = registrationTemplate.specs.get('right')!
    if (objectId === right.objectId) raw.data.Move!.contents = right.codec.serialize({ ...right.value,
      image_url: resolveSoulAuthoringImage(request.collection!.image, request, preparation) }).toBytes()
    if (change.inputState.Exist) {
      const before = registrationTemplate.rows.get(`${objectId}:11`), full = bcs.Object.parse(before.bcs.value)
      const input = w.base.object(objectId, 9, before.objectType, full.data.Move!.contents, full.owner, full.previousTransaction)
      change.inputState.Exist[0] = ['9', input.digest]
    }
    const output = w.base.object(objectId, 10, row.objectType, raw.data.Move!.contents, raw.owner, register.packet.digest)
    change.outputState.ObjectWrite = [output.digest, raw.owner]; registerEffects.V2!.changedObjects.push([objectId, change])
  }
  const registrationEvents = structuredClone(registrationTemplate.rawEvents)
  registrationEvents[0].contents = SoulAuthoringEventCodecs.MintManifestCommittedV1.serialize({ author, manifest_hash: fromHex(composer.manifestHash) }).toBytes()
  registerEvents.push(...registrationEvents)

  const chunk = { mintIndices: Array.from({ length: completed }, (_, i) => i), includePublicFiles: true,
    collectionObjectId: ids.collection, kiosk: { kind: 'EXISTING' as const, kioskId: ids.kiosk, capId: ids.cap } }
  const stage = composer.prepareMintBusiness(preparation, w.blobValues.map(b => b.id), chunk), mintTx = new Transaction()
  packageFor(w.base.certifyPackage)
  const Message = bcs.struct('Message', { intent: bcs.struct('Intent', { type: bcs.u8(), version: bcs.u8(), appId: bcs.u8() }), epoch: N,
    messageContents: bcs.struct('Body', { blobId: bcs.u256(), blobType: bcs.enum('Type', { Permanent: null, Deletable: bcs.struct('Deletable', { objectId: A }) }) }) })
  const certificates = stage.fileIndices.map(index => {
    const file = preparation.manifest.files[index], certificate = encodeWalrusBatchCertificate({ signers: [0, 8], signature: new Uint8Array(96).fill(2),
      serializedMessage: Message.serialize({ intent: { type: 1, version: 0, appId: 3 }, epoch: 10,
        messageContents: { blobId: blobIdToInt(file.encoding.blobId), blobType: { Deletable: { objectId: w.blobValues[index].id } } } }).toBytes() })
    mintTx.add(w.base.walrus.certifyBlob({ blobId: file.encoding.blobId, blobObjectId: w.blobValues[index].id, certificate, deletable: true }))
    return { index, certificate }
  })
  await mintTx.prepareForSerialization({}); stage.append(mintTx)
  const mint: SoulAuthoringPacketRecord = { schema: 'soulidity.soul-authoring-packet.v1', plan: soulAuthoringPlan(p, { kind: 'MINT', chunk }), packet: await packet(mintTx, false) }
  const changes: any[] = [], businessEvents: any[] = []
  function add(objectId: string, type: string, codec: any, value: any, owner: any, before?: any) {
    const row = w.base.object(objectId, 12, type, codec.serialize(value).toBytes(), owner, mint.packet.digest)
    changes.push(w.base.change(row, !before, before, before ? bcs.Object.parse(before.bcs.value).owner : undefined)); return row
  }
  function field(parent: string, keyType: string, keyCodec: any, key: any, valueType: string, codec: any, value: any) {
    const objectId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(key).toBytes())
    add(objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, bcs.struct('Field', { id: A, name: keyCodec, value: codec }),
      { id: objectId, name: key, value }, { ObjectOwner: parent }); return objectId
  }
  function event(name: keyof typeof SoulAuthoringEventCodecs, module: string, value: any) {
    businessEvents.push({ package_id: t.callablePackageId, transaction_module: name === 'SoulAddedToCollection' ? 'collection' : 'market',
      sender: author, type_: tag(`${pkg}::${module}::${name}`), contents: (SoulAuthoringEventCodecs[name] as any).serialize(value).toBytes() })
  }
  for (const [objectId, codec, transform] of [[ids.kiosk, SoulPublicKioskBcs, (v: any) => ({ ...v, item_count: v.item_count + completed })],
    [ids.collection, SoulPublicCollectionBcs, (v: any) => ({ ...v, current_supply: String(completed) })],
    [t.kioskRegistryId, bcs.struct('Registry', { id: A, version: U }), (v: any) => v]] as const) {
    const before = w.rows.get(`${objectId}:10`), full = bcs.Object.parse(before.bcs.value)
    add(objectId, before.objectType, codec, transform(codec.parse(full.data.Move!.contents)), full.owner, before)
  }
  const materialize = createSoulAuthoringMaterializer(p.manifest, preparation, w.blobValues.map(b => b.id))
  const blobOwners = new Map<number, any>([[0, owned]])
  for (let index = 0; index < completed; index++) {
    const args = materialize(index), m = request.mints[index], root = 10000 + index * 30
    const soulId = id(root), stateId = id(root + 1), paidId = id(root + 2), contentId = m.contentObjectId
    const table = (offset: number, size = 0) => ({ id: id(root + offset), size: String(size) })
    const custody = field(ids.kiosk, KIOSK_ITEM_WRAPPER_TYPE, KioskItemWrapperBcs, { name: { id: soulId } }, '0x2::object::ID', A, soulId)
    field(ids.kiosk, '0x2::kiosk::Lock', Lock, { id: soulId }, 'bool', B, true)
    add(soulId, `${pkg}::soul::Soul`, SoulPublicBcs, { id: soulId, version: '1', name: args.name, description: args.description,
      image_url: args.imageUrl, creator: author, provenance_kind: 0, origin_ref: null }, { ObjectOwner: custody })
    const config = table(5, args.initialStateConfig.length + 2), items = table(8, 2), counts = table(9, 2)
    add(stateId, `${pkg}::soul::SoulState`, SoulStatePublicBcs, { id: stateId, version: '1', soul_id: soulId, creator: author,
      creator_royalty_bps: m.creatorRoyaltyBps, current_owner: author, current_kiosk_id: ids.kiosk, ownership_epoch: '0', grant_capacity: '1',
      active_grants: table(3), active_grant_ids: table(4), active_grant_count: '0', content_id: contentId, config_ext: config,
      collection_id: ids.collection, access_list_id: paidId, is_listed: false }, shared)
    field(soulId, `${pkg}::soul::SoulStatePointerKeyV1`, SoulStatePointerKeyV1Bcs, { version: 1 }, '0x2::object::ID', A, stateId)
    add(paidId, `${pkg}::paid_access::SoulPaidAccessList`, SoulDetailStateBcs.Paid, { id: paidId, version: '1', soul_id: soulId,
      creator: author, kind_configs: table(6), entries: table(7) }, shared)
    add(contentId, `${pkg}::content::SoulContent`, SoulContentPublicBcs, { id: contentId, version: '1', soul_id: soulId,
      items, count_by_kind: counts, active: table(10) }, shared)
    event('SoulContentCreated', 'content', { content_id: contentId, soul_id: soulId })
    const configEvent = (key: string) => event('SoulStateConfigUpserted', 'soul', { state_id: stateId, soul_id: soulId, updater: author, key })
    args.initialStateConfig.forEach(c => field(config.id, '0x1::string::String', S, c.key, 'vector<u8>', V, [...new TextEncoder().encode(c.valueUtf8)]))
    ;[...args.initialStateConfig].reverse().forEach(c => configEvent(c.key))
    args.initialContent.forEach((entry, slotIndex) => {
      const e = { content_id: contentId, soul_id: soulId, kind: entry.kind, kind_name: slotIndex ? 'memory' : 'soul_doc', name: entry.name,
        version_index: '0', is_public: false, download_policy: 0, grant_scope_mask: '1', read_mode_mask: '3', op_mask: slotIndex ? '1' : '0',
        seal_encrypted: true, blob_object_id: entry.blobObjectId, created_at_ms: '1000' }
      field(items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind: entry.kind, name: entry.name },
        `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), [{ version: '1', kind: e.kind, blob_object_id: e.blob_object_id,
          is_public: false, deleted: false, purged: false, download_policy: 0, grant_scope_mask: e.grant_scope_mask,
          read_mode_mask: '3', op_mask: e.op_mask, seal_encrypted: true, created_at_ms: '1000' }])
      field(counts.id, 'u32', N, entry.kind, 'u64', U, '1')
      const wrapper = field(contentId, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper,
        { name: { kind: entry.kind, name: entry.name, version_index: '0' } }, '0x2::object::ID', A, entry.blobObjectId)
      blobOwners.set(m.slots[slotIndex].fileIndex, { ObjectOwner: wrapper })
      const key = contentEnvelopeKey({ contentObjectId: contentId, kind: entry.kind, name: entry.name, versionIndex: '0', blobObjectId: entry.blobObjectId })
      field(config.id, '0x1::string::String', S, key, 'vector<u8>', V, [...entry.encryptedEnvelope])
      event('ContentVersionAppended', 'content', e); configEvent(key)
    })
    event('SoulPaidAccessListCreated', 'paid_access', { paid_access_list_id: paidId, soul_id: soulId, creator: author })
    event('SoulCreated', 'soul', { soul_id: soulId, state_id: stateId, content_id: contentId, creator: author, owner: author, provenance_kind: 0 })
    event('SoulMintedToKiosk', 'market', { soul_id: soulId, state_id: stateId, content_id: contentId, kiosk_id: ids.kiosk, owner: author, provenance_kind: 0 })
    event('SoulAddedToCollection', 'collection', { collection_id: ids.collection, soul_id: soulId, current_supply: String(index + 1), max_supply: '100' })
  }
  const certifiedEvents = stage.fileIndices.map(index => {
    const value = w.blobValues[index], before = w.rows.get(`${value.id}:10`)
    add(value.id, before.objectType, BlobBcs, { ...value, certified_epoch: 10 }, blobOwners.get(index), before)
    return { ...w.registerEvents[index], package_id: w.base.certifyPackage, type_: { ...w.registerEvents[index].type_, name: 'BlobCertified' },
      contents: w.Certified.serialize({ epoch: 10, blob_id: value.blob_id, end_epoch: 12, deletable: true, object_id: value.id, is_extension: false }).toBytes() }
  })
  const system = w.rows.get(`${w.base.systemId}:11`)
  const effects = w.base.effects(mint.packet.digest, 12, changes, [[w.base.systemId, { ReadOnlyRoot: ['11', system.digest] }]])
  w.ledgers.clear()
  w.ledgers.set(register.packet.digest, { packet: register.packet, effects: registerEffects, events: registerEvents, checkpoint: 1n })
  w.ledgers.set(mint.packet.digest, { packet: mint.packet, effects, events: [...certifiedEvents, ...businessEvents], checkpoint: 2n })
  const upload = createWalrusBatchRecord(preparation)
  const bundle: SoulAuthoringRecovery = { schema: 'soulidity.soul-authoring-recovery.v1', manifest: p.manifest, upload, head: mint, history: [register] }
  const journal = { read: async () => bundle.head, history: async () => bundle.history }, uploads = { read: async () => bundle.upload }
  const verifier = createSoulAuthoringVerifier({ client: w.transport as any, preparation: p, journal, uploads })
  upload.registration = await verifier.verifyRegistration({ preparation, packet: { bytes: register.packet.bytes, digest: register.packet.digest }, signal: lifetime.signal })
  upload.certificates = certificates
  // Intentionally omit local consumption acceptance: restore must re-prove it.
  return { p, bundle, register, mint, w, verifier, completed, total,
    params: { bundle, client: w.transport as any, target: t, lifetime },
    rawBusinessEvents: SoulAuthoringEventsBcs.serialize(businessEvents).toBytes() }
}
