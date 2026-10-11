import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { bls12_381 } from '../../../web/node_modules/@noble/curves/bls12-381.js'
import { blobIdToInt } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { singleUploadFixture, uid } from './walrus-single-upload'
import { createWalrusBatchAdapter, type WalrusBatchVerifiers } from '../../../web/lib/upload/walrus-batch-adapter'
import { prepareWalrusBatch, walrusBatchPreparationHash, type WalrusBatchLifetime, type WalrusBatchPreparation,
  type WalrusBatchProtector, type WalrusBatchScope } from '../../../web/lib/upload/walrus-batch-preparation'
import { createWalrusBatchRecord, parseWalrusBatchRecord, walrusBatchRecordHash, walrusBatchStoreKey,
  type WalrusBatchConsumptionProof, type WalrusBatchParentPacket, type WalrusBatchRecord,
  type WalrusBatchRegistrationProof, type WalrusBatchStore } from '../../../web/lib/upload/walrus-batch-store'

// Real AES-GCM, installed Walrus SDK encoding/registration/certification graph,
// WASM RS2 and node BLS signatures. Network transport AND parent historical
// verifiers are controlled: this is adapter contract coverage, not chain proof.
const Confirmation = bcs.struct('StorageConfirmation', {
  intent: bcs.struct('Intent', { type: bcs.u8(), version: bcs.u8(), appId: bcs.u8() }), epoch: bcs.u32(),
  messageContents: bcs.struct('Body', { blobId: bcs.u256(), blobType: bcs.enum('BlobType', {
    Permanent: null, Deletable: bcs.struct('Deletable', { objectId: bcs.Address }),
  }) }),
})
export function memoryBatchStore() {
  let record: WalrusBatchRecord | null = null, busy = false
  const archives = new Map<string, WalrusBatchRecord>(), checkpoints: WalrusBatchRecord[] = []
  const store: WalrusBatchStore = {
    exclusive: async (_key, work) => { if (busy) throw Error('busy'); busy = true; try { return await work() } finally { busy = false } },
    read: vi.fn(async () => record && parseWalrusBatchRecord(record)),
    create: vi.fn(async (key, value) => {
      if (key !== walrusBatchStoreKey(value.preparation.manifest.scope)) throw Error('key')
      if (record && walrusBatchRecordHash(record) !== walrusBatchRecordHash(value)) throw Error('unresolved')
      record = parseWalrusBatchRecord(value)
    }),
    compareAndSwap: vi.fn(async (_key, expected, next) => {
      if (!record || walrusBatchRecordHash(record) !== expected) throw Error('CAS mismatch')
      record = parseWalrusBatchRecord(next); checkpoints.push(structuredClone(record))
    }),
    archive: vi.fn(async (key, expected) => {
      if (!record || walrusBatchRecordHash(record) !== expected) throw Error('CAS mismatch')
      const archiveKey = `${key}:receipt:${expected}`; archives.set(archiveKey, record); record = null; return archiveKey
    }),
    readArchive: async key => archives.get(key) ?? null,
  }
  return { store, checkpoints, get: () => record && structuredClone(record), corrupt: (value: WalrusBatchRecord) => { record = value } }
}
export async function batchDurableFixture(options: { files?: number; privateFiles?: boolean; autoPrepare?: boolean } = {}) {
  const base = await singleUploadFixture()
  vi.mocked(base.walrus.encodeBlob).mockRestore(); vi.mocked(base.walrus.computeBlobMetadata).mockRestore()
  vi.mocked(base.walrus.certificateFromConfirmations).mockRestore(); vi.mocked(base.walrus.writeEncodedBlobToNodes).mockRestore()
  const cache = base.client.cache.scope('@mysten/walrus'), walrus = base.walrus
  let epoch = 9, nShards = 4, owner: string | null = base.intent.owner, generation = true, failConfirmations = false
  let invalidSigner = false, missingNode = -1, holdIndex = -1, releaseWrite: (() => void) | null = null
  const controller = new AbortController(), lifecycle: WalrusBatchLifetime = {
    signal: controller.signal, getAddress: () => owner, isCurrent: () => generation,
  }
  const bls = bls12_381.longSignatures
  const keys = Array.from({ length: 4 }, (_, index) => new Uint8Array(32).fill(index + 1))
  const publicKeys = keys.map(key => bls.getPublicKey(key).toBytes())
  const committee = () => ({ epoch, n_shards: nShards, members: keys.map((_, index) => ({ weight: nShards === 4 ? 1 : index === 0 ? nShards - 3 : 1,
    public_key: { bytes: [...publicKeys[index]] }, node_id: uid(100 + index) })) })
  vi.mocked(walrus.systemState).mockImplementation(async () => ({ committee: committee(), storage_price_per_unit_size: '1', write_price_per_unit_size: '1' }) as any)
  const reset = walrus.reset.bind(walrus)
  const seed = () => {
    cache.readSync(['getSystemPackageId'], () => uid(3)); cache.readSync(['getBlobType'], () => `${uid(3)}::blob::Blob`)
    cache.readSync(['walType'], () => `${uid(4)}::wal::WAL`)
    const nodes = keys.map((_, index) => ({ nodeIndex: index, id: uid(100 + index), info: { public_key: { bytes: [...publicKeys[index]] } },
      shardIndices: Array.from({ length: nShards }, (_, value) => value).filter(value => value % 4 === index), networkUrl: `https://node-${index}.invalid` }))
    cache.readSync(['getActiveCommittee'], () => ({ nodes, byShardIndex: new Map(nodes.flatMap(node => node.shardIndices.map(index => [index, node]))) }))
  }
  vi.spyOn(walrus, 'reset').mockImplementation(() => { reset(); seed() }); seed()
  const confirmation = (blobId: string, objectId: string, node: number) => {
    const message = Confirmation.serialize({ intent: { type: 1, version: 0, appId: 3 }, epoch,
      messageContents: { blobId: blobIdToInt(blobId), blobType: { Deletable: { objectId } } } }).toBytes()
    const signature = bls.sign(bls.hash(message), keys[node]).toBytes()
    if (invalidSigner) signature[10] ^= 1
    return { serializedMessage: toBase64(message), signature: toBase64(signature) }
  }
  const confirmations = vi.spyOn(walrus, 'getStorageConfirmations').mockImplementation(async ({ blobId, objectId }: any) => {
    if (failConfirmations) throw Error('controlled missing confirmations')
    return keys.map((_, node) => node === missingNode ? null : confirmation(blobId, objectId, node))
  })
  const written: string[] = []
  const nodeWrite = vi.spyOn(walrus, 'writeEncodedBlobToNode').mockImplementation(async ({ blobId, objectId, nodeIndex, signal }: any) => {
    if (holdIndex === nodeIndex) await new Promise<void>((resolve, reject) => {
      releaseWrite = resolve; signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    signal?.throwIfAborted(); written.push(objectId); return confirmation(blobId, objectId, nodeIndex)
  })
  const encode = vi.spyOn(walrus, 'encodeBlob'), write = vi.spyOn(walrus, 'writeEncodedBlobToNodes')
  const scope: WalrusBatchScope = { network: 'mainnet', owner: base.intent.owner, releaseHash: 'a'.repeat(64), operationId: 'fixture-batch', intentHash: 'b'.repeat(64) }
  const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  let callbackInput: Uint8Array | null = null, rawMaterial: any
  const unprotect = async (encrypted: string, contextHash: string) => {
    const raw = fromBase64(encrypted)
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(contextHash) }, cryptoKey, raw.slice(12)))
  }
  const protector: WalrusBatchProtector = {
    protect: vi.fn(async ({ contextHash, plaintext }) => {
      callbackInput = plaintext; rawMaterial = JSON.parse(new TextDecoder().decode(plaintext))
      const iv = crypto.getRandomValues(new Uint8Array(12)), cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: new TextEncoder().encode(contextHash) }, cryptoKey, plaintext as Uint8Array<ArrayBuffer>))
      const output = new Uint8Array(iv.length + cipher.length); output.set(iv); output.set(cipher, iv.length); return output
    }),
    verify: vi.fn(async ({ protection }) => {
      const raw = await unprotect(protection.encrypted, protection.contextHash)
      try { if (JSON.parse(new TextDecoder().decode(raw)).manifestHash !== protection.contextHash) throw Error('wrong protected hash') }
      finally { raw.fill(0) }
    }),
  }
  const files = Array.from({ length: options.files ?? 3 }, (_, index) => {
    const encrypted = options.privateFiles !== false && index > 0
    return { file: new File([encrypted ? new TextEncoder().encode(`Private soul document ${index} with enough bytes for validation.`)
      : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], encrypted ? `private-${index}.md` : `cover-${index}.png`,
    { type: encrypted ? 'text/markdown' : 'image/png' }), uploadType: encrypted ? 'encrypted' as const : 'public' as const, kind: 'soul-content' as const }
  })
  const prepare = () => prepareWalrusBatch({ scope, files, storageEpochs: 3, client: walrus, lifetime: lifecycle, protector })
  const memory = memoryBatchStore(), registrations = new Map<string, WalrusBatchRegistrationProof>(), consumptions = new Map<string, WalrusBatchConsumptionProof>()
  const verifiers: WalrusBatchVerifiers = {
    verifyPreparation: vi.fn(async ({ preparation }) => { if (preparation.privateRecovery) await protector.verify({ manifest: preparation.manifest, protection: preparation.privateRecovery, signal: lifecycle.signal }) }),
    verifyRegistration: vi.fn(async ({ packet }) => { const proof = registrations.get(packet.digest); if (!proof || proof.packet.bytes !== packet.bytes) throw Error('unproved parent registration'); return structuredClone(proof) }),
    verifyConsumption: vi.fn(async ({ packet }) => { const proof = consumptions.get(packet.digest); if (!proof || proof.packet.bytes !== packet.bytes) throw Error('unproved parent consumption'); return structuredClone(proof) }),
    beforeBlobWrite: vi.fn(async () => {}),
  }
  const reference = toBase58(new Uint8Array(32).fill(7))
  base.client.core.resolveTransactionPlugin = () => async (data: any, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => {
      if (!input.UnresolvedObject) return input
      const objectId = input.UnresolvedObject.objectId
      const blob = [...registrations.values()].flatMap(proof => proof.blobs).find(blob => blob.objectId === objectId)
      return blob ? Inputs.ObjectRef({ objectId, version: blob.version, digest: blob.digest })
        : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: !data.commands.some((command: any) => command.MoveCall?.function === 'certify_blob') })
    })
    data.gasData = { owner: scope.owner, budget: '50000000', price: '1000', payment: [{ objectId: uid(90), version: '1', digest: reference }] }; await next()
  }
  async function packet(tx: Transaction): Promise<WalrusBatchParentPacket> {
    tx.setSender(scope.owner); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build({ client: base.client as any })
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
  }
  let preparation: WalrusBatchPreparation | undefined
  const adapterFor = (p: WalrusBatchPreparation) => createWalrusBatchAdapter({ preparation: p, client: walrus, store: memory.store, lifetime: lifecycle, verifiers })
  if (options.autoPrepare !== false) { preparation = await prepare(); await memory.store.create(walrusBatchStoreKey(scope), createWalrusBatchRecord(preparation)) }
  const adapter = preparation ? adapterFor(preparation) : null
  const register = async () => {
    const tx = new Transaction(); await adapter!.appendRegisterCalls(tx)
    const parent = await packet(tx), proof: WalrusBatchRegistrationProof = { preparationHash: walrusBatchPreparationHash(preparation!), packet: parent,
      blobs: preparation!.manifest.files.map(file => ({ index: file.index, objectId: uid(1000 + file.index), version: '2', digest: reference,
        blobId: file.encoding.blobId, rootHash: file.encoding.rootHash, size: String(file.payloadByteLength), recipient: file.recipient, encodingType: 1,
        registeredEpoch: 9, storageStartEpoch: 9, storageEndEpoch: 12 })) }
    registrations.set(parent.digest, proof); await adapter!.acceptRegistration(parent); return { tx, packet: parent, proof }
  }
  const consume = async (indices: number[]) => {
    const tx = new Transaction(); await adapter!.appendCertifyCalls(tx, indices)
    const parent = await packet(tx), registered = memory.get()!.registration!
    const proof: WalrusBatchConsumptionProof = { preparationHash: walrusBatchPreparationHash(preparation!), registerDigest: registered.packet.digest,
      packet: parent, indices, blobObjectIds: indices.map(index => registered.blobs[index].objectId) }
    consumptions.set(parent.digest, proof); await adapter!.acceptConsumption(parent, indices); return { tx, packet: parent, proof }
  }
  return { base, walrus, scope, files, lifecycle, controller, protector, prepare, preparation: preparation!, adapter: adapter!, adapterFor,
    memory, verifiers, registrations, consumptions, register, consume, packet, encode, write, nodeWrite, confirmations, written,
    getRawMaterial: () => rawMaterial, getCallbackInput: () => callbackInput,
    unlock: ({ protection }: { protection: { encrypted: string; contextHash: string } }) => unprotect(protection.encrypted, protection.contextHash),
    setOwner: (value: string | null) => { owner = value }, stale: () => { generation = false },
    setEpoch: (value: number) => { epoch = value }, setShards: (value: number) => { nShards = value },
    setConfirmationsMissing: (value: boolean) => { failConfirmations = value }, invalidSignatures: () => { invalidSigner = true },
    omitNode: (value: number) => { missingNode = value }, holdNode: (value: number) => { holdIndex = value },
    releaseNode: () => releaseWrite?.(),
  }
}
