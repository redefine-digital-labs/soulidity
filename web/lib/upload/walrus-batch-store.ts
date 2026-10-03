import { bcs } from '@mysten/sui/bcs'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { inspectWalrusBatchCertificate } from './walrus-batch-certificate'
import { parseWalrusBatchPreparation, parseWalrusBatchScope, walrusBatchAddress, walrusBatchCanonicalJson, walrusBatchCheck as check,
  walrusBatchDigest, walrusBatchJsonHash, walrusBatchKeys, walrusBatchPreparationHash,
  type WalrusBatchPreparation, type WalrusBatchScope } from './walrus-batch-preparation'

export interface WalrusBatchParentPacket { bytes: string; digest: string }
export interface WalrusBatchRegisteredBlob {
  index: number; objectId: string; version: string; digest: string
  blobId: string; rootHash: string; size: string; recipient: string; encodingType: 1
  registeredEpoch: number; storageStartEpoch: number; storageEndEpoch: number
}
/** This DTO is untrusted when deserialized. Only the injected production
 * historical verifier can establish it; every resumed adapter re-verifies it. */
export interface WalrusBatchRegistrationProof {
  preparationHash: string; packet: WalrusBatchParentPacket; blobs: WalrusBatchRegisteredBlob[]
}
export interface WalrusBatchConsumptionProof {
  preparationHash: string; registerDigest: string; packet: WalrusBatchParentPacket
  indices: number[]; blobObjectIds: string[]
}
export interface WalrusBatchRecord {
  schema: 'soulidity.walrus-batch-record.v1'
  preparation: WalrusBatchPreparation
  revision: number
  registration: WalrusBatchRegistrationProof | null
  certificates: Array<{ index: number; certificate: string }>
  consumptions: WalrusBatchConsumptionProof[]
}
export function parseWalrusBatchParentPacket(input: unknown, owner: string): WalrusBatchParentPacket {
  const packet = structuredClone(input) as WalrusBatchParentPacket
  walrusBatchKeys(packet, ['bytes', 'digest'])
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 2 * 1024 * 1024
    && walrusBatchDigest(packet.digest), 'PARENT_PACKET_INVALID')
  const bytes = fromBase64(packet.bytes), data = bcs.TransactionData.parse(bytes), tx = data.V1
  check(tx && toBase64(bcs.TransactionData.serialize(data).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest && tx.sender === owner && tx.gasData.owner === owner,
  'PARENT_PACKET_BYTES_MISMATCH')
  return packet
}
export function validateWalrusBatchIndices(indices: readonly number[], count: number): number[] {
  check(Array.isArray(indices) && indices.length > 0 && indices.length <= count && new Set(indices).size === indices.length
    && indices.every(index => Number.isInteger(index) && index >= 0 && index < count), 'INDICES_INVALID')
  return [...indices]
}
export function parseWalrusBatchRegistration(input: unknown, preparation: WalrusBatchPreparation): WalrusBatchRegistrationProof {
  const value = structuredClone(input) as WalrusBatchRegistrationProof, manifest = preparation.manifest
  walrusBatchKeys(value, ['preparationHash', 'packet', 'blobs'])
  check(value.preparationHash === walrusBatchPreparationHash(preparation) && Array.isArray(value.blobs)
    && value.blobs.length === manifest.files.length, 'REGISTER_PROOF_BINDING_INVALID')
  value.packet = parseWalrusBatchParentPacket(value.packet, manifest.scope.owner)
  const ids = new Set<string>()
  for (const [index, blob] of value.blobs.entries()) {
    walrusBatchKeys(blob, ['index', 'objectId', 'version', 'digest', 'blobId', 'rootHash', 'size', 'recipient',
      'encodingType', 'registeredEpoch', 'storageStartEpoch', 'storageEndEpoch'])
    const file = manifest.files[index]
    check(blob.index === index && walrusBatchAddress(blob.objectId) && !ids.has(blob.objectId)
      && typeof blob.version === 'string' && /^[1-9][0-9]{0,19}$/.test(blob.version) && BigInt(blob.version) <= 18446744073709551615n
      && walrusBatchDigest(blob.digest) && blob.blobId === file.encoding.blobId && blob.rootHash === file.encoding.rootHash
      && blob.size === String(file.payloadByteLength) && blob.recipient === file.recipient && blob.encodingType === 1
      && Number.isInteger(blob.registeredEpoch) && blob.registeredEpoch >= 0 && blob.registeredEpoch <= 0xffffffff
      && blob.storageStartEpoch === blob.registeredEpoch && Number.isInteger(blob.storageEndEpoch) && blob.storageEndEpoch <= 0xffffffff
      && blob.storageEndEpoch - blob.storageStartEpoch === manifest.storageEpochs, 'REGISTER_BLOB_MISMATCH')
    ids.add(blob.objectId)
  }
  return value
}
export function parseWalrusBatchConsumption(input: unknown, preparation: WalrusBatchPreparation,
  registration: WalrusBatchRegistrationProof): WalrusBatchConsumptionProof {
  const value = structuredClone(input) as WalrusBatchConsumptionProof
  walrusBatchKeys(value, ['preparationHash', 'registerDigest', 'packet', 'indices', 'blobObjectIds'])
  check(value.preparationHash === walrusBatchPreparationHash(preparation) && value.registerDigest === registration.packet.digest,
    'CONSUMPTION_SCOPE_MISMATCH')
  value.packet = parseWalrusBatchParentPacket(value.packet, preparation.manifest.scope.owner)
  check(value.packet.digest !== registration.packet.digest, 'REGISTER_CONSUMPTION_ALIAS')
  value.indices = validateWalrusBatchIndices(value.indices, preparation.manifest.files.length)
  check(Array.isArray(value.blobObjectIds) && value.blobObjectIds.length === value.indices.length
    && value.indices.every((index, position) => value.blobObjectIds[position] === registration.blobs[index].objectId), 'CONSUMPTION_BLOB_MISMATCH')
  return value
}
export function createWalrusBatchRecord(preparation: WalrusBatchPreparation): WalrusBatchRecord {
  return parseWalrusBatchRecord({ schema: 'soulidity.walrus-batch-record.v1', preparation, revision: 0,
    registration: null, certificates: [], consumptions: [] })
}
export function parseWalrusBatchRecord(input: unknown): WalrusBatchRecord {
  const r = structuredClone(input) as WalrusBatchRecord
  walrusBatchKeys(r, ['schema', 'preparation', 'revision', 'registration', 'certificates', 'consumptions'])
  check(r.schema === 'soulidity.walrus-batch-record.v1' && Number.isSafeInteger(r.revision) && r.revision >= 0, 'RECORD_SCHEMA_INVALID')
  r.preparation = parseWalrusBatchPreparation(r.preparation)
  const count = r.preparation.manifest.files.length
  check(Array.isArray(r.certificates) && r.certificates.length <= count && Array.isArray(r.consumptions) && r.consumptions.length <= count,
    'CHECKPOINT_BUDGET')
  if (r.registration === null) check(r.certificates.length === 0 && r.consumptions.length === 0, 'REGISTER_PROOF_REQUIRED')
  else r.registration = parseWalrusBatchRegistration(r.registration, r.preparation)
  const certificates = new Set<number>()
  for (const certificate of r.certificates) {
    walrusBatchKeys(certificate, ['index', 'certificate'])
    validateWalrusBatchIndices([certificate.index], count)
    check(!certificates.has(certificate.index) && r.registration, 'CERTIFICATE_INDEX_ALIAS')
    certificates.add(certificate.index)
    inspectWalrusBatchCertificate(certificate.certificate, { blobId: r.preparation.manifest.files[certificate.index].encoding.blobId,
      blobObjectId: r.registration.blobs[certificate.index].objectId })
  }
  const consumed = new Set<number>(), packets = new Set<string>()
  r.consumptions = r.consumptions.map(value => {
    check(r.registration, 'REGISTER_PROOF_REQUIRED')
    const proof = parseWalrusBatchConsumption(value, r.preparation, r.registration)
    check(!packets.has(proof.packet.digest), 'CONSUMPTION_PACKET_ALIAS'); packets.add(proof.packet.digest)
    for (const index of proof.indices) {
      check(!consumed.has(index) && certificates.has(index), 'CONSUMPTION_INDEX_ALIAS_OR_CERTIFICATE_MISSING'); consumed.add(index)
    }
    return proof
  })
  return r
}
export function walrusBatchStoreKey(scope: WalrusBatchScope): string {
  const s = parseWalrusBatchScope(scope)
  return `soulidity.walrus-batch.v1:${s.network}:${s.owner}:${s.releaseHash}:${encodeURIComponent(s.operationId)}`
}
export function walrusBatchRecordHash(input: WalrusBatchRecord): string {
  const r = parseWalrusBatchRecord(input)
  return walrusBatchJsonHash({ ...r, preparation: walrusBatchPreparationHash(r.preparation) })
}
function assertTransition(previous: WalrusBatchRecord, next: WalrusBatchRecord) {
  check(next.revision === previous.revision + 1 && walrusBatchPreparationHash(previous.preparation) === walrusBatchPreparationHash(next.preparation),
    'CAS_PREPARATION_OR_REVISION_MISMATCH')
  check(previous.registration === null || walrusBatchCanonicalJson(previous.registration) === walrusBatchCanonicalJson(next.registration), 'REGISTER_ROOT_CANNOT_CHANGE')
  for (const receipt of previous.consumptions) check(next.consumptions.some(value => walrusBatchCanonicalJson(value) === walrusBatchCanonicalJson(receipt)), 'CONSUMPTION_CANNOT_DISAPPEAR')
  const consumed = new Set(previous.consumptions.flatMap(receipt => receipt.indices))
  for (const old of previous.certificates) {
    const current = next.certificates.find(value => value.index === old.index)
    check(current && (!consumed.has(old.index) || current.certificate === old.certificate), 'CERTIFICATE_CANNOT_DISAPPEAR_OR_CHANGE_AFTER_CONSUMPTION')
  }
}
export interface WalrusBatchStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): Promise<WalrusBatchRecord | null>
  create(key: string, record: WalrusBatchRecord): Promise<void>
  compareAndSwap(key: string, expectedHash: string, next: WalrusBatchRecord): Promise<void>
  /** Parent/adapter must prove all consumption receipts before archiving.
   * This is storage bookkeeping, not a historical-success verifier. */
  archive(key: string, expectedHash: string): Promise<string>
  readArchive(key: string): Promise<WalrusBatchRecord | null>
}
const DATABASE = 'soulidity-walrus-batch'
export const WALRUS_BATCH_STORE_CHANGED = 'soulidity:walrus-batch-store-changed'
export function openWalrusBatchDatabase(): Promise<IDBDatabase> {
  check(typeof indexedDB !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks?.request, 'INDEXED_DB_AND_LOCKS_REQUIRED')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 3)
    let finished = false
    const timer = setTimeout(() => { finished = true; reject(new Error('WALRUS_BATCH_STORE_OPEN_TIMEOUT')) }, 10000)
    const fail = (error: Error) => { finished = true; clearTimeout(timer); reject(error) }
    request.onupgradeneeded = () => {
      for (const name of ['active', 'archive', 'authoring', 'authoring-packets']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
    }
    request.onblocked = () => fail(new Error('WALRUS_BATCH_STORE_BLOCKED'))
    request.onerror = () => fail(new Error('WALRUS_BATCH_STORE_OPEN_FAILED', { cause: request.error }))
    request.onsuccess = () => {
      clearTimeout(timer)
      if (finished) { request.result.close(); return }
      finished = true; request.result.onversionchange = () => request.result.close(); resolve(request.result)
    }
  })
}
/** Native IDB stores ciphertext bytes without localStorage size/encoding loss.
 * Each mutation uses strict durability, CAS and a separate verified readback.
 * A write/readback/lock failure is an error, never an empty/new paid operation. */
