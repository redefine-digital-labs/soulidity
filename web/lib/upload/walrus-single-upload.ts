'use client'

import type { WalrusClient } from '@mysten/walrus'
import { bcs } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { SuiGrpcJsonRpcCompatClient, assertSuiTxSucceeded, profileReadStep, type SuiTxResultWithEffects } from '@soulidity/sdk'
import { historicalObjectOutput, readHistoricalMoveObject } from '../sui/historical-object'
import { sha256Hex } from './client-seal'
import { archiveWalrusSingleRecord, assertWalrusSingleChain, captureWalrusSingleAttachment as capturedAttachment, executeWalrusSinglePacket, parseWalrusSingleRecord, queryWalrusSinglePacket,
  readWalrusSingleRecord, walrusSingleCheck as check, walrusSingleKey, withWalrusSingleLock, writeWalrusSingleRecord,
  type WalrusSingleAttachment, type WalrusSingleExecution, type WalrusSingleIntent, type WalrusSingleRecord } from './walrus-single-operation'

const BlobBcs = bcs.struct('Blob', { id: bcs.Address, registered_epoch: bcs.u32(), blob_id: bcs.u256(), size: bcs.u64(),
  encoding_type: bcs.u8(), certified_epoch: bcs.option(bcs.u32()), storage: bcs.struct('Storage', {
    id: bcs.Address, start_epoch: bcs.u32(), end_epoch: bcs.u32(), storage_size: bcs.u64(),
  }), deletable: bcs.bool() })
type Factory = (maxTip: bigint) => Promise<WalrusClient>
type Approved = NonNullable<WalrusSingleRecord['approved']>
export interface DurableWalrusBlobResult {
  blobId: string; blobObjectId: string; storageTxDigest: string; certifyTxDigest: string
  certifyTxResult: SuiTxResultWithEffects
  quoteId: string; recoveryKey: string
}
function attachmentFor(record: WalrusSingleRecord, attachment: WalrusSingleAttachment | null) {
  check(record.intent.attachmentScope === (attachment?.scope ?? null), 'WALRUS_ATTACHMENT_SCOPE_MISMATCH')
}
async function certification(client: WalrusClient, record: WalrusSingleRecord, attachment: WalrusSingleAttachment | null) {
  attachmentFor(record, attachment)
  check(record.uploaded, 'WALRUS_CERTIFICATE_REQUIRED')
  const tx = client.certifyBlobTransaction({ ...record.uploaded, deletable: true })
  // Walrus builds its call via an async thunk; wait for that trusted command
  // graph before capturing its object roles or appending caller commands.
  await tx.prepareForSerialization({})
  // SDK certification owns the Blob parameter; all its other object parameters
  // must remain independently resolved, never aliased by attachment metadata.
  const sdkObjectIds = new Set(tx.getData().inputs.flatMap(input => {
    const objectId = input.UnresolvedObject?.objectId ?? input.Object?.ImmOrOwnedObject?.objectId
      ?? input.Object?.SharedObject?.objectId ?? input.Object?.Receiving?.objectId
    return objectId ? [objectId] : []
  }))
  for (const id of attachment?.historicalOwnedObjectIds ?? [])
    check(/^0x[0-9a-f]{64}$/.test(id) && !sdkObjectIds.has(id) && id !== record.uploaded.blobObjectId, 'WALRUS_HISTORICAL_OWNED_ROLE_ALIAS')
  if (attachment) attachment.append(tx, record.uploaded.blobObjectId)
  tx.setSender(record.intent.owner)
  return tx
}
/** On a finalized replay versions have advanced. Compare the same complete SDK
 * commands/pure values/object IDs/shared mutability, not the newly fetched owned
 * versions. The original packet itself is never rewritten or re-signed. */
