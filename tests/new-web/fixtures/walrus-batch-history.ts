import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { ClientCache } from '@mysten/sui/client'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { blobIdToInt, WalrusClient, MAINNET_WALRUS_PACKAGE_CONFIG } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
// @ts-expect-error Installed SDK ships this independent runtime codec without declarations.
import { System } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/system.mjs'
// @ts-expect-error Installed SDK ships this independent runtime codec without declarations.
import { SystemStateInnerV1 } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/system_state_inner.mjs'
import { Blob } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/blob.mjs'
// @ts-expect-error Installed SDK does not publish declarations for its size utility.
import { encodedBlobLength } from '../../../web/node_modules/@mysten/walrus/dist/utils/index.mjs'
import { encodeWalrusBatchCertificate } from '../../../web/lib/upload/walrus-batch-certificate'
import { createWalrusBatchHistoryVerifier, type WalrusBatchParentHistoryContext } from '../../../web/lib/upload/walrus-batch-history'
import { walrusBatchHash, walrusBatchJsonHash, type WalrusBatchPreparation } from '../../../web/lib/upload/walrus-batch-preparation'
import { activityEvidenceFixture, activityHash, activityGenesis, ActivityFixtureEventsBcs } from './activity-transaction-evidence'
import { uid, singleSigner } from './walrus-single-upload'

async function historyBase(ownerOverride?: string) {
  const owner = ownerOverride ?? singleSigner.toSuiAddress(), payload = new TextEncoder().encode('Historical batch payload'), rows = new Map<string, any>()
  const origin = uid(3), registerPackage = uid(4), certifyPackage = uid(5), systemId = MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId
  const fieldId = deriveDynamicFieldID(systemId, 'u64', bcs.u64().serialize(1).toBytes()), prior = activityHash('fixture', new Uint8Array([1]))
  const forbidden = () => { throw Error('Historical verifier attempted a live or write path') }
  const client = { cache: new ClientCache(), core: {
    getObject: vi.fn(forbidden), executeTransaction: vi.fn(forbidden), getBalance: vi.fn(forbidden),
    resolveTransactionPlugin: () => async (_data: any, _opts: any, next: () => Promise<void>) => next(),
  }, ledgerService: { getObject: vi.fn(async ({ objectId, version }: { objectId: string; version: bigint }) => {
    if (version === undefined) forbidden()
    const row = rows.get(`${objectId}:${version}`); if (!row) throw Error('Historical object unavailable')
    return { response: { object: structuredClone(row) } }
  }) } }
  const walrus = new WalrusClient({ network: 'mainnet', suiClient: client as any })
  const state = { committee: { epoch: 9, n_shards: 10, members: Array.from({ length: 9 }, (_, index) => ({
    public_key: { bytes: [1, 2] }, weight: index === 8 ? 2 : 1, node_id: uid(300 + index) })), total_aggregated_key: { bytes: [3, 4] } },
    total_capacity_size: '1000000', used_capacity_size: '1000', storage_price_per_unit_size: '1', write_price_per_unit_size: '1',
    future_accounting: { current_index: 0, length: 0, ring_buffer: [] },
    event_blob_certification_state: { latest_certified_blob: null, aggregate_weight_per_blob: { contents: [] } }, deny_list_sizes: { id: uid(333) } }
  const stateSpy = vi.spyOn(walrus, 'systemState').mockResolvedValue(state), systemSpy = vi.spyOn(walrus, 'systemObject')
    .mockResolvedValue({ id: systemId, version: '1', package_id: registerPackage, new_package_id: null })
  vi.spyOn(walrus, 'storageCost').mockResolvedValue({ storageCost: 3n, writeCost: 1n, totalCost: 4n })
  const metadata = await walrus.computeBlobMetadata({ bytes: payload, numShards: 10, nonce: new Uint8Array(32) })
  function object(objectId: string, version: number, type: string, bytes: Uint8Array, owner: any, previousTransaction: string) {
    type = normalizeStructTag(type); const tag = TypeTagSerializer.parseFromStr(type)
    if (!('struct' in tag)) throw Error('fixture Move struct type required')
    const full = bcs.Object.serialize({ data: { Move: { type: { Other: tag.struct }, hasPublicTransfer: true,
      version: String(version), contents: bytes } }, owner, previousTransaction, storageRebate: '0' }).toBytes()
    const rawOwner = owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner }
      : { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) }
    const row = { objectId, version: BigInt(version), objectType: type, contents: { value: bytes }, bcs: { value: full },
      digest: activityHash('Object', full), owner: rawOwner, previousTransaction }
    rows.set(`${objectId}:${version}`, row); return row
  }
  function change(row: any, created: boolean, before?: any, inputOwner?: any) {
    const owner = row.owner.kind === 1 ? { AddressOwner: row.owner.address } : row.owner.kind === 2 ? { ObjectOwner: row.owner.address }
      : { Shared: { initialSharedVersion: String(row.owner.version) } }
    return [row.objectId, { inputState: created ? { NotExist: true } : { Exist: [[String(before?.version ?? 9), before?.digest ?? prior], inputOwner ?? owner] },
      outputState: { ObjectWrite: [row.digest, owner] }, idOperation: created ? { Created: true } : { None: true } }]
  }
  function effects(digest: string, version: number, changedObjects: any[], unchangedConsensusObjects: any[] = []) {
    return bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { transactionDigest: digest, status: { Success: true }, executedEpoch: '9',
      gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' }, lamportVersion: String(version),
      changedObjects, unchangedConsensusObjects, gasObjectIndex: null, eventsDigest: null, dependencies: [], auxDataDigest: null } }).toBytes())
  }
  const field = { contents: { value: bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: SystemStateInnerV1 })
    .serialize({ id: fieldId, name: '1', value: state }).toBytes() }, objectType: normalizeStructTag(`0x2::dynamic_field::Field<u64,${origin}::system_state_inner::SystemStateInnerV1>`) }
  return { record: { intent: { owner } }, params: { payload }, rows, origin, registerPackage, certifyPackage, systemId, fieldId, client,
    walrus, stateSpy, systemSpy, metadata, object, change, effects, field, registeredBlob: { digest: prior }, oldSystem: { previousTransaction: prior } }
}

