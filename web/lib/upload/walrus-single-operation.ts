'use client'

import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'

export interface WalrusSingleExecution {
  client: SuiGrpcClient
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  /** Optional caller-specific live authority check. Query-only recovery never
   * calls this; each new signature or rebroadcast does, including SIGNED replay. */
  beforeWrite?: () => Promise<void>
}
export interface WalrusSingleAttachment {
  scope: string
  append: (transaction: Transaction, blobObjectId: string) => void
  /** Trusted ABI-known owned IDs, used only for historical template checks
   * after deletion/revocation. Never used by the signing/rebroadcast resolver. */
  historicalOwnedObjectIds?: string[]
  /** ABI-known shared roles for offline historical attachment reconstruction;
   * historical success never takes mutability from an untrusted packet. */
  historicalSharedObjects?: { objectId: string; mutable: boolean }[]
}
export function captureWalrusSingleAttachment(value: WalrusSingleAttachment | null) {
  return value ? { ...value, ...(value.historicalOwnedObjectIds ? { historicalOwnedObjectIds: [...value.historicalOwnedObjectIds] } : {}),
    ...(value.historicalSharedObjects ? { historicalSharedObjects: value.historicalSharedObjects.map(row => ({ ...row })) } : {}) } : null
}
export interface WalrusSinglePacket {
  bytes: string
  digest: string
  expirationEpoch: string
  phase: 'PREPARED' | 'SIGNING' | 'SIGNED' | 'SUCCEEDED' | 'FAILED'
  signature: string | null
}
export interface WalrusSingleIntent {
  network: 'mainnet' | 'testnet'
  owner: string
  recipient: string
  operationScope: string
  attachmentScope: string | null
  contentHash: string
  payloadHash: string
  payloadByteLength: number
  storageEpochs: number
  relayUrl: string
}
export interface WalrusSingleRecord {
  schema: 'soulidity.walrus-single.v1'
  intent: WalrusSingleIntent
  encoding: { blobId: string; rootHash: string; unencodedSize: number; nonce: string | null } | null
  uploaded: { blobId: string; blobObjectId: string; certificate: string } | null
  approved: { relayTip: string; storageCost: string; writeCost: string; gasBudget: string; quoteId: string } | null
  register: WalrusSinglePacket | null
  certify: WalrusSinglePacket | null
  acknowledged: boolean
}
export function walrusSingleCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const check: (condition: unknown, message: string) => asserts condition = walrusSingleCheck
const canonical = (value: unknown) => JSON.stringify(value)
const uint = (value: unknown) => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n
const address = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const text = (value: unknown, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit
export function walrusSingleKey(intent: Pick<WalrusSingleIntent, 'network' | 'owner' | 'operationScope'>): string {
  check(['mainnet', 'testnet'].includes(intent.network) && address(intent.owner) && text(intent.operationScope, 1024), 'WALRUS_OPERATION_SCOPE_INVALID')
  return `soulidity.walrus-single.v1:${intent.network}:${intent.owner}:${encodeURIComponent(intent.operationScope)}`
}
function parsePacket(value: WalrusSinglePacket, owner: string): void {
  check(text(value.bytes, 2_000_000) && text(value.digest, 100) && uint(value.expirationEpoch), 'WALRUS_PACKET_INVALID')
  const bytes = fromBase64(value.bytes), tx = bcs.TransactionData.parse(bytes).V1
  check(tx && toBase64(bcs.TransactionData.serialize({ V1: tx }).toBytes()) === value.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === value.digest
    && tx.sender === owner && tx.gasData.owner === owner && String(tx.expiration.Epoch) === value.expirationEpoch
    && BigInt(tx.gasData.budget) > 0n && BigInt(tx.gasData.price) > 0n, 'WALRUS_PACKET_BYTES_MISMATCH')
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED'].includes(value.phase)
    && (value.signature === null || text(value.signature, 32768))
    && (value.phase !== 'SIGNED' || value.signature !== null)
    && (!['PREPARED', 'SIGNING'].includes(value.phase) || value.signature === null), 'WALRUS_PACKET_PHASE_INVALID')
}
/** Shape/digest parsing is not authorization. Before every sign/rebroadcast the
 * caller reconstructs the actual SDK transaction from its current trusted scope. */