function logicalKind(tx: Transaction) {
  const data = tx.getData()
  return JSON.stringify({ commands: data.commands, inputs: data.inputs.map(input => {
    if (input.Object?.ImmOrOwnedObject) return { Object: { ImmOrOwnedObject: { objectId: input.Object.ImmOrOwnedObject.objectId } } }
    if (input.Object?.Receiving) return { Object: { Receiving: { objectId: input.Object.Receiving.objectId } } }
    return input
  }) })
}
async function assertCertifyTemplate(execution: WalrusSingleExecution, client: WalrusClient,
  record: WalrusSingleRecord, attachment: WalrusSingleAttachment | null) {
  check(record.certify, 'WALRUS_CERTIFY_PACKET_REQUIRED')
  const tx = await certification(client, record, attachment)
  const previous = Transaction.from(fromBase64(record.certify.bytes))
  const ownedIds = new Set([record.uploaded!.blobObjectId, ...(attachment?.historicalOwnedObjectIds ?? [])])
  const owned = new Map(previous.getData().inputs.flatMap(input => input.Object?.ImmOrOwnedObject
    ? [[input.Object.ImmOrOwnedObject.objectId, input.Object.ImmOrOwnedObject] as const] : []))
  tx.addSerializationPlugin(async (data, _options, next) => {
    for (const input of data.inputs) if (input.UnresolvedObject && ownedIds.has(input.UnresolvedObject.objectId)) {
      const reference = owned.get(input.UnresolvedObject.objectId)
      // Supply references ONLY for ABI-known owned IDs. Leave the input
      // unresolved so the SDK still infers Receiving/owned from Move types.
      // Never infer sharedness from the candidate packet itself.
      if (reference) Object.assign(input.UnresolvedObject, { version: reference.version, digest: reference.digest })
    }
    await next()
  })
  const bytes = await tx.build({ client: execution.client, onlyTransactionKind: true })
  check(logicalKind(Transaction.fromKind(bytes)) === logicalKind(previous),
    'WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
}
async function readBlob(execution: WalrusSingleExecution, client: WalrusClient, record: WalrusSingleRecord, objectId: string, certified: boolean) {
  const { object } = await execution.client.core.getObject({ objectId, include: { content: true }, signal: AbortSignal.timeout(25000) })
  check(object.type === await client.getBlobType() && object.content, 'WALRUS_BLOB_TYPE_MISMATCH')
  const blob = BlobBcs.parse(object.content)
  check(toBase64(BlobBcs.serialize(blob).toBytes()) === toBase64(object.content) && blob.id === objectId
    && blob.size === String(record.intent.payloadByteLength) && blob.encoding_type === 1 && blob.deletable,
  'WALRUS_BLOB_CONTENT_MISMATCH')
  const { blobIdFromInt } = await import('@mysten/walrus')
  check(record.encoding && blobIdFromInt(BigInt(blob.blob_id)) === record.encoding.blobId, 'WALRUS_BLOB_ID_MISMATCH')
  if (certified) {
    const current = await client.systemState()
    check(blob.certified_epoch !== null && current.committee.epoch < blob.storage.end_epoch, 'WALRUS_BLOB_NOT_CURRENTLY_CERTIFIED')
  }
  return blob
}
async function registeredObjectProof(execution: WalrusSingleExecution, client: WalrusClient, record: WalrusSingleRecord) {
  check(record.register, 'WALRUS_REGISTER_PACKET_REQUIRED')
  const result = await queryWalrusSinglePacket(execution, record.register)
  check(result.status === 'SUCCEEDED' && result.effects?.V2, 'WALRUS_REGISTER_NOT_FINAL')
  const created = result.effects.V2.changedObjects.filter(([, change]) => change.idOperation.$kind === 'Created'
    && change.outputState.$kind === 'ObjectWrite')
  const matches: { objectId: string; version: string; digest: string }[] = []
  for (const [id, change] of created) {
    const { object } = await execution.client.core.getObject({ objectId: id, include: { content: true }, signal: AbortSignal.timeout(25000) })
    if (object.type !== await client.getBlobType()) continue
    check(change.inputState.$kind === 'NotExist', 'WALRUS_REGISTER_CREATION_EVIDENCE_INVALID')
    check(change.outputState.ObjectWrite?.[1].AddressOwner === record.intent.recipient, 'WALRUS_REGISTER_RECIPIENT_MISMATCH')
    await readBlob(execution, client, record, id, false)
    matches.push({ objectId: id, version: result.effects.V2.lamportVersion, digest: change.outputState.ObjectWrite![0] })
  }
  check(matches.length === 1, 'WALRUS_REGISTER_BLOB_NOT_UNIQUE')
  return matches[0]
}
async function registeredObjectId(execution: WalrusSingleExecution, client: WalrusClient, record: WalrusSingleRecord) {
  return (await registeredObjectProof(execution, client, record)).objectId
}
function resultOf(key: string, record: WalrusSingleRecord, certifyTxResult: SuiTxResultWithEffects): DurableWalrusBlobResult {
  check(record.uploaded && record.register?.phase === 'SUCCEEDED' && record.certify?.phase === 'SUCCEEDED' && record.approved, 'WALRUS_UPLOAD_NOT_FINAL')
  return { blobId: record.uploaded.blobId, blobObjectId: record.uploaded.blobObjectId,
    storageTxDigest: record.register.digest, certifyTxDigest: record.certify.digest,
    certifyTxResult,
    quoteId: record.approved.quoteId, recoveryKey: key }
}
async function checkedFinal(execution: WalrusSingleExecution, client: WalrusClient, key: string,
  record: WalrusSingleRecord, attachment: WalrusSingleAttachment | null, persist = true) {
  check(record.certify && record.uploaded, 'WALRUS_CERTIFY_PACKET_REQUIRED')
  const cert = await queryWalrusSinglePacket(execution, record.certify)
  check(cert.status === 'SUCCEEDED', 'WALRUS_CERTIFY_NOT_FINAL')
  await assertCertifyTemplate(execution, client, record, attachment)
  check(await registeredObjectId(execution, client, record) === record.uploaded.blobObjectId, 'WALRUS_REGISTER_OBJECT_MISMATCH')
  await readBlob(execution, client, record, record.uploaded.blobObjectId, true)
  record.certify.phase = 'SUCCEEDED'
  if (persist) writeWalrusSingleRecord(key, record)
  const receipt = await new SuiGrpcJsonRpcCompatClient(record.intent.network, execution.client).getTransactionBlock({
    digest: record.certify.digest, options: { showEffects: true, showInput: true, showEvents: true, showObjectChanges: true },
  })
  check(receipt.digest === record.certify.digest, 'WALRUS_CERTIFY_RECEIPT_MISMATCH')
  return resultOf(key, record, assertSuiTxSucceeded(receipt, 'Walrus certified receipt'))
}

/** The lock covers the whole paid storage journey. Neither an unknown packet nor
 * a different attachment can be replaced by re-selecting a file or changing a form. */
export async function uploadDurableWalrusBlob(params: {
  intent: WalrusSingleIntent; payload: Uint8Array; execution: WalrusSingleExecution
  attachment: WalrusSingleAttachment | null; createClient: Factory
  approve: () => Promise<Approved>
}): Promise<DurableWalrusBlobResult> {
  const intent = structuredClone(params.intent), payload = new Uint8Array(params.payload)
  const execution = { ...params.execution }, attachment = capturedAttachment(params.attachment)
  const { createClient, approve } = params
  const key = walrusSingleKey(intent)
  check(await sha256Hex(payload) === intent.payloadHash && payload.length === intent.payloadByteLength, 'WALRUS_SOURCE_BYTES_MISMATCH')
  return withWalrusSingleLock(key, async () => {
    let record = readWalrusSingleRecord(key)
    if (record && JSON.stringify(record.intent) !== JSON.stringify(intent)) {
      check(record.acknowledged && record.certify, 'WALRUS_DIFFERENT_INTENT_QUERY_EXISTING_OPERATION')
      await assertWalrusSingleChain(execution, intent.network)
      check((await queryWalrusSinglePacket(execution, record.certify)).status === 'SUCCEEDED', 'WALRUS_ACKNOWLEDGED_RESULT_UNCONFIRMED')
      archiveWalrusSingleRecord(key, record)
      record = null
    }
    if (!record) record = { schema: 'soulidity.walrus-single.v1', intent, encoding: null, uploaded: null, approved: null,
      register: null, certify: null, acknowledged: false }
    attachmentFor(record, attachment)
    await assertWalrusSingleChain(execution, intent.network)
    if (!record.approved) { record.approved = await approve(); writeWalrusSingleRecord(key, record) }
    const client = await createClient(BigInt(record.approved.relayTip))
    if (record.certify) {
      const status = await queryWalrusSinglePacket(execution, record.certify)
      if (status.status === 'SUCCEEDED') return checkedFinal(execution, client, key, record, attachment)
    }
    type Resume = NonNullable<Parameters<WalrusClient['writeBlobFlow']>[0]['resume']>
    const flow = client.writeBlobFlow({ blob: payload, ...(record.encoding ? { resume: {
      blobId: record.encoding.blobId, nonce: record.encoding.nonce ?? undefined,
      ...(record.register?.phase === 'SUCCEEDED' ? { txDigest: record.register.digest } : {}),
      ...(record.uploaded ? { blobObjectId: record.uploaded.blobObjectId } : {}),
    } as unknown as Resume } : {}) })
    const encoded = await flow.encode()
    const encoding = { blobId: encoded.blobId, rootHash: encoded.rootHash, unencodedSize: encoded.unencodedSize,
      nonce: 'nonce' in encoded ? encoded.nonce ?? null : null }
    check(!record.encoding || JSON.stringify(record.encoding) === JSON.stringify(encoding), 'WALRUS_SOURCE_ENCODING_MISMATCH_QUERY_ONLY')
    record.encoding = encoding; writeWalrusSingleRecord(key, record)
    const gasBudget = BigInt(record.approved.gasBudget) / 2n
    record = await executeWalrusSinglePacket({ execution, key, record, stage: 'register', gasBudget,
      build: async () => {
        const cost = await client.storageCost(payload.length, intent.storageEpochs)
        check(cost.storageCost <= BigInt(record!.approved!.storageCost) && cost.writeCost <= BigInt(record!.approved!.writeCost), 'WALRUS_APPROVED_STORAGE_COST_EXCEEDED')
        return flow.register({ epochs: intent.storageEpochs, owner: intent.recipient, deletable: true })
      } })
    const objectId = await registeredObjectId(execution, client, record)
    if (!record.uploaded) {
      const uploaded = await flow.upload({ digest: record.register!.digest, deletable: true })
      check(uploaded.blobId === record.encoding!.blobId && uploaded.blobObjectId === objectId, 'WALRUS_RELAY_RESULT_MISMATCH')
      record.uploaded = { blobId: uploaded.blobId, blobObjectId: uploaded.blobObjectId, certificate: uploaded.certificate }
      writeWalrusSingleRecord(key, record)
    }
    record = await executeWalrusSinglePacket({ execution, key, record, stage: 'certify', gasBudget,
      build: () => certification(client, record!, attachment) })
    return checkedFinal(execution, client, key, record, attachment)
  })
}
export async function acknowledgeWalrusSingleBlobUpload(params: { recoveryKey: string; certifyDigest: string }) {
  return withWalrusSingleLock(params.recoveryKey, async () => {
    const record = readWalrusSingleRecord(params.recoveryKey)
    check(record && record.certify?.phase === 'SUCCEEDED' && record.certify.digest === params.certifyDigest, 'WALRUS_ACK_RECEIPT_MISMATCH')
    record.acknowledged = true
    // Retain immutable payment packets and pointer even after acknowledgment.
    writeWalrusSingleRecord(params.recoveryKey, record)
  })
}
export async function recoverDurableWalrusBlob(params: {
  key: string; operationScope: string; execution: WalrusSingleExecution; attachment: WalrusSingleAttachment | null; createClient: Factory
}) {
  params = { ...params, execution: { ...params.execution }, attachment: capturedAttachment(params.attachment) }
  return withWalrusSingleLock(params.key, async () => {
    const record = readWalrusSingleRecord(params.key)
    if (!record) return { status: 'NONE' as const, recoveryKey: params.key }
    return queryDurableRecord({ ...params, record }, true)
  })
}

/** Query an exported payment journal on a fresh device. No local storage,
 * locks, wallet authority, upload or signing is needed or changed here. */
export async function queryDurableWalrusBlobRecord(params: {
  record: WalrusSingleRecord; operationScope: string; execution: WalrusSingleExecution
  attachment: WalrusSingleAttachment | null; createClient: Factory
}) {
  const record = parseWalrusSingleRecord(params.record)
  const frozen = { record, operationScope: params.operationScope, execution: { ...params.execution },
    attachment: capturedAttachment(params.attachment), createClient: params.createClient, key: walrusSingleKey(record.intent) }
  return queryDurableRecord(frozen, false)
}

const HistoricalSystem = bcs.struct('System', { id: bcs.Address, version: bcs.u64(), package_id: bcs.Address,
  new_package_id: bcs.option(bcs.Address) })
const HistoricalElement = bcs.struct('Element', { bytes: bcs.vector(bcs.u8()) })
const HistoricalEventBlob = bcs.struct('EventBlob', { blob_id: bcs.u256(), ending_checkpoint_sequence_number: bcs.u64() })
// Pinned Walrus SystemStateInnerV1 layout, wrapped in its Sui dynamic Field.
// Decode the entire value so a changed layout fails closed.
const HistoricalSystemField = bcs.struct('Field', { id: bcs.Address, name: bcs.u64(), value: bcs.struct('SystemStateInnerV1', {
  committee: bcs.struct('BlsCommittee', { members: bcs.vector(bcs.struct('BlsCommitteeMember', {
    public_key: HistoricalElement, weight: bcs.u16(), node_id: bcs.Address })), n_shards: bcs.u16(), epoch: bcs.u32(), total_aggregated_key: HistoricalElement }),
  total_capacity_size: bcs.u64(), used_capacity_size: bcs.u64(), storage_price_per_unit_size: bcs.u64(), write_price_per_unit_size: bcs.u64(),
  future_accounting: bcs.struct('FutureAccountingRingBuffer', { current_index: bcs.u32(), length: bcs.u32(),
    ring_buffer: bcs.vector(bcs.struct('FutureAccounting', { epoch: bcs.u32(), used_capacity: bcs.u64(),
      rewards_to_distribute: bcs.struct('Balance', { value: bcs.u64() }) })) }),
  event_blob_certification_state: bcs.struct('EventBlobCertificationState', { latest_certified_blob: bcs.option(HistoricalEventBlob),
    aggregate_weight_per_blob: bcs.struct('VecMap', { contents: bcs.vector(bcs.struct('Entry', { key: HistoricalEventBlob, value: bcs.u16() })) }) }),
  deny_list_sizes: bcs.struct('ExtendedField', { id: bcs.Address }),
}) })
const HistoricalCertificate = bcs.struct('Certificate', { signers: bcs.vector(bcs.u16()), serializedMessage: bcs.byteVector(), signature: bcs.byteVector() })
type HistoricalEffects = ReturnType<typeof bcs.TransactionEffects.parse>

/** Prove an old completed upload from its original transactions and historical
 * objects. Current Blob availability/owner/expiry and the current Walrus
 * package or committee have no bearing on this receipt. Source is the caller's
 * already-authorized ciphertext; it is encoded locally, never downloaded. */
export async function queryHistoricalWalrusBlobRecord(params: {
  record: WalrusSingleRecord; payload: Uint8Array; operationScope: string; execution: WalrusSingleExecution
  attachment: WalrusSingleAttachment | null; createClient: Factory; signal: AbortSignal
}) {
  const record = parseWalrusSingleRecord(params.record), payload = new Uint8Array(params.payload)
  const execution = { ...params.execution }, attachment = capturedAttachment(params.attachment), createClient = params.createClient
  const signal = params.signal, recoveryKey = walrusSingleKey(record.intent)
  check(record.intent.operationScope === params.operationScope, 'WALRUS_RECOVERY_SCOPE_MISMATCH'); attachmentFor(record, attachment)
  const step = <T,>(read: () => PromiseLike<T>) => profileReadStep(signal, read)
  try {
    check(payload.length === record.intent.payloadByteLength && await step(() => sha256Hex(payload)) === record.intent.payloadHash,
      'WALRUS_SOURCE_BYTES_MISMATCH')
    await step(() => assertWalrusSingleChain(execution, record.intent.network))
    const proofs = {} as Record<'register' | 'certify', HistoricalEffects>
    for (const stage of ['register', 'certify'] as const) {
      const packet = record[stage]
      if (!packet) return { status: 'SOURCE_REQUIRED' as const, record, recoveryKey }
      const proof = await step(() => queryWalrusSinglePacket(execution, packet))
      if (proof.status === 'MISSING' || proof.status === 'PENDING') return { status: 'UNKNOWN' as const, record, recoveryKey }
      if (proof.status === 'FAILED') return { status: 'FAILED' as const, record, recoveryKey }
      check(proof.effects?.V2, 'WALRUS_HISTORICAL_V2_REQUIRED'); proofs[stage] = proof.effects
      record[stage] = { ...packet, phase: 'SUCCEEDED' }
    }
    const { MAINNET_WALRUS_PACKAGE_CONFIG, TESTNET_WALRUS_PACKAGE_CONFIG, blobIdFromInt, blobIdToInt } = await import('@mysten/walrus')
    const systemId = (record.intent.network === 'mainnet' ? MAINNET_WALRUS_PACKAGE_CONFIG : TESTNET_WALRUS_PACKAGE_CONFIG).systemObjectId
    // The immutable network System ID establishes its type origin, even after
    // an upgrade changes the package used by subsequent calls.
    const read = async (effects: HistoricalEffects, digest: string, objectId: string,
      mode: 'mutated' | 'created' | 'readonly', expectedType?: string) => {
      let type = expectedType
      if (!type) {
        const version = mode === 'readonly' ? effects.V2!.unchangedConsensusObjects.find(([id]) => id === objectId)?.[1].ReadOnlyRoot?.[0]
          : historicalObjectOutput(effects, objectId, mode).version
        check(version !== undefined, 'WALRUS_HISTORICAL_OBJECT_REFERENCE_REQUIRED')
        const { response } = await step(() => execution.client.ledgerService.getObject({ objectId, version: BigInt(version),
          readMask: { paths: ['object_type'] } }, { abort: signal }))
        type = response.object?.objectType
        check(typeof type === 'string', 'WALRUS_HISTORICAL_TYPE_REQUIRED')
      }
      return { ...await readHistoricalMoveObject({ client: execution.client, effects, transactionDigest: digest,
        objectId, type, signal, mode }), type: normalizeStructTag(type) }
    }
    const registeredSystem = await read(proofs.register, record.register!.digest, systemId, 'mutated')
    check(/^0x[0-9a-f]{64}::system::System$/.test(registeredSystem.type), 'WALRUS_HISTORICAL_SYSTEM_TYPE')
    const origin = registeredSystem.type.split('::')[0], system = HistoricalSystem.parse(registeredSystem.bytes)
    check(toBase64(HistoricalSystem.serialize(system).toBytes()) === toBase64(registeredSystem.bytes)
      && system.id === systemId && registeredSystem.reference.owner.$kind === 'Shared', 'WALRUS_HISTORICAL_SYSTEM_INVALID')
    const fieldId = deriveDynamicFieldID(systemId, 'u64', bcs.u64().serialize(system.version).toBytes())
    const field = await read(proofs.register, record.register!.digest, fieldId, 'mutated',
      `0x2::dynamic_field::Field<u64,${origin}::system_state_inner::SystemStateInnerV1>`)
    const state = HistoricalSystemField.parse(field.bytes)
    check(toBase64(HistoricalSystemField.serialize(state).toBytes()) === toBase64(field.bytes)
      && state.id === fieldId && state.name === system.version && field.reference.owner.ObjectOwner === systemId
      && state.value.committee.n_shards > 0, 'WALRUS_HISTORICAL_SYSTEM_STATE_INVALID')
    const certifiedSystem = await read(proofs.certify, record.certify!.digest, systemId, 'readonly', registeredSystem.type)
    const certifySystem = HistoricalSystem.parse(certifiedSystem.bytes)
    check(toBase64(HistoricalSystem.serialize(certifySystem).toBytes()) === toBase64(certifiedSystem.bytes)
      && certifySystem.id === systemId, 'WALRUS_HISTORICAL_SYSTEM_INVALID')
    const client = await step(() => createClient(BigInt(record.approved!.relayTip)))
    const nonce = record.encoding!.nonce === null ? new Uint8Array(32) : fromBase64(record.encoding!.nonce)
    check(nonce.length === 32 && (record.encoding!.nonce === null || toBase64(nonce) === record.encoding!.nonce), 'WALRUS_HISTORICAL_NONCE_INVALID')
    const encoded = await step(() => client.computeBlobMetadata({ bytes: payload, numShards: state.value.committee.n_shards, nonce }))
    check(encoded.blobId === record.encoding!.blobId && toBase64(encoded.rootHash) === record.encoding!.rootHash
      && Number(encoded.metadata.unencodedLength) === payload.length && String(encoded.metadata.encodingType) === 'RS2', 'WALRUS_SOURCE_ENCODING_MISMATCH_QUERY_ONLY')
    const registration = Transaction.from(fromBase64(record.register!.bytes)).getData()
    const registrations = registration.commands.filter(command => command.MoveCall?.package === system.package_id
      && command.MoveCall.module === 'system' && command.MoveCall.function === 'register_blob')
    const registerCall = registrations[0]?.MoveCall
    check(registrations.length === 1 && registerCall && registerCall.typeArguments.length === 0 && registerCall.arguments.length === 8,
      'WALRUS_HISTORICAL_REGISTER_CALL_REQUIRED')
    const registerInput = (index: number) => {
      const argument = registerCall.arguments[index]
      check(argument.$kind === 'Input', 'WALRUS_HISTORICAL_REGISTER_INPUT_REQUIRED')
      return registration.inputs[argument.Input!]
    }
    const registerSelf = registerInput(0).Object?.SharedObject
    check(registerSelf?.objectId === systemId && registerSelf.mutable
      && registerSelf.initialSharedVersion === registeredSystem.reference.owner.Shared?.initialSharedVersion
      && registerInput(2).Pure?.bytes === bcs.u256().serialize(blobIdToInt(encoded.blobId)).toBase64()
      && registerInput(3).Pure?.bytes === toBase64(encoded.rootHash)
      && registerInput(4).Pure?.bytes === bcs.u64().serialize(payload.length).toBase64()
      && registerInput(5).Pure?.bytes === bcs.u8().serialize(1).toBase64()
      && registerInput(6).Pure?.bytes === bcs.bool().serialize(true).toBase64(), 'WALRUS_HISTORICAL_REGISTER_ROOT_MISMATCH')
    const blobId = record.uploaded!.blobObjectId, blobType = `${origin}::blob::Blob`
    const before = await read(proofs.register, record.register!.digest, blobId, 'created', blobType)
    const after = await read(proofs.certify, record.certify!.digest, blobId, 'mutated', blobType)
    const registered = BlobBcs.parse(before.bytes), certified = BlobBcs.parse(after.bytes)
    for (const [blob, source] of [[registered, before], [certified, after]] as const) {
      check(toBase64(BlobBcs.serialize(blob).toBytes()) === toBase64(source.bytes) && blob.id === blobId
        && blobIdFromInt(BigInt(blob.blob_id)) === record.encoding!.blobId && blob.size === String(payload.length)
        && blob.encoding_type === 1 && blob.deletable && blob.registered_epoch === state.value.committee.epoch
        && blob.storage.start_epoch === blob.registered_epoch && blob.storage.end_epoch - blob.storage.start_epoch === record.intent.storageEpochs,
        'WALRUS_HISTORICAL_BLOB_MISMATCH')
    }
    check(before.reference.owner.AddressOwner === record.intent.recipient && registered.certified_epoch === null
      && certified.certified_epoch !== null && certified.certified_epoch >= registered.registered_epoch
      && certified.certified_epoch < registered.storage.end_epoch
      && JSON.stringify({ ...certified, certified_epoch: null }) === JSON.stringify(registered)
      && after.reference.inputOwner?.AddressOwner === record.intent.recipient
      && after.reference.inputVersion! >= before.reference.version
      && (after.reference.inputVersion !== before.reference.version || after.reference.inputDigest === before.reference.digest),
      'WALRUS_HISTORICAL_BLOB_LINEAGE_MISMATCH')
    await historicalCertifyTemplate(record, attachment, proofs.certify, systemId, certifySystem.package_id,
      certifiedSystem.reference.owner, read)
    return { status: 'CERTIFIED' as const, record, recoveryKey, effects: proofs.certify, result: {
      blobId: record.uploaded!.blobId, blobObjectId: blobId, storageTxDigest: record.register!.digest,
      certifyTxDigest: record.certify!.digest, quoteId: record.approved!.quoteId, recoveryKey } }
  } finally { payload.fill(0) }
}

async function historicalCertifyTemplate(record: WalrusSingleRecord, attachment: WalrusSingleAttachment | null,
  effects: HistoricalEffects, systemId: string, packageId: string, systemOwner: ReturnType<typeof bcs.Owner.parse>,
  read: (effects: HistoricalEffects, digest: string, objectId: string, mode: 'readonly') => Promise<{ reference: { owner: ReturnType<typeof bcs.Owner.parse> } }>) {
  const previous = Transaction.from(fromBase64(record.certify!.bytes)), data = previous.getData(), call = data.commands[0]?.MoveCall
  check(call && call.package === packageId && call.module === 'system' && call.function === 'certify_blob'
    && call.typeArguments.length === 0 && call.arguments.length === 5 && call.arguments.every(arg => arg.$kind === 'Input')
    && new Set(call.arguments.map(arg => arg.Input)).size === 5 && call.arguments.every(arg => arg.Input! < 5),
    'WALRUS_HISTORICAL_CERTIFY_PREFIX_MISMATCH')
  const args = call.arguments.map(arg => data.inputs[arg.Input!]), self = args[0].Object?.SharedObject
  check(self?.objectId === systemId && !self.mutable && self.initialSharedVersion === systemOwner.Shared?.initialSharedVersion
    && args[1].Object?.ImmOrOwnedObject?.objectId === record.uploaded!.blobObjectId, 'WALRUS_HISTORICAL_CERTIFY_OBJECT_ROLES')
  const certificate = HistoricalCertificate.fromBase64(record.uploaded!.certificate)
  check(HistoricalCertificate.serialize(certificate).toBase64() === record.uploaded!.certificate, 'WALRUS_HISTORICAL_CERTIFICATE_INVALID')
  check(args[2].Pure?.bytes === bcs.byteVector().serialize(certificate.signature).toBase64()
    && args[4].Pure?.bytes === bcs.byteVector().serialize(certificate.serializedMessage).toBase64()
    && args[3].Pure, 'WALRUS_HISTORICAL_CERTIFICATE_MISMATCH')
  const bitmap = bcs.byteVector().fromBase64(args[3].Pure.bytes), expected = new Uint8Array(bitmap.length)
  check(bitmap.length > 0 && bitmap.length <= 8192 && certificate.signers.length > 0
    && new Set(certificate.signers).size === certificate.signers.length && certificate.signers.every(n => n < bitmap.length * 8),
    'WALRUS_HISTORICAL_BITMAP_INVALID')
  for (const signer of certificate.signers) expected[Math.floor(signer / 8)] |= 1 << (signer % 8)
  check(toBase64(expected) === toBase64(bitmap) && bcs.byteVector().serialize(bitmap).toBase64() === args[3].Pure.bytes,
    'WALRUS_HISTORICAL_BITMAP_MISMATCH')
  // The executed prefix already used the historical committee bitmap length.
  // Keep its indices and append the caller's independently authored graph.
  const prefix = TransactionDataBuilder.fromBytes(fromBase64(record.certify!.bytes))
  prefix.commands = prefix.commands.slice(0, 1); prefix.inputs = prefix.inputs.slice(0, 5)
  const tx = Transaction.fromKind(prefix.build({ onlyTransactionKind: true }))
  const owned = new Set([record.uploaded!.blobObjectId, ...(attachment?.historicalOwnedObjectIds ?? [])])
  const shared = new Map([[systemId, false], ...(attachment?.historicalSharedObjects ?? []).map(row => [row.objectId, row.mutable] as const)])
  check(owned.size === 1 + (attachment?.historicalOwnedObjectIds?.length ?? 0), 'WALRUS_HISTORICAL_OWNED_ROLE_ALIAS')
  for (const id of attachment?.historicalOwnedObjectIds ?? []) check(/^0x[0-9a-f]{64}$/.test(id)
    && id !== systemId && id !== record.uploaded!.blobObjectId, 'WALRUS_HISTORICAL_OWNED_ROLE_ALIAS')
  check(shared.size === 1 + (attachment?.historicalSharedObjects?.length ?? 0)
    && (attachment?.historicalSharedObjects ?? []).every(row => /^0x[0-9a-f]{64}$/.test(row.objectId)
      && typeof row.mutable === 'boolean' && !owned.has(row.objectId)), 'WALRUS_HISTORICAL_SHARED_ROLE_ALIAS')
  attachment?.append(tx, record.uploaded!.blobObjectId)
  tx.addSerializationPlugin(async (builder, _options, next) => {
    for (let index = 0; index < builder.inputs.length; index++) {
      const input = builder.inputs[index], id = input.UnresolvedObject?.objectId ?? input.Object?.ImmOrOwnedObject?.objectId
        ?? input.Object?.SharedObject?.objectId
      if (!id) continue
      const changes = effects.V2!.changedObjects.filter(([key]) => key === id), unchanged = effects.V2!.unchangedConsensusObjects.filter(([key]) => key === id)
      let resolved
      if (owned.has(id)) {
        const prior = changes[0]?.[1].inputState.Exist
        const original = data.inputs.flatMap(value => value.Object?.ImmOrOwnedObject?.objectId === id ? [value.Object.ImmOrOwnedObject] : [])
        // An immutable owned Grant need not appear in changedObjects. Its
        // exact reference is authenticated by the finalized original packet;
        // only the trusted ABI allowlist authorizes this owned role.
        check(original.length === 1 && unchanged.length === 0 && changes.length <= 1
          && (changes.length === 0 || (prior && prior[1].$kind === 'AddressOwner'
            && prior[0][0] === original[0].version && prior[0][1] === original[0].digest)), 'WALRUS_HISTORICAL_OWNED_INPUT_REQUIRED')
        resolved = Inputs.ObjectRef(original[0])
      } else {
        check(shared.has(id), 'WALRUS_HISTORICAL_SHARED_ROLE_REQUIRED')
        const owner = changes.length === 1 && unchanged.length === 0 ? changes[0][1].inputState.Exist?.[1]
          : changes.length === 0 && unchanged.length === 1 ? (await read(effects, record.certify!.digest, id, 'readonly')).reference.owner : undefined
        check(owner?.Shared, 'WALRUS_HISTORICAL_SHARED_INPUT_REQUIRED')
        check(shared.get(id) === (changes.length === 1), 'WALRUS_HISTORICAL_SHARED_MUTABILITY_MISMATCH')
        resolved = Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: owner.Shared.initialSharedVersion, mutable: shared.get(id)! })
      }
      if (input.UnresolvedObject) builder.inputs[index] = resolved
      else check(bcs.CallArg.serialize({ Object: input.Object! }).toBase64() === bcs.CallArg.serialize(resolved).toBase64(),
        'WALRUS_HISTORICAL_INPUT_REFERENCE_MISMATCH')
    }
    await next()
  })
  const bytes = await tx.build({ onlyTransactionKind: true })
  check(JSON.stringify(Transaction.fromKind(bytes).getData().commands) === JSON.stringify(data.commands)
    && JSON.stringify(Transaction.fromKind(bytes).getData().inputs) === JSON.stringify(data.inputs), 'WALRUS_CERTIFY_ATTACHMENT_TEMPLATE_MISMATCH')
}