// Actual SDK graph + WASM metadata and independent SDK object codecs. Sui
// execution/checkpoint finality is controlled, not mainnet/quorum acceptance.
export async function batchHistoryFixture(count = 2, automaticCoins: boolean | 'address' | 'mixed' | 'exact' | 'merge' = false, ownerOverride?: string) {
  const base = await historyBase(ownerOverride), owner = base.record.intent.owner, payload = base.params.payload
  const state = bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: SystemStateInnerV1 }).parse(base.field.contents.value).value
  state.committee.members[8].weight = 2
  base.stateSpy.mockResolvedValue(state); base.systemSpy.mockResolvedValue({ id: base.systemId, version: '1', package_id: base.registerPackage, new_package_id: null })
  vi.mocked(base.walrus.storageCost).mockResolvedValue({ storageCost: 3n, writeCost: 1n, totalCost: 4n })
  const cache = base.client.cache.scope('@mysten/walrus')
  if (automaticCoins) {
    const coinBalance = automaticCoins === 'address' ? 0 : automaticCoins === 'mixed' ? 1 : automaticCoins === 'exact' ? count * 4 : 1000000
    const addressBalance = automaticCoins === 'address' ? 1000000 : automaticCoins === 'mixed' ? count * 4 - 1 : 0
    Object.assign(base.client.core, {
      getBalance: vi.fn(async () => ({ balance: { balance: String(coinBalance + addressBalance), coinBalance: String(coinBalance), addressBalance: String(addressBalance) } })),
      listCoins: vi.fn(async () => ({ objects: coinBalance ? (automaticCoins === 'merge' ? [1, 999999] : [coinBalance]).map((balance, index) => ({
        objectId: uid(88 + index), version: '9', digest: base.registeredBlob.digest, balance: String(balance) })) : [], hasNextPage: false, cursor: null })),
    })
  }
  base.walrus.reset(); cache.readSync(['getSystemPackageId'], () => base.registerPackage); cache.readSync(['walType'], () => `${uid(6)}::wal::WAL`)
  const files = Array.from({ length: count }, (_, index) => ({ index, recipient: owner, kind: 'soul-content' as const, uploadType: 'public' as const,
    fileName: `same-${index}.txt`, mimeType: 'text/plain', plaintextByteLength: payload.length, payloadByteLength: payload.length,
    contentHash: walrusBatchHash(payload), payloadHash: walrusBatchHash(payload), skillName: null,
    encoding: { blobId: base.metadata.blobId, rootHash: toBase64(base.metadata.rootHash), encodingType: 'RS2' as const, nShards: 10 } }))
  const manifest = { schema: 'soulidity.walrus-batch-manifest.v1' as const, scope: { network: 'mainnet' as const, owner,
    releaseHash: 'a'.repeat(64), operationId: 'batch-history', intentHash: 'b'.repeat(64) }, storageEpochs: 3, files }
  const preparation: WalrusBatchPreparation = { schema: 'soulidity.walrus-batch-preparation.v1', manifest, manifestHash: walrusBatchJsonHash(manifest),
    payloads: files.map(() => new Uint8Array(payload)), privateRecovery: null }
  const blobIds = files.map(file => uid(1000 + file.index)), storageIds = files.map(file => uid(2000 + file.index)), rows = base.rows
  base.client.core.resolveTransactionPlugin = () => async (data: any, _opts: any, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => !input.UnresolvedObject ? input : input.UnresolvedObject.objectId === base.systemId
      ? Inputs.SharedObjectRef({ objectId: base.systemId, initialSharedVersion: '1', mutable: !data.commands.some((c: any) => c.MoveCall?.function === 'certify_blob') })
      : Inputs.ObjectRef({ objectId: input.UnresolvedObject.objectId, version: blobIds.includes(input.UnresolvedObject.objectId) ? '10' : '9',
        digest: rows.get(`${input.UnresolvedObject.objectId}:10`)?.digest ?? base.registeredBlob.digest }))
    await next()
  }
  async function packet(tx: Transaction) {
    tx.setSender(owner); tx.setGasOwner(owner); tx.setGasBudget(100000000); tx.setGasPrice(1000)
    tx.setGasPayment([{ objectId: uid(90), version: '1', digest: base.registeredBlob.digest }]); tx.setExpiration({ Epoch: 20 })
    const bytes = await tx.build({ client: base.client as any }); return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
  }
  const registrationTx = new Transaction()
  const results = files.map(file => registrationTx.add(base.walrus.registerBlob({ size: file.payloadByteLength, epochs: 3,
    blobId: file.encoding.blobId, rootHash: fromBase64(file.encoding.rootHash), deletable: true, ...(automaticCoins ? {} : { walCoin: registrationTx.object(uid(88)) }) })))
  results.forEach(result => registrationTx.transferObjects([result], owner))
  registrationTx.moveCall({ target: `${uid(400)}::fixture::commit_manifest`, arguments: [registrationTx.pure.vector('u8', new Uint8Array(32).fill(3))] })
  const register = await packet(registrationTx)
  const shared = { Shared: { initialSharedVersion: '1' } }, owned = { AddressOwner: owner }, size = encodedBlobLength(payload.length, 10)
  const system = base.object(base.systemId, 10, `${base.origin}::system::System`, System.serialize({ id: base.systemId, version: '1',
    package_id: base.registerPackage, new_package_id: null }).toBytes(), shared, register.digest)
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: SystemStateInnerV1 })
  const field = base.object(base.fieldId, 10, base.field.objectType, Field.serialize({ id: base.fieldId, name: '1', value: state }).toBytes(), { ObjectOwner: base.systemId }, register.digest)
  const blobValues = files.map(file => ({ id: blobIds[file.index], registered_epoch: 9, blob_id: String(blobIdToInt(file.encoding.blobId)),
    size: String(payload.length), encoding_type: 1, certified_epoch: null as number | null, storage: { id: storageIds[file.index], start_epoch: 9, end_epoch: 12, storage_size: String(size) }, deletable: true }))
  const registeredRows = blobValues.map(value => base.object(value.id, 10, `${base.origin}::blob::Blob`, Blob.serialize(value).toBytes(), owned, register.digest))
  const registerEffects = base.effects(register.digest, 10, count ? [base.change(system, false), base.change(field, false), ...registeredRows.map(row => base.change(row, true)),
    ...storageIds.map(id => [id, { inputState: { NotExist: true }, outputState: { NotExist: true }, idOperation: { Created: true } }])] : [])
  const Registered = bcs.struct('BlobRegistered', { epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(), encoding_type: bcs.u8(),
    end_epoch: bcs.u32(), deletable: bcs.bool(), object_id: bcs.Address })
  const Certified = bcs.struct('BlobCertified', { epoch: bcs.u32(), blob_id: bcs.u256(), end_epoch: bcs.u32(), deletable: bcs.bool(), object_id: bcs.Address, is_extension: bcs.bool() })
  function event(name: string, bytes: Uint8Array, pkg: string) { return { package_id: pkg, transaction_module: 'system', sender: owner,
    type_: { address: base.origin, module: 'events', name, typeParams: [] }, contents: bytes } }
  const registerEvents = blobValues.map(value => event('BlobRegistered', Registered.serialize({ epoch: 9, blob_id: value.blob_id,
    size: value.size, encoding_type: 1, end_epoch: 12, deletable: true, object_id: value.id }).toBytes(), base.registerPackage))
  const ledgers = new Map<string, { packet: typeof register; effects: typeof registerEffects;
    events: ReturnType<typeof ActivityFixtureEventsBcs.parse>['data']; checkpoint: bigint }>()
  ledgers.set(register.digest, { packet: register, effects: registerEffects, events: registerEvents, checkpoint: 1n })
  const checkpoint = await activityEvidenceFixture()
  const transport = {
    ...base.client,
    ledgerService: { ...base.client.ledgerService,
      getServiceInfo: vi.fn(async () => ({ response: { chainId: activityGenesis } })),
      getTransaction: vi.fn(async ({ digest }: { digest: string }) => {
        const row = ledgers.get(digest)!; if (!row) throw Error('MISSING')
        const bytes = ActivityFixtureEventsBcs.serialize({ data: row.events }).toBytes()
        row.effects.V2!.eventsDigest = activityHash('TransactionEvents', bytes)
        return { response: { transaction: { digest, transaction: { digest, bcs: { value: fromBase64(row.packet.bytes) } }, checkpoint: row.checkpoint,
          effects: { bcs: { value: bcs.TransactionEffects.serialize(row.effects).toBytes() }, transactionDigest: digest,
            status: { success: row.effects.V2!.status.$kind === 'Success' } }, events: { bcs: { value: bytes } } } } }
      }),
      getCheckpoint: vi.fn(async ({ checkpointId }: any) => {
        const row = [...ledgers.values()].find(row => row.checkpoint === checkpointId.sequenceNumber)!
        checkpoint.summaryData.sequence_number = String(row.checkpoint); checkpoint.summaryData.epoch = row.effects.V2!.executedEpoch
        checkpoint.contentsData.V2!.transactions[1].digest = { transaction: row.packet.digest,
          effects: activityHash('TransactionEffects', bcs.TransactionEffects.serialize(row.effects).toBytes()) }
        checkpoint.rehashContents(); return { response: { checkpoint: structuredClone(checkpoint.checkpoint) } }
      }),
    },
  }
  const parent = vi.fn(async (context: WalrusBatchParentHistoryContext) => {
    const data = Transaction.from(fromBase64(context.packet.bytes)).getData()
    const other = data.commands.filter((_, i) => !context.walrusCommandIndices.includes(i))
    if (other.length !== 1 || other[0].MoveCall?.package !== uid(400) || other[0].MoveCall?.module !== 'fixture'
      || other[0].MoveCall?.function !== (context.stage === 'register' ? 'commit_manifest' : 'mint')) throw Error('PARENT_FULL_GRAPH_REJECTED')
  })
  const controller = new AbortController(), verifier = createWalrusBatchHistoryVerifier({ client: transport as any, chainIdentifier: '35834a8a', verifyParentTransaction: parent })
  const proveRegister = () => verifier.verifyRegistration({ preparation, packet: register, signal: controller.signal })
  async function rewriteRegister(edit: (tx: Transaction) => Transaction | void) {
    const tx = Transaction.from(fromBase64(register.bytes)), edited = edit(tx)
    const next = await packet(edited ?? tx), previous = register.digest, ledger = ledgers.get(previous)!
    for (const [id, change] of ledger.effects.V2!.changedObjects) {
      if (!change.outputState.ObjectWrite) continue
      const row = rows.get(`${id}:10`), full = bcs.Object.parse(row.bcs.value)
      const updated = base.object(id, 10, row.objectType, full.data.Move!.contents, full.owner, next.digest)
      change.outputState.ObjectWrite[0] = updated.digest
    }
    Object.assign(register, next); ledger.effects.V2!.transactionDigest = next.digest
    ledgers.delete(previous); ledgers.set(next.digest, ledger)
  }
  async function consumption(indices = files.map(file => file.index)) {
    const proof = await proveRegister()
    base.walrus.reset(); cache.readSync(['getSystemPackageId'], () => base.certifyPackage)
    const tx = new Transaction(), certificates = indices.map(index => {
      const Message = bcs.struct('Message', { intent: bcs.struct('Intent', { type: bcs.u8(), version: bcs.u8(), appId: bcs.u8() }), epoch: bcs.u32(),
        messageContents: bcs.struct('Body', { blobId: bcs.u256(), blobType: bcs.enum('Type', { Permanent: null, Deletable: bcs.struct('Deletable', { objectId: bcs.Address }) }) }) })
      const certificate = encodeWalrusBatchCertificate({ signers: [0, 8], serializedMessage: Message.serialize({ intent: { type: 1, version: 0, appId: 3 },
        epoch: 10, messageContents: { blobId: blobIdToInt(files[index].encoding.blobId), blobType: { Deletable: { objectId: blobIds[index] } } } }).toBytes(), signature: new Uint8Array(96).fill(2) })
      tx.add(base.walrus.certifyBlob({ blobId: files[index].encoding.blobId, blobObjectId: blobIds[index], certificate, deletable: true }))
      return { index, certificate }
    })
    await tx.prepareForSerialization({})
    tx.moveCall({ target: `${uid(400)}::fixture::mint`, arguments: indices.map(index => tx.object(blobIds[index])) })
    const consume = await packet(tx), outputs = indices.map(index => base.object(blobIds[index], 12, `${base.origin}::blob::Blob`,
      Blob.serialize({ ...blobValues[index], certified_epoch: 10 }).toBytes(), { ObjectOwner: uid(500 + index) }, consume.digest))
    const oldSystem = base.object(base.systemId, 11, `${base.origin}::system::System`, System.serialize({ id: base.systemId, version: '2',
      package_id: base.certifyPackage, new_package_id: null }).toBytes(), shared, base.oldSystem.previousTransaction)
    const effects = base.effects(consume.digest, 12, outputs.map((row, i) => base.change(row, false, registeredRows[indices[i]], owned)),
      [[base.systemId, { ReadOnlyRoot: ['11', oldSystem.digest] }]])
    const events = indices.map(index => event('BlobCertified', Certified.serialize({ epoch: 10, blob_id: blobValues[index].blob_id,
      end_epoch: 12, deletable: true, object_id: blobIds[index], is_extension: false }).toBytes(), base.certifyPackage))
    ledgers.set(consume.digest, { packet: consume, effects, events, checkpoint: 2n })
    const params = { preparation, registration: proof, packet: consume, indices, certificates, signal: controller.signal }
    return { params, packet: consume, effects, events, outputs, prove: () => verifier.verifyConsumption(params) }
  }
  return { base, transport, preparation, register, registerEffects, registerEvents, blobValues, registeredRows, rows, ledgers,
    parent, controller, verifier, proveRegister, consumption, Registered, Certified, packet, registrationTx, rewriteRegister }
}
