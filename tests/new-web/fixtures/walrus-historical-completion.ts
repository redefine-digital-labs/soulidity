import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { ClientCache } from '@mysten/sui/client'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { WalrusClient, MAINNET_WALRUS_PACKAGE_CONFIG, blobIdToInt } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { System } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/system.mjs'
import { SystemStateInnerV1 } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/system_state_inner.mjs'
import { Blob } from '../../../web/node_modules/@mysten/walrus/dist/contracts/walrus/blob.mjs'
import { CertificateBcs } from '../../../web/node_modules/@mysten/walrus/dist/utils/bcs.mjs'
import { sha256Hex } from '../../../web/lib/upload/client-seal'
import { queryHistoricalWalrusBlobRecord } from '../../../web/lib/upload/walrus-single-upload'
import { type WalrusSingleAttachment, type WalrusSingleIntent, type WalrusSingleRecord } from '../../../web/lib/upload/walrus-single-operation'
import { uid, singleSigner } from './walrus-single-upload'

// Real pinned SDK register/certify graph, real local WASM metadata, complete
// canonical Object/TransactionData/effects BCS. RPC finality and BLS certificate
// are controlled boundaries: these are not chain execution or quorum proofs.
export async function historicalWalrusFixture(attachment: WalrusSingleAttachment | null = null, source: {
  signer?: typeof singleSigner; payload?: Uint8Array; intent?: WalrusSingleIntent; blobObjectId?: string
} = {}) {
  const owner = (source.signer ?? singleSigner).toSuiAddress(), systemId = MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId
  const origin = uid(3), registerPackage = uid(4), certifyPackage = uid(5), blobObjectId = source.blobObjectId ?? uid(101)
  const payload = new Uint8Array(source.payload ?? new TextEncoder().encode('Historical encrypted source')), nonce = new Uint8Array(32).fill(7)
  const priorDigest = toBase58(new Uint8Array(32).fill(4)), gasDigest = toBase58(new Uint8Array(32).fill(5))
  const rows = new Map<string, any>(), records = new Map<string, { bytes: Uint8Array; effects: ReturnType<typeof bcs.TransactionEffects.parse>; checkpoint?: bigint }>()
  const cache = new ClientCache()
  cache.scope('@mysten/walrus').readSync(['getSystemPackageId'], () => registerPackage)
  cache.scope('@mysten/walrus').readSync(['walType'], () => `${uid(6)}::wal::WAL`)
  const forbidden = () => { throw Error('Historical query attempted live/write path') }
  const client = { cache, core: {
    getChainIdentifier: vi.fn(async () => ({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' })),
    getObject: vi.fn(forbidden), executeTransaction: vi.fn(forbidden), getBalance: vi.fn(forbidden),
    resolveTransactionPlugin: () => async (data: any, _opts: unknown, next: () => Promise<void>) => {
      data.inputs = data.inputs.map((input: any) => {
        if (!input.UnresolvedObject) return input
        const id = input.UnresolvedObject.objectId
        if (id === systemId) return Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: '1', mutable: !data.commands.some((c: any) => c.MoveCall?.function === 'certify_blob') })
        const shared = attachment?.historicalSharedObjects?.find(row => row.objectId === id)
        if (shared) return Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: '1', mutable: shared.mutable })
        return Inputs.ObjectRef({ objectId: id, version: id === blobObjectId ? '10' : '9', digest: id === blobObjectId ? rows.get(`${id}:10`).digest : priorDigest })
      })
      await next()
    },
  }, ledgerService: {
    getObject: vi.fn(async ({ objectId, version }: { objectId: string; version: bigint }) => {
      if (version === undefined) forbidden()
      const row = rows.get(`${objectId}:${version}`)
      if (!row) throw Error(`Missing historical object ${objectId}:${version}`)
      return { response: { object: structuredClone(row) } }
    }),
    getTransaction: vi.fn(async ({ digest }: { digest: string }) => {
      const record = records.get(digest); if (!record) throw { code: 'NOT_FOUND' }
      return { response: { transaction: { digest, transaction: { digest, bcs: { value: record.bytes } },
        effects: { status: { success: record.effects.V2!.status.$kind === 'Success' }, bcs: { value: bcs.TransactionEffects.serialize(record.effects).toBytes() } }, checkpoint: record.checkpoint } } }
    }), getEpoch: vi.fn(forbidden),
  } }
  const walrus = new WalrusClient({ network: 'mainnet', suiClient: client as any })
  const systemState = { committee: { epoch: 9, n_shards: 10, members: Array.from({ length: 9 }, (_, i) => ({
    public_key: { bytes: [1, 2] }, weight: 1, node_id: uid(200 + i) })), total_aggregated_key: { bytes: [3, 4] } },
    total_capacity_size: '1000000', used_capacity_size: '1000', storage_price_per_unit_size: '1', write_price_per_unit_size: '1',
    future_accounting: { current_index: 0, length: 0, ring_buffer: [] },
    event_blob_certification_state: { latest_certified_blob: null, aggregate_weight_per_blob: { contents: [] } }, deny_list_sizes: { id: uid(222) } }
  const stateSpy = vi.spyOn(walrus, 'systemState').mockResolvedValue(systemState)
  const systemSpy = vi.spyOn(walrus, 'systemObject').mockResolvedValue({ id: systemId, version: '1', package_id: registerPackage, new_package_id: null })
  vi.spyOn(walrus, 'storageCost').mockResolvedValue({ storageCost: 3n, writeCost: 2n, totalCost: 5n })
  const metadata = await walrus.computeBlobMetadata({ bytes: payload, numShards: 10, nonce })
  async function packet(tx: Transaction) {
    tx.setSender(owner); tx.setGasOwner(owner); tx.setGasBudget(50000000); tx.setGasPrice(1000)
    tx.setGasPayment([{ objectId: uid(90), version: '1', digest: gasDigest }]); tx.setExpiration({ Epoch: 12 })
    const bytes = await tx.build({ client: client as any }), digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    return { bytes: toBase64(bytes), digest, expirationEpoch: '12', phase: 'SUCCEEDED' as const, signature: null }
  }
  const register = await packet(walrus.registerBlobTransaction({ size: payload.length, epochs: source.intent?.storageEpochs ?? 3, owner,
    blobId: metadata.blobId, rootHash: metadata.rootHash, deletable: true, walCoin: uid(88) }))
  function object(objectId: string, version: number, type: string, bytes: Uint8Array, owner: any, digest: string) {
    type = normalizeStructTag(type)
    const full = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! },
      hasPublicTransfer: true, version: String(version), contents: bytes } }, owner, previousTransaction: digest, storageRebate: '0' }).toBytes()
    const hash = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...full]), { dkLen: 32 }))
    const rawOwner = owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner }
      : { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) }
    const row = { objectId, version: BigInt(version), objectType: type, contents: { value: bytes }, bcs: { value: full },
      digest: hash, owner: rawOwner, previousTransaction: digest }
    rows.set(`${objectId}:${version}`, row)
    return row
  }
  const sharedOwner = { Shared: { initialSharedVersion: '1' } }, addressOwner = { AddressOwner: owner }
  const system = object(systemId, 10, `${origin}::system::System`, System.serialize({ id: systemId, version: '1',
    package_id: registerPackage, new_package_id: null }).toBytes(), sharedOwner, register.digest)
  const fieldId = deriveDynamicFieldID(systemId, 'u64', bcs.u64().serialize(1).toBytes())
  const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: SystemStateInnerV1 })
  const field = object(fieldId, 10, `0x2::dynamic_field::Field<u64,${origin}::system_state_inner::SystemStateInnerV1>`,
    Field.serialize({ id: fieldId, name: '1', value: systemState }).toBytes(), { ObjectOwner: systemId }, register.digest)
  const blob = { id: blobObjectId, registered_epoch: 9, blob_id: String(blobIdToInt(metadata.blobId)), size: String(payload.length), encoding_type: 1,
    certified_epoch: null as number | null, storage: { id: uid(102), start_epoch: 9, end_epoch: 9 + (source.intent?.storageEpochs ?? 3), storage_size: '1000' }, deletable: true }
  const registeredBlob = object(blobObjectId, 10, `${origin}::blob::Blob`, Blob.serialize(blob).toBytes(), addressOwner, register.digest)
  function change(row: any, created: boolean, before?: any, inputOwner?: any) {
    const outputOwner = row.owner.kind === 1 ? { AddressOwner: row.owner.address } : row.owner.kind === 2 ? { ObjectOwner: row.owner.address }
      : { Shared: { initialSharedVersion: String(row.owner.version) } }
    return [row.objectId, { inputState: created ? { NotExist: true } : { Exist: [[String(before?.version ?? 9), before?.digest ?? priorDigest], inputOwner ?? outputOwner] },
      outputState: { ObjectWrite: [row.digest, outputOwner] }, idOperation: created ? { Created: true } : { None: true } }] as const
  }
  function effects(digest: string, version: number, changedObjects: any[], readonly: any[] = []) {
    return bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '9',
      transactionDigest: digest, gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' },
      lamportVersion: String(version), gasObjectIndex: null, eventsDigest: null, dependencies: [], changedObjects,
      unchangedConsensusObjects: readonly, auxDataDigest: null } }).toBytes())
  }
  const registrationEffects = effects(register.digest, 10, [change(system, false), change(field, false), change(registeredBlob, true)])
  records.set(register.digest, { bytes: Uint8Array.from(Buffer.from(register.bytes, 'base64')), effects: registrationEffects, checkpoint: 1n })
  // Model a package upgrade between register and certify, then another upgrade
  // after completion. The query must use this readonly System, not today's SDK.
  walrus.reset()
  cache.scope('@mysten/walrus').readSync(['getSystemPackageId'], () => certifyPackage)
  const oldSystem = object(systemId, 11, `${origin}::system::System`, System.serialize({ id: systemId, version: '2',
    package_id: certifyPackage, new_package_id: null }).toBytes(), sharedOwner, priorDigest)
  const certificate = CertificateBcs.serialize({ signers: [0, 8], serializedMessage: new Uint8Array([1, 2, 3]), signature: new Uint8Array(48).fill(2) }).toBase64()
  const certifyTx = walrus.certifyBlobTransaction({ blobId: metadata.blobId, blobObjectId, certificate, deletable: true })
  await certifyTx.prepareForSerialization({}); attachment?.append(certifyTx, blobObjectId)
  const certify = await packet(certifyTx)
  const certifiedBlob = object(blobObjectId, 12, `${origin}::blob::Blob`, Blob.serialize({ ...blob, certified_epoch: 10 }).toBytes(),
    attachment ? { ObjectOwner: uid(250) } : addressOwner, certify.digest)
  const certificationEffects = effects(certify.digest, 12, [change(certifiedBlob, false, registeredBlob, addressOwner)],
    [[systemId, { ReadOnlyRoot: ['11', oldSystem.digest] }]])
  for (const shared of attachment?.historicalSharedObjects ?? []) {
    const row = object(shared.objectId, shared.mutable ? 12 : 9, `${origin}::fixture::Shared`,
      bcs.struct('Shared', { id: bcs.Address }).serialize({ id: shared.objectId }).toBytes(), sharedOwner, shared.mutable ? certify.digest : priorDigest)
    if (shared.mutable) certificationEffects.V2!.changedObjects.push(bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
      ...certificationEffects.V2!, changedObjects: [change(row, false)] as any,
    } }).toBytes()).V2!.changedObjects[0])
    else certificationEffects.V2!.unchangedConsensusObjects.push([shared.objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['9', row.digest] }])
  }
  records.set(certify.digest, { bytes: Uint8Array.from(Buffer.from(certify.bytes, 'base64')), effects: certificationEffects, checkpoint: 2n })
  const record: WalrusSingleRecord = { schema: 'soulidity.walrus-single.v1', intent: source.intent ?? { network: 'mainnet', owner, recipient: owner,
    operationScope: attachment?.scope ?? 'historical:test', attachmentScope: attachment?.scope ?? null,
    contentHash: await sha256Hex(payload), payloadHash: await sha256Hex(payload), payloadByteLength: payload.length,
    storageEpochs: 3, relayUrl: 'https://original-relay.example.com' },
    encoding: { blobId: metadata.blobId, rootHash: toBase64(metadata.rootHash), unencodedSize: payload.length, nonce: toBase64(nonce) },
    uploaded: { blobId: metadata.blobId, blobObjectId, certificate }, approved: { relayTip: '1', storageCost: '3', writeCost: '2', gasBudget: '100000000', quoteId: 'quote' },
    register, certify, acknowledged: true }
  stateSpy.mockImplementation(forbidden); systemSpy.mockImplementation(forbidden)
  const readBlob = vi.spyOn(walrus, 'readBlob').mockImplementation(forbidden), write = vi.spyOn(walrus, 'writeBlobFlow').mockImplementation(forbidden)
  const execution = { client: client as any, getAddress: vi.fn(forbidden), sign: vi.fn(async () => forbidden()), beforeWrite: vi.fn(async () => forbidden()) }
  const controller = new AbortController(), createClient = vi.fn(async () => walrus)
  const params = { record, payload, operationScope: record.intent.operationScope, attachment, execution, createClient, signal: controller.signal }
  return { params, record, rows, records, walrus, client, execution, createClient, controller, metadata,
    systemId, fieldId, blobObjectId, origin, registerPackage, certifyPackage, registeredBlob, certifiedBlob, system, oldSystem, field,
    stateSpy, systemSpy, readBlob, write, object, change, effects, query: () => queryHistoricalWalrusBlobRecord(params) }
}