/** Optional present-day observation for a historically proved Content Blob.
 * Failure to read current storage cannot undo its historical completion. */
export async function observeHistoricalWalrusBlob(params: {
  record: WalrusSingleRecord; expectedOwner: string; execution: WalrusSingleExecution; createClient: Factory; signal: AbortSignal
}): Promise<{ status: 'MATCHES_ORIGINAL' | 'CHANGED' | 'UNAVAILABLE'; reason: string | null }> {
  const record = parseWalrusSingleRecord(params.record), expectedOwner = params.expectedOwner
  const execution = { ...params.execution }, createClient = params.createClient, signal = params.signal
  check(/^0x[0-9a-f]{64}$/.test(expectedOwner) && record.uploaded && record.encoding && record.approved, 'WALRUS_CURRENT_OBSERVATION_INPUT_INVALID')
  const step = <T,>(read: () => PromiseLike<T>) => profileReadStep(signal, read)
  try {
    await step(() => assertWalrusSingleChain(execution, record.intent.network))
    const client = await step(() => createClient(BigInt(record.approved!.relayTip)))
    client.reset()
    const { object } = await step(() => execution.client.core.getObject({ objectId: record.uploaded!.blobObjectId,
      include: { content: true }, signal }))
    const type = await step(async () => client.getBlobType())
    if (object.objectId !== record.uploaded.blobObjectId || object.type !== type || !object.content)
      return { status: 'CHANGED', reason: 'WALRUS_CURRENT_BLOB_TYPE_CHANGED' }
    const blob = BlobBcs.parse(object.content), { blobIdFromInt } = await import('@mysten/walrus')
    if (toBase64(BlobBcs.serialize(blob).toBytes()) !== toBase64(object.content) || blob.id !== record.uploaded.blobObjectId
      || blobIdFromInt(BigInt(blob.blob_id)) !== record.uploaded.blobId || blob.size !== String(record.intent.payloadByteLength)
      || blob.encoding_type !== 1 || !blob.deletable || object.owner.$kind !== 'ObjectOwner' || object.owner.ObjectOwner !== expectedOwner
      || blob.certified_epoch === null || blob.storage.start_epoch !== blob.registered_epoch
      || blob.storage.end_epoch - blob.storage.start_epoch !== record.intent.storageEpochs)
      return { status: 'CHANGED', reason: 'WALRUS_CURRENT_BLOB_CHANGED' }
    const epoch = (await step(() => client.systemState())).committee.epoch
    check(Number.isSafeInteger(epoch) && epoch >= blob.registered_epoch, 'WALRUS_CURRENT_EPOCH_INVALID')
    return epoch < blob.storage.end_epoch ? { status: 'MATCHES_ORIGINAL', reason: null }
      : { status: 'CHANGED', reason: 'WALRUS_CURRENT_STORAGE_EXPIRED' }
  } catch {
    signal.throwIfAborted()
    return { status: 'UNAVAILABLE', reason: 'WALRUS_CURRENT_BLOB_UNAVAILABLE' }
  }
}

