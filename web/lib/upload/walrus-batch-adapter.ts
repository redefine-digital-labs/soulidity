import type { WalrusClient } from '@mysten/walrus'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { encodeWalrusBatchCertificate, inspectWalrusBatchCertificate } from './walrus-batch-certificate'
import { assertWalrusBatchLifetime, parseWalrusBatchPreparation, walrusBatchCanonicalJson, walrusBatchCheck as check, walrusBatchHash,
  walrusBatchPreparationHash, walrusBatchStep, type WalrusBatchLifetime, type WalrusBatchPreparation } from './walrus-batch-preparation'
import { parseWalrusBatchConsumption, parseWalrusBatchParentPacket, parseWalrusBatchRecord, parseWalrusBatchRegistration,
  validateWalrusBatchIndices, walrusBatchRecordHash, walrusBatchStoreKey,
  type WalrusBatchConsumptionProof, type WalrusBatchParentPacket, type WalrusBatchRecord,
  type WalrusBatchRegistrationProof, type WalrusBatchStore } from './walrus-batch-store'

export type WalrusBatchClient = Pick<WalrusClient, 'reset' | 'systemState' | 'encodeBlob' | 'registerBlob'
  | 'certifyBlob' | 'getStorageConfirmations' | 'writeEncodedBlobToNodes' | 'certificateFromConfirmations'>
export interface WalrusBatchVerifiers {
  /** Validate parent intent/release/full chain identity and actual protected
   * recovery. Parsing a local manifest does not grant mint/register authority. */
  verifyPreparation(input: { preparation: WalrusBatchPreparation; signal: AbortSignal }): Promise<void>
  /** Must prove the whole original parent PTB, canonical finalized effects and
   * historical Blob/System outputs. A JSON objectChanges/current Blob lookup
   * or a caller-supplied `succeeded: true` is not an implementation. */
  verifyRegistration(input: { preparation: WalrusBatchPreparation; packet: WalrusBatchParentPacket; signal: AbortSignal }): Promise<WalrusBatchRegistrationProof>
  /** Must prove this exact parent certify/mint PTB and historical input/output
   * lineage. Never require a consumed Blob to remain currently address-owned. */
  verifyConsumption(input: { preparation: WalrusBatchPreparation; registration: WalrusBatchRegistrationProof;
    packet: WalrusBatchParentPacket; indices: number[]; certificates: Array<{ index: number; certificate: string }>;
    signal: AbortSignal }): Promise<WalrusBatchConsumptionProof>
  /** Live owned references/storage availability and parent pending-packet
   * exclusion. Called only for unconsumed blobs, before direct-node writes and
   * fresh certify construction; historical success uses no current-owned read. */
  beforeBlobWrite(input: { preparation: WalrusBatchPreparation; registration: WalrusBatchRegistrationProof;
    indices: number[]; signal: AbortSignal }): Promise<void>
}
/** No signer, broadcaster, cost approval or standalone register executor exists
 * here. The parent WAL owns all exact packets, pending-index exclusion and
 * proved retirement before fallback. Calls below only build or resume the
 * original N-blob uploader and keep per-file checkpoints. */