export function parseWalrusSingleRecord(input: unknown): WalrusSingleRecord {
  const r = structuredClone(input) as WalrusSingleRecord
  check(r?.schema === 'soulidity.walrus-single.v1' && r.intent, 'WALRUS_JOURNAL_SCHEMA_INVALID')
  walrusSingleKey(r.intent)
  check(address(r.intent.recipient) && hash(r.intent.contentHash) && hash(r.intent.payloadHash)
    && Number.isSafeInteger(r.intent.payloadByteLength) && r.intent.payloadByteLength > 0
    && Number.isSafeInteger(r.intent.storageEpochs) && r.intent.storageEpochs > 0
    && text(r.intent.relayUrl) && (r.intent.attachmentScope === null || text(r.intent.attachmentScope, 1024)), 'WALRUS_JOURNAL_INTENT_INVALID')
  check(typeof r.acknowledged === 'boolean', 'WALRUS_JOURNAL_ACK_INVALID')
  if (r.approved) check(uint(r.approved.relayTip) && uint(r.approved.storageCost) && uint(r.approved.writeCost)
    && uint(r.approved.gasBudget) && BigInt(r.approved.gasBudget) > 0n && text(r.approved.quoteId), 'WALRUS_APPROVAL_INVALID')
  if (r.encoding) check(text(r.encoding.blobId, 100) && text(r.encoding.rootHash, 100)
    && r.encoding.unencodedSize === r.intent.payloadByteLength
    && (r.encoding.nonce === null || text(r.encoding.nonce, 100)), 'WALRUS_JOURNAL_ENCODING_INVALID')
  if (r.register) { check(r.encoding && r.approved, 'WALRUS_ENCODING_APPROVAL_REQUIRED'); parsePacket(r.register, r.intent.owner) }
  if (r.uploaded) check(r.encoding && r.register?.phase === 'SUCCEEDED'
    && r.uploaded.blobId === r.encoding.blobId && address(r.uploaded.blobObjectId)
    && text(r.uploaded.certificate, 1_000_000), 'WALRUS_JOURNAL_UPLOAD_INVALID')
  if (r.certify) { check(r.uploaded, 'WALRUS_UPLOAD_REQUIRED'); parsePacket(r.certify, r.intent.owner) }
  check(!r.acknowledged || r.certify?.phase === 'SUCCEEDED', 'WALRUS_UNCERTIFIED_ACK')
  return r
}
function storage() {
  check(typeof window !== 'undefined' && navigator.locks?.request, 'WALRUS_RECOVERY_REQUIRES_STORAGE_AND_LOCKS')
  return window.localStorage
}
export function readWalrusSingleRecord(key: string): WalrusSingleRecord | null {
  const raw = storage().getItem(key)
  if (raw === null) return null
  check(raw.length <= 5_000_000, 'WALRUS_JOURNAL_TOO_LARGE')
  const result = parseWalrusSingleRecord(JSON.parse(raw))
  check(walrusSingleKey(result.intent) === key, 'WALRUS_JOURNAL_KEY_MISMATCH')
  return result
}
export function writeWalrusSingleRecord(key: string, input: WalrusSingleRecord) {
  const record = parseWalrusSingleRecord(input)
  check(walrusSingleKey(record.intent) === key, 'WALRUS_JOURNAL_KEY_MISMATCH')
  const encoded = canonical(record), target = storage()
  check(encoded.length <= 5_000_000, 'WALRUS_JOURNAL_TOO_LARGE')
  target.setItem(key, encoded)
  check(target.getItem(key) === encoded, 'WALRUS_JOURNAL_PERSISTENCE_FAILED')
}
/** Archive before replacing an explicitly acknowledged logical scope. No paid
 * packet is deleted, and archive/readback failure leaves the active record. */