/** Read-only prerequisite for an explicit paid-Blob rebase. This is NOT an
 * approval to replace a WAL or execute a packet. It deliberately has no storage
 * access, upload call, wallet authority callback or signature callback. */
export async function inspectWalrusRegisteredBlobForRebase(params: {
  record: WalrusSingleRecord; operationScope: string; execution: WalrusSingleExecution
  attachment: WalrusSingleAttachment; createClient: Factory
}) {
  const record = parseWalrusSingleRecord(params.record), operationScope = params.operationScope
  const attachment = capturedAttachment(params.attachment)!, createClient = params.createClient
  const execution: WalrusSingleExecution = { ...params.execution, beforeWrite: undefined, getAddress: () => null,
    sign: async () => { throw new Error('WALRUS_REBASE_INSPECTION_CANNOT_SIGN') } }
  check(record.intent.operationScope === operationScope, 'WALRUS_RECOVERY_SCOPE_MISMATCH')
  attachmentFor(record, attachment)
  check(record.register && record.encoding && record.approved, 'WALRUS_REBASE_PAID_REGISTER_REQUIRED')
  await assertWalrusSingleChain(execution, record.intent.network)
  const client = await createClient(BigInt(record.approved.relayTip))
  let retirement: { kind: 'NO_RECORDED_PACKET' | 'FAILED' | 'EXPIRED'; digest: string | null; observedSuiEpoch: string | null }
    = { kind: 'NO_RECORDED_PACKET', digest: null, observedSuiEpoch: null }
  if (record.certify) {
    const result = await queryWalrusSinglePacket(execution, record.certify)
    if (result.status === 'SUCCEEDED') return { status: 'COMPLETED' as const, record,
      result: await checkedFinal(execution, client, walrusSingleKey(record.intent), record, attachment, false) }
    check(result.status !== 'PENDING', 'WALRUS_REBASE_PREDECESSOR_PENDING')
    // A local PREPARED/SIGNING flag cannot prove that the wallet never signed.
    // Require chain finality, or a strictly later chain epoch and a second query.
    if (result.status === 'FAILED') retirement = { kind: 'FAILED', digest: record.certify.digest, observedSuiEpoch: null }
    else {
      const { response } = await execution.client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: AbortSignal.timeout(25000) })
      const epoch = response.epoch?.epoch
      check(typeof epoch === 'bigint' && epoch > BigInt(record.certify.expirationEpoch) && epoch <= 18446744073709551615n,
        'WALRUS_REBASE_PREDECESSOR_STILL_EXECUTABLE')
      const again = await queryWalrusSinglePacket(execution, record.certify)
      if (again.status === 'SUCCEEDED') return { status: 'COMPLETED' as const, record,
        result: await checkedFinal(execution, client, walrusSingleKey(record.intent), record, attachment, false) }
      check(again.status !== 'PENDING', 'WALRUS_REBASE_PREDECESSOR_PENDING')
      retirement = { kind: again.status === 'FAILED' ? 'FAILED' : 'EXPIRED', digest: record.certify.digest, observedSuiEpoch: String(epoch) }
    }
    await assertCertifyTemplate(execution, client, record, attachment)
  }
  return { status: 'REBASE_AVAILABLE' as const, record, ...await readUncertifiedRegisteredBlob(execution, client, record), retirement }
}