export function createWalrusBatchAdapter(params: {
  preparation: WalrusBatchPreparation; client: WalrusBatchClient; store: WalrusBatchStore
  lifetime: WalrusBatchLifetime; verifiers: WalrusBatchVerifiers
}) {
  const preparation = parseWalrusBatchPreparation(params.preparation), scope = preparation.manifest.scope
  const preparationHash = walrusBatchPreparationHash(preparation), key = walrusBatchStoreKey(scope)
  const client = params.client, store = params.store, life = { ...params.lifetime }, verify = { ...params.verifiers }
  check(['verifyPreparation', 'verifyRegistration', 'verifyConsumption', 'beforeBlobWrite']
    .every(name => typeof verify[name as keyof WalrusBatchVerifiers] === 'function'), 'PRODUCTION_VERIFIERS_REQUIRED')
  const guard = () => assertWalrusBatchLifetime(scope, life)
  const step = <T>(read: (signal: AbortSignal) => PromiseLike<T> | T) => walrusBatchStep(scope, life, read)
  const registeredTransactions = new WeakSet<Transaction>(), certifiedTransactions = new WeakMap<Transaction, Set<number>>()
  const equal = (left: unknown, right: unknown) => walrusBatchCanonicalJson(left) === walrusBatchCanonicalJson(right)
  async function currentRecord() {
    guard()
    const result = await step(() => store.read(key))
    check(result, 'DURABLE_PREPARATION_REQUIRED_BEFORE_PAYMENT')
    const record = parseWalrusBatchRecord(result)
    check(walrusBatchPreparationHash(record.preparation) === preparationHash, 'DURABLE_PREPARATION_CHANGED')
    await step(signal => verify.verifyPreparation({ preparation: structuredClone(preparation), signal }))
    return record
  }
  async function save(previous: WalrusBatchRecord, update: Omit<WalrusBatchRecord, 'revision'>) {
    guard()
    const next = parseWalrusBatchRecord({ ...update, revision: previous.revision + 1 })
    // An IndexedDB commit cannot be cancelled by a network timeout. Keep both
    // uploader and calling parent locks until it settles, then recheck lifetime.
    await store.compareAndSwap(key, walrusBatchRecordHash(previous), next)
    guard()
    return next
  }
  async function proveRegistration(packetInput: WalrusBatchParentPacket) {
    const packet = parseWalrusBatchParentPacket(packetInput, scope.owner)
    const proof = parseWalrusBatchRegistration(await step(signal => verify.verifyRegistration({
      preparation: structuredClone(preparation), packet: { ...packet }, signal,
    })), preparation)
    check(equal(proof.packet, packet), 'REGISTER_VERIFIER_PACKET_MISMATCH')
    return proof
  }
  async function proveConsumption(record: WalrusBatchRecord, packetInput: WalrusBatchParentPacket, indicesInput: readonly number[]) {
    check(record.registration, 'REGISTER_PROOF_REQUIRED')
    const packet = parseWalrusBatchParentPacket(packetInput, scope.owner), indices = validateWalrusBatchIndices(indicesInput, preparation.manifest.files.length)
    const certificateMap = new Map(record.certificates.map(value => [value.index, value]))
    check(indices.every(index => certificateMap.has(index)), 'CONSUMPTION_CERTIFICATE_REQUIRED')
    const proof = parseWalrusBatchConsumption(await step(signal => verify.verifyConsumption({
      preparation: structuredClone(preparation), registration: structuredClone(record.registration!), packet: { ...packet }, indices: [...indices],
      certificates: indices.map(index => ({ ...certificateMap.get(index)! })), signal,
    })), preparation, record.registration)
    check(equal(proof.packet, packet) && equal(proof.indices, indices), 'CONSUMPTION_VERIFIER_PACKET_MISMATCH')
    return proof
  }
  async function provenRecord() {
    const record = await currentRecord()
    check(record.registration, 'REGISTER_PROOF_REQUIRED')
    const registration = await proveRegistration(record.registration.packet)
    check(equal(registration, record.registration), 'PERSISTED_REGISTER_PROOF_MISMATCH')
    for (const receipt of record.consumptions) {
      const confirmed = await proveConsumption(record, receipt.packet, receipt.indices)
      check(equal(confirmed, receipt), 'PERSISTED_CONSUMPTION_PROOF_MISMATCH')
    }
    return record
  }
  async function beforeBlobWrite(record: WalrusBatchRecord, indices: readonly number[]) {
    check(record.registration, 'REGISTER_PROOF_REQUIRED')
    await step(signal => verify.beforeBlobWrite({ preparation: structuredClone(preparation), registration: structuredClone(record.registration!),
      indices: [...indices], signal }))
    guard()
  }
  async function systemFor(record: WalrusBatchRecord, index: number) {
    guard(); client.reset()
    const state = await step(() => client.systemState()), epoch = state.committee.epoch
    const blob = record.registration!.blobs[index]
    check(Number.isInteger(epoch) && epoch >= blob.registeredEpoch && epoch < blob.storageEndEpoch, 'PAID_STORAGE_EXPIRED_OR_WRONG_EPOCH')
    return state
  }
  async function freshCertificate(record: WalrusBatchRecord, index: number) {
    const file = preparation.manifest.files[index], blobObjectId = record.registration!.blobs[index].objectId
    let state = await systemFor(record, index)
    const confirmations = () => step(signal => client.getStorageConfirmations({ blobId: file.encoding.blobId, objectId: blobObjectId, deletable: true, signal }))
    const certificateFrom = async (rows: Awaited<ReturnType<WalrusClient['getStorageConfirmations']>>) => {
      const certificate = await step(() => client.certificateFromConfirmations({ confirmations: rows, blobId: file.encoding.blobId,
        blobObjectId, deletable: true }))
      const encoded = encodeWalrusBatchCertificate(certificate)
      inspectWalrusBatchCertificate(encoded, { blobId: file.encoding.blobId, blobObjectId, epoch: state.committee.epoch, committee: state.committee })
      // A cached systemState can survive an epoch transition during node I/O.
      const after = await systemFor(record, index)
      check(equal(after.committee, state.committee), 'COMMITTEE_CHANGED_RETRY_SAME_REGISTER')
      return encoded
    }
    // The cached serialized certificate is deliberately not trusted to build a
    // fresh packet. Reconstruct via SDK-verified node confirmations first.
    try { return await certificateFrom(await confirmations()) }
    catch (error) {
      guard()
      // Read/certificate failures can be retried, never an invitation to pay.
      // beforeBlobWrite enforces parent pending-packet exclusion before I/O.
      await beforeBlobWrite(record, [index])
      state = await systemFor(record, index)
      const payload = new Uint8Array(preparation.payloads[index])
      try {
        check(payload.length === file.payloadByteLength && walrusBatchHash(payload) === file.payloadHash, 'RECOVERY_PAYLOAD_CHANGED')
        const encoded = await step(() => client.encodeBlob(payload))
        check(encoded.blobId === file.encoding.blobId && toBase64(encoded.rootHash) === file.encoding.rootHash
          && Number(encoded.metadata.V1.unencoded_length) === file.payloadByteLength
          && state.committee.n_shards === file.encoding.nShards
          && (encoded.metadata.V1.encoding_type === 'RS2' || typeof encoded.metadata.V1.encoding_type === 'object'
            && 'RS2' in encoded.metadata.V1.encoding_type), 'PAID_ENCODING_CHANGED_QUERY_OR_EXPORT')
        const afterEncode = await systemFor(record, index)
        check(equal(state.committee, afterEncode.committee), 'COMMITTEE_CHANGED_RETRY_SAME_REGISTER')
        await beforeBlobWrite(record, [index])
        let rows: Awaited<ReturnType<WalrusClient['getStorageConfirmations']>>
        try {
          rows = await step(signal => client.writeEncodedBlobToNodes({ blobId: file.encoding.blobId, objectId: blobObjectId,
            deletable: true, metadata: encoded.metadata, sliversByNode: encoded.sliversByNode, signal }))
        } catch (writeError) {
          guard(); rows = await confirmations()
          void writeError
        }
        for (let attempt = 0; ; attempt++) {
          try { return await certificateFrom(rows) }
          catch (certificateError) {
            guard(); if (attempt >= 2) throw certificateError
            state = await systemFor(record, index); rows = await confirmations()
          }
        }
      } finally { payload.fill(0) }
    }
  }
  async function complete(record: WalrusBatchRecord, selected?: readonly number[]) {
    const indices = selected === undefined ? preparation.manifest.files.map(file => file.index)
      : validateWalrusBatchIndices(selected, preparation.manifest.files.length)
    const consumed = new Set(record.consumptions.flatMap(receipt => receipt.indices))
    let next = record
    for (const index of indices) {
      if (consumed.has(index)) continue // already re-proved historically, no current-owned read
      await beforeBlobWrite(next, [index])
      const certificate = await freshCertificate(next, index)
      guard()
      const certificates = next.certificates.filter(value => value.index !== index).concat({ index, certificate }).sort((a, b) => a.index - b.index)
      if (!equal(certificates, next.certificates)) next = await save(next, { ...next, certificates })
    }
    return next
  }
  const exclusive = <T>(work: () => Promise<T>) => {
    guard(); return store.exclusive(key, async () => { guard(); const result = await work(); guard(); return result })
  }
  return {
    key,
    /** This only appends the SDK graph; the parent persists full bytes before
     * signing. Rebuilding a pending/signed parent is NOT a recovery strategy. */
    appendRegisterCalls: (tx: Transaction) => exclusive(async () => {
      const record = await currentRecord()
      check(record.registration === null && !registeredTransactions.has(tx), 'REGISTER_ALREADY_PRESENT')
      registeredTransactions.add(tx)
      guard(); tx.setSenderIfNotSet(scope.owner)
      check(tx.getData().sender === scope.owner, 'TRANSACTION_SENDER_MISMATCH')
      const blobs = preparation.manifest.files.map(file => tx.add(client.registerBlob({ size: file.payloadByteLength,
        epochs: preparation.manifest.storageEpochs, blobId: file.encoding.blobId,
        rootHash: fromBase64(file.encoding.rootHash), deletable: true })))
      for (const file of preparation.manifest.files) tx.transferObjects([blobs[file.index]], file.recipient)
      // Resolve trusted Walrus async thunks now. Coin selection remains the
      // parent's normal SDK build step; no signature or execution occurs here.
      await step(() => tx.prepareForSerialization({ supportedIntents: ['CoinWithBalance'] }))
    }),
    acceptRegistration: (packetInput: WalrusBatchParentPacket) => {
      const packet = parseWalrusBatchParentPacket(packetInput, scope.owner)
      return exclusive(async () => {
        const record = await currentRecord(), proof = await proveRegistration(packet)
        if (record.registration) { check(equal(record.registration, proof), 'REGISTER_ROOT_CANNOT_CHANGE'); return record }
        return save(record, { ...record, registration: proof })
      })
    },
    completeUploads: () => exclusive(async () => complete(await provenRecord())),
    /** Fresh packet construction only. The parent queries/replays an existing
     * packet verbatim instead of asking for new certificates or re-signing. */
    appendCertifyCalls: (tx: Transaction, indicesInput?: readonly number[]) => {
      const indices = indicesInput === undefined ? preparation.manifest.files.map(file => file.index)
        : validateWalrusBatchIndices(indicesInput, preparation.manifest.files.length)
      return exclusive(async () => {
        let record = await provenRecord()
        const consumed = new Set(record.consumptions.flatMap(receipt => receipt.indices))
        const alreadyAdded = certifiedTransactions.get(tx) ?? new Set<number>()
        check(indices.every(index => !consumed.has(index) && !alreadyAdded.has(index)), 'CERTIFY_INDEX_ALREADY_CONSUMED_OR_ATTACHED')
        record = await complete(record, indices)
        await beforeBlobWrite(record, indices)
        guard(); tx.setSenderIfNotSet(scope.owner); check(tx.getData().sender === scope.owner, 'TRANSACTION_SENDER_MISMATCH')
        certifiedTransactions.set(tx, new Set([...alreadyAdded, ...indices]))
        for (const index of indices) {
          const file = preparation.manifest.files[index], blob = record.registration!.blobs[index]
          tx.add(client.certifyBlob({ blobId: file.encoding.blobId, blobObjectId: blob.objectId,
            certificate: record.certificates.find(value => value.index === index)!.certificate, deletable: true }))
        }
        await step(() => tx.prepareForSerialization({ supportedIntents: ['CoinWithBalance'] }))
        return record
      })
    },
    acceptConsumption: (packetInput: WalrusBatchParentPacket, indicesInput: readonly number[]) => {
      const packet = parseWalrusBatchParentPacket(packetInput, scope.owner), indices = validateWalrusBatchIndices(indicesInput, preparation.manifest.files.length)
      return exclusive(async () => {
        const record = await provenRecord(), proof = await proveConsumption(record, packet, indices)
        const previous = record.consumptions.find(value => value.packet.digest === packet.digest)
        if (previous) { check(equal(previous, proof), 'CONSUMPTION_PACKET_SCOPE_CHANGED'); return record }
        const consumed = new Set(record.consumptions.flatMap(receipt => receipt.indices))
        check(indices.every(index => !consumed.has(index)), 'CONSUMPTION_INDEX_ALREADY_USED')
        return save(record, { ...record, consumptions: [...record.consumptions, proof] })
      })
    },
    archiveCompleted: () => exclusive(async () => {
      const record = await provenRecord()
      check(new Set(record.consumptions.flatMap(receipt => receipt.indices)).size === preparation.manifest.files.length, 'ARCHIVE_COMPLETION_REQUIRED')
      guard(); const archived = await store.archive(key, walrusBatchRecordHash(record))
      guard(); return archived
    }),
  }
}