export function browserWalrusBatchStore(): WalrusBatchStore {
  async function read(key: string, store: 'active' | 'archive') {
    const db = await openWalrusBatchDatabase()
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key)
        tx.onabort = () => reject(new Error('WALRUS_BATCH_STORE_READ_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve(request.result ?? null)
      })
      if (value === null) return null
      const record = parseWalrusBatchRecord(value), base = walrusBatchStoreKey(record.preparation.manifest.scope)
      check((store === 'active' ? base : `${base}:receipt:${walrusBatchRecordHash(record)}`) === key, 'STORE_KEY_MISMATCH')
      return record
    } finally { db.close() }
  }
  async function write(key: string, input: WalrusBatchRecord, expectedHash: string | null) {
    const next = parseWalrusBatchRecord(input), fingerprint = walrusBatchRecordHash(next)
    check(walrusBatchStoreKey(next.preparation.manifest.scope) === key, 'STORE_KEY_MISMATCH')
    if (expectedHash === null) check(next.revision === 0 && next.registration === null && next.certificates.length === 0 && next.consumptions.length === 0,
      'INITIAL_RECORD_REQUIRED')
    const db = await openWalrusBatchDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('active', 'readwrite', { durability: 'strict' }), target = tx.objectStore('active'), get = target.get(key)
        let cause: unknown
        tx.onabort = () => reject(cause ?? new Error('WALRUS_BATCH_STORE_WRITE_FAILED', { cause: tx.error }))
        tx.oncomplete = () => resolve()
        get.onsuccess = () => {
          try {
            if (get.result === undefined) check(expectedHash === null, 'CAS_MISSING_RECORD')
            else {
              const previous = parseWalrusBatchRecord(get.result), previousHash = walrusBatchRecordHash(previous)
              if (expectedHash === null) check(previousHash === fingerprint, 'UNRESOLVED_OPERATION')
              else { check(previousHash === expectedHash, 'CAS_MISMATCH'); assertTransition(previous, next) }
            }
            target.put(next, key)
          } catch (error) { cause = error; tx.abort() }
        }
      })
      const persisted = await read(key, 'active')
      check(persisted && walrusBatchRecordHash(persisted) === fingerprint, 'STORE_READBACK_MISMATCH')
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALRUS_BATCH_STORE_CHANGED))
    } finally { db.close() }
  }
  return {
    read: key => read(key, 'active'), readArchive: key => read(key, 'archive'),
    create: (key, record) => write(key, record, null), compareAndSwap: (key, expectedHash, next) => write(key, next, expectedHash),
    exclusive: async (key, work) => {
      check(typeof navigator !== 'undefined' && navigator.locks?.request, 'LOCKS_REQUIRED')
      return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        check(lock, 'BUSY_IN_ANOTHER_TAB'); return work()
      })
    },
    archive: async (key, expectedHash) => {
      const db = await openWalrusBatchDatabase()
      const archiveKey = `${key}:receipt:${expectedHash}`
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['active', 'archive'], 'readwrite', { durability: 'strict' })
          const active = tx.objectStore('active'), archived = tx.objectStore('archive'), get = active.get(key)
          let cause: unknown
          const abort = (error: unknown) => { cause = error; tx.abort() }
          tx.onabort = () => reject(cause ?? new Error('WALRUS_BATCH_STORE_ARCHIVE_FAILED', { cause: tx.error }))
          tx.oncomplete = () => resolve()
          get.onsuccess = () => {
            try {
              check(get.result !== undefined, 'ARCHIVE_ACTIVE_REQUIRED')
              const record = parseWalrusBatchRecord(get.result)
              check(walrusBatchStoreKey(record.preparation.manifest.scope) === key && walrusBatchRecordHash(record) === expectedHash, 'ARCHIVE_CAS_MISMATCH')
              check(record.registration && new Set(record.consumptions.flatMap(proof => proof.indices)).size === record.preparation.manifest.files.length,
                'ARCHIVE_COMPLETION_REQUIRED')
              const previous = archived.get(archiveKey)
              previous.onsuccess = () => {
                try {
                  check(previous.result === undefined || walrusBatchRecordHash(previous.result) === expectedHash, 'ARCHIVE_CONFLICT')
                  archived.put(record, archiveKey); active.delete(key)
                } catch (error) { abort(error) }
              }
            } catch (error) { abort(error) }
          }
        })
        const persisted = await read(archiveKey, 'archive')
        check(persisted && walrusBatchRecordHash(persisted) === expectedHash, 'ARCHIVE_READBACK_MISMATCH')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(WALRUS_BATCH_STORE_CHANGED))
        return archiveKey
      } finally { db.close() }
    },
  }
}