async function readUncertifiedRegisteredBlob(execution: WalrusSingleExecution, client: WalrusClient, record: WalrusSingleRecord) {
  const registered = await registeredObjectProof(execution, client, record), blobObjectId = registered.objectId
  check(!record.uploaded || record.uploaded.blobObjectId === blobObjectId, 'WALRUS_REGISTER_OBJECT_MISMATCH')
  const current = async () => {
    const { object } = await execution.client.core.getObject({ objectId: blobObjectId, include: { content: true }, signal: AbortSignal.timeout(25000) })
    check(object.objectId === blobObjectId && object.type === await client.getBlobType() && object.content
      && object.owner.$kind === 'AddressOwner' && object.owner.AddressOwner === record.intent.owner
      && record.intent.recipient === record.intent.owner, 'WALRUS_REBASE_BLOB_OWNER_MISMATCH')
    check(typeof object.version === 'string' && /^[1-9][0-9]*$/.test(object.version) && BigInt(object.version) <= 18446744073709551615n
      && typeof object.digest === 'string' && fromBase58(object.digest).length === 32
      && toBase58(fromBase58(object.digest)) === object.digest, 'WALRUS_REBASE_BLOB_REFERENCE_INVALID')
    check(BigInt(object.version) >= BigInt(registered.version)
      && (object.version !== registered.version || object.digest === registered.digest), 'WALRUS_REBASE_BLOB_CREATION_REFERENCE_MISMATCH')
    const blob = BlobBcs.parse(object.content)
    check(toBase64(BlobBcs.serialize(blob).toBytes()) === toBase64(object.content) && blob.id === blobObjectId
      && blob.size === String(record.intent.payloadByteLength) && blob.encoding_type === 1 && blob.deletable
      && blob.certified_epoch === null, 'WALRUS_REBASE_BLOB_NOT_UNCERTIFIED')
    const { blobIdFromInt } = await import('@mysten/walrus')
    check(blobIdFromInt(BigInt(blob.blob_id)) === record.encoding!.blobId
      && blob.registered_epoch === blob.storage.start_epoch
      && blob.storage.end_epoch - blob.storage.start_epoch === record.intent.storageEpochs, 'WALRUS_REBASE_STORAGE_ROOT_MISMATCH')
    return { blob, version: object.version, digest: object.digest, content: toBase64(object.content) }
  }
  const before = await current()
  // The SDK caches systemState. A relay/wallet wait can cross the storage end
  // epoch, so every write checkpoint must refresh rather than reuse that cache.
  client.reset()
  const system = await client.systemState(), epoch = system.committee.epoch
  check(Number.isSafeInteger(epoch) && epoch >= before.blob.registered_epoch && epoch < before.blob.storage.end_epoch,
    'WALRUS_REBASE_STORAGE_EXPIRED')
  const after = await current()
  check(before.version === after.version && before.digest === after.digest && before.content === after.content, 'WALRUS_REBASE_BLOB_CHANGED_RETRY')
  return { blobObjectId, blobVersion: after.version, blobDigest: after.digest, observedWalrusEpoch: epoch, storageEndEpoch: after.blob.storage.end_epoch }
}