export function archiveWalrusSingleRecord(key: string, input: WalrusSingleRecord) {
  const record = parseWalrusSingleRecord(input)
  check(walrusSingleKey(record.intent) === key && record.acknowledged && record.certify?.phase === 'SUCCEEDED', 'WALRUS_UNACKNOWLEDGED_REPLACEMENT')
  const archiveKey = `${key}:receipt:${record.certify.digest}`, encoded = canonical(record), target = storage()
  const previous = target.getItem(archiveKey)
  check(previous === null || previous === encoded, 'WALRUS_ARCHIVED_RECEIPT_CONFLICT')
  target.setItem(archiveKey, encoded)
  check(target.getItem(archiveKey) === encoded, 'WALRUS_ARCHIVE_PERSISTENCE_FAILED')
  return archiveKey
}
export async function withWalrusSingleLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  storage()
  return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
    check(lock, 'WALRUS_OPERATION_BUSY_IN_ANOTHER_TAB')
    return work()
  })
}
export async function assertWalrusSingleChain(execution: WalrusSingleExecution, network: WalrusSingleIntent['network']) {
  const { chainIdentifier } = await bounded(signal => execution.client.core.getChainIdentifier({ signal }))
  const bytes = fromBase58(chainIdentifier)
  check(bytes.length === 32 && toHex(bytes.slice(0, 4)) === (network === 'mainnet' ? '35834a8a' : '4c78adac'), 'WALRUS_WRONG_CHAIN')
}
async function epoch(execution: WalrusSingleExecution) {
  const { response } = await bounded(signal => execution.client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: signal }))
  const value = response.epoch?.epoch
  check(typeof value === 'bigint' && value >= 0n && value < 18446744073709551615n, 'WALRUS_EPOCH_UNAVAILABLE')
  return value
}
async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>, ms = 25000): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('WALRUS_REQUEST_UNKNOWN_RETRY_SAME_OPERATION')) }, ms)
  })]) } finally { clearTimeout(timer) }
}
export async function queryWalrusSinglePacket(execution: WalrusSingleExecution, packet: WalrusSinglePacket) {
  let response
  try {
    response = (await bounded(signal => execution.client.ledgerService.getTransaction({ digest: packet.digest,
      readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.status', 'checkpoint'] } }, { abort: signal }))).response
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' as const }
    throw error
  }
  const value = response.transaction
  check(value?.digest === packet.digest && value.transaction?.digest === packet.digest
    && value.transaction.bcs?.value && toBase64(value.transaction.bcs.value) === packet.bytes
    && value.effects?.bcs?.value, 'WALRUS_TRANSACTION_EVIDENCE_MISMATCH')
  const bytes = value.effects.bcs.value, effects = bcs.TransactionEffects.parse(bytes)
  check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(bytes), 'WALRUS_EFFECTS_NONCANONICAL')
  const decoded = effects.V2 ?? effects.V1
  check(decoded && decoded.transactionDigest === packet.digest
    && ['Success', 'Failure'].includes(decoded.status.$kind)
    && value.effects.status?.success === (decoded.status.$kind === 'Success'), 'WALRUS_EFFECTS_STATUS_MISMATCH')
  if (value.checkpoint === undefined) return { status: 'PENDING' as const }
  check(value.checkpoint >= 0n, 'WALRUS_CHECKPOINT_INVALID')
  return { status: decoded.status.$kind === 'Success' ? 'SUCCEEDED' as const : 'FAILED' as const, effects }
}
/** No object-ref/gas rewrite is permitted here: this compares the canonical
 * actual SDK kind, then signs and broadcasts exactly the original full bytes. */
export async function executeWalrusSinglePacket(params: {
  execution: WalrusSingleExecution; record: WalrusSingleRecord; key: string; stage: 'register' | 'certify'
  build: () => Promise<Transaction>; gasBudget: bigint
}): Promise<WalrusSingleRecord> {
  const { key, stage } = params
  const execution = { ...params.execution }
  let record = parseWalrusSingleRecord(params.record)
  const save = () => writeWalrusSingleRecord(key, record)
  const writable = () => check(execution.getAddress() === record.intent.owner, 'WALRUS_RECONNECT_PREPARING_WALLET')
  const verifyWrite = async () => {
    writable()
    if (execution.beforeWrite) await bounded(() => execution.beforeWrite!())
    writable()
  }
  await assertWalrusSingleChain(execution, record.intent.network)
  let packet = record[stage]
  if (packet) {
    const result = await queryWalrusSinglePacket(execution, packet)
    if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
      record[stage] = { ...packet, phase: result.status }; save()
      check(result.status === 'SUCCEEDED', 'WALRUS_TRANSACTION_FAILED_NO_AUTOMATIC_REPLACEMENT')
      return record
    }
    check(!['SUCCEEDED', 'FAILED'].includes(packet.phase), 'WALRUS_PREVIOUS_RESULT_UNCONFIRMED')
    check(result.status !== 'PENDING', 'WALRUS_TRANSACTION_PENDING')
  }
  await verifyWrite()
  const tx = await params.build()
  tx.setSender(record.intent.owner)
  writable()
  if (packet) {
    const currentEpoch = await epoch(execution)
    check(currentEpoch <= BigInt(packet.expirationEpoch), 'WALRUS_EXPIRED_QUERY_ONLY')
    check(BigInt(packet.expirationEpoch) <= currentEpoch + 1n, 'WALRUS_EXPIRATION_OUTSIDE_APPROVED_WINDOW')
    check(BigInt(bcs.TransactionData.parse(fromBase64(packet.bytes)).V1!.gasData.budget) <= params.gasBudget,
      'WALRUS_APPROVED_GAS_EXCEEDED')
    const kind = await bounded(() => tx.build({ client: execution.client, onlyTransactionKind: true }))
    const actualKind = TransactionDataBuilder.fromBytes(fromBase64(packet.bytes)).build({ onlyTransactionKind: true })
    check(toBase64(kind) === toBase64(actualKind), 'WALRUS_RECOVERY_SDK_TEMPLATE_CHANGED_QUERY_ONLY')
  } else {
    tx.setSender(record.intent.owner); tx.setExpiration({ Epoch: String(await epoch(execution) + 1n) })
    check(params.gasBudget > 0n, 'WALRUS_APPROVED_GAS_REQUIRED')
    tx.setGasBudget(params.gasBudget)
    const bytes = await bounded(() => tx.build({ client: execution.client }))
    const expirationEpoch = String(bcs.TransactionData.parse(bytes).V1!.expiration.Epoch!)
    packet = { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch,
      phase: 'PREPARED', signature: null }
    record[stage] = packet; save()
  }
  check(packet, 'WALRUS_PREPARED_PACKET_REQUIRED')
  writable()
  if (packet.phase !== 'SIGNED') {
    await verifyWrite()
    packet = { ...packet, phase: 'SIGNING' }; record[stage] = packet; save()
    const signed = await bounded(() => execution.sign(Transaction.from(fromBase64(packet!.bytes))), 120000)
    check(signed.bytes === packet.bytes, 'WALRUS_WALLET_CHANGED_BYTES')
    await verifyTransactionSignature(fromBase64(packet.bytes), signed.signature, { address: record.intent.owner, client: execution.client })
    packet = { ...packet, phase: 'SIGNED', signature: signed.signature }; record[stage] = packet; save()
  }
  writable()
  await verifyTransactionSignature(fromBase64(packet.bytes), packet.signature!, { address: record.intent.owner, client: execution.client })
  check(await epoch(execution) <= BigInt(packet.expirationEpoch), 'WALRUS_EXPIRED_QUERY_ONLY')
  await verifyWrite()
  // Any timeout is an unknown outcome. Signed bytes remain durable; no callback
  // from a timed-out sign can reach this broadcast.
  await bounded(signal => execution.client.core.executeTransaction({ transaction: fromBase64(packet!.bytes), signatures: [packet!.signature!], signal }))
  const result = await queryWalrusSinglePacket(execution, packet)
  if (result.status === 'SUCCEEDED' || result.status === 'FAILED') { record[stage] = { ...packet, phase: result.status }; save() }
  check(result.status === 'SUCCEEDED', result.status === 'FAILED' ? 'WALRUS_TRANSACTION_FAILED_NO_AUTOMATIC_REPLACEMENT' : 'WALRUS_TRANSACTION_UNKNOWN_QUERY_SAME_DIGEST')
  return record
}