/** Continue only an already-paid, durably installed rebase attempt. Missing
 * persistence or a paid register is an error, never an invitation to register.
 * The caller's verifier binds its author-stamped preparation, predecessor and
 * current Soul authority; it runs before relay work and each signature/broadcast. */
export async function continueRegisteredWalrusBlob(params: {
  record: WalrusSingleRecord; payload: Uint8Array; execution: WalrusSingleExecution
  attachment: WalrusSingleAttachment; createClient: Factory; certifyGasBudget: bigint
  verify: () => Promise<void>
}): Promise<DurableWalrusBlobResult> {
  const expected = parseWalrusSingleRecord(params.record), payload = new Uint8Array(params.payload), attachment = capturedAttachment(params.attachment)!
  const execution = { ...params.execution }, createClient = params.createClient, verify = params.verify, gasBudget = params.certifyGasBudget
  const key = walrusSingleKey(expected.intent)
  check(expected.register && expected.encoding && expected.approved && typeof verify === 'function', 'WALRUS_REBASE_PAID_REGISTER_REQUIRED')
  check(typeof gasBudget === 'bigint' && gasBudget > 0n && gasBudget <= 18446744073709551615n
    && gasBudget * 2n === BigInt(expected.approved.gasBudget), 'WALRUS_REBASE_GAS_APPROVAL_REQUIRED')
  try {
    check(payload.length === expected.intent.payloadByteLength && await sha256Hex(payload) === expected.intent.payloadHash, 'WALRUS_SOURCE_BYTES_MISMATCH')
    return await withWalrusSingleLock(key, async () => {
      let record = readWalrusSingleRecord(key)
      check(record?.register && record.encoding && record.approved, 'WALRUS_REBASE_DURABLE_ATTEMPT_REQUIRED')
      check(JSON.stringify(record.intent) === JSON.stringify(expected.intent) && JSON.stringify(record.encoding) === JSON.stringify(expected.encoding)
        && JSON.stringify(record.approved) === JSON.stringify(expected.approved) && record.register.bytes === expected.register!.bytes
        && record.register.digest === expected.register!.digest, 'WALRUS_REBASE_STORAGE_ROOT_CHANGED')
      attachmentFor(record, attachment)
      await assertWalrusSingleChain(execution, record.intent.network)
      const client = await createClient(BigInt(record.approved.relayTip))
      if (record.certify) {
        const prior = await queryWalrusSinglePacket(execution, record.certify)
        if (prior.status === 'SUCCEEDED') return checkedFinal(execution, client, key, record, attachment)
        check(prior.status !== 'FAILED', 'WALRUS_TRANSACTION_FAILED_NO_AUTOMATIC_REPLACEMENT')
        check(prior.status !== 'PENDING', 'WALRUS_TRANSACTION_PENDING')
      }
      const verifyCurrent = async () => {
        await verify()
        if (execution.beforeWrite) await execution.beforeWrite()
        check(execution.getAddress() === record!.intent.owner, 'WALRUS_RECONNECT_PREPARING_WALLET')
        await readUncertifiedRegisteredBlob(execution, client, record!)
        check(execution.getAddress() === record!.intent.owner, 'WALRUS_RECONNECT_PREPARING_WALLET')
      }
      await verifyCurrent()
      // The receipt, not the old local phase, proved this registration succeeded.
      record.register = { ...record.register, phase: 'SUCCEEDED' }
      writeWalrusSingleRecord(key, record)
      type Resume = NonNullable<Parameters<WalrusClient['writeBlobFlow']>[0]['resume']>
      const flow = client.writeBlobFlow({ blob: payload, resume: { blobId: record.encoding.blobId,
        nonce: record.encoding.nonce ?? undefined, txDigest: record.register.digest,
        ...(record.uploaded ? { blobObjectId: record.uploaded.blobObjectId } : {}) } as unknown as Resume })
      const encoded = await flow.encode(), encoding = { blobId: encoded.blobId, rootHash: encoded.rootHash,
        unencodedSize: encoded.unencodedSize, nonce: 'nonce' in encoded ? encoded.nonce ?? null : null }
      check(JSON.stringify(encoding) === JSON.stringify(record.encoding), 'WALRUS_SOURCE_ENCODING_MISMATCH_QUERY_ONLY')
      if (!record.uploaded) {
        await verifyCurrent()
        const original = await readUncertifiedRegisteredBlob(execution, client, record)
        const uploaded = await flow.upload({ digest: record.register.digest, deletable: true })
        check(uploaded.blobId === record.encoding.blobId && uploaded.blobObjectId === original.blobObjectId, 'WALRUS_RELAY_RESULT_MISMATCH')
        record.uploaded = { blobId: uploaded.blobId, blobObjectId: uploaded.blobObjectId, certificate: uploaded.certificate }
        writeWalrusSingleRecord(key, record)
      }
      // There is intentionally no register builder/execute/approval path here.
      record = await executeWalrusSinglePacket({ key, record, stage: 'certify', gasBudget,
        execution: { ...execution, beforeWrite: verifyCurrent }, build: () => certification(client, record!, attachment) })
      return checkedFinal(execution, client, key, record, attachment)
    })
  } finally { payload.fill(0) }
}

async function queryDurableRecord(params: {
  key: string; record: WalrusSingleRecord; operationScope: string; execution: WalrusSingleExecution
  attachment: WalrusSingleAttachment | null; createClient: Factory
}, persist: boolean) {
  let record = params.record
  check(record.intent.operationScope === params.operationScope, 'WALRUS_RECOVERY_SCOPE_MISMATCH')
  attachmentFor(record, params.attachment)
  await assertWalrusSingleChain(params.execution, record.intent.network)
  for (const stage of ['register', 'certify'] as const) {
    const packet = record[stage]
    if (!packet) return { status: 'SOURCE_REQUIRED' as const, recoveryKey: params.key, record }
    const result = await queryWalrusSinglePacket(params.execution, packet)
    if (result.status === 'MISSING' || result.status === 'PENDING') return { status: 'UNKNOWN' as const, recoveryKey: params.key, record }
    record = parseWalrusSingleRecord({ ...record, [stage]: { ...packet, phase: result.status } })
    if (persist) writeWalrusSingleRecord(params.key, record)
    if (result.status === 'FAILED') return { status: 'FAILED' as const, recoveryKey: params.key, record }
  }
  const client = await params.createClient(BigInt(record.approved!.relayTip))
  const result = await checkedFinal(params.execution, client, params.key, record, params.attachment, persist)
  // Both query paths prove current certification and exact public/ciphertext bytes.
  const bytes = await client.readBlob({ blobId: result.blobId, signal: AbortSignal.timeout(25000) })
  check(bytes.length === record.intent.payloadByteLength && await sha256Hex(bytes) === record.intent.payloadHash, 'WALRUS_RECOVERED_BYTES_MISMATCH')
  return { status: 'CERTIFIED' as const, recoveryKey: params.key, record, result }
}
