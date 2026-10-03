import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blobIdFromInt, blobIdToInt, type WalrusClient } from '@mysten/walrus'
import type { PendingSealMaterial } from './client-seal'
import { preparePayload, readAndHashUploadFile, type BatchSoulUploadFile, type PreparedFile,
  type SoulUploadKind, type SoulUploadType } from './client-upload'

// Parser/import budgets, not the on-chain Collection supply cap. A caller must
// surface these before payment; records are never truncated or TTL-deleted.
export const WALRUS_BATCH_MAX_FILES = 4096
export const WALRUS_BATCH_MAX_BYTES = 512 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024 + 16
const utf8 = new TextEncoder()
export function walrusBatchCheck(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`WALRUS_BATCH_${code}`)
}
const check: (value: unknown, code: string) => asserts value = walrusBatchCheck
export function walrusBatchHash(bytes: Uint8Array) { return toHex(sha256(bytes)) }
/** Stable public JSON commitments across parent WAL canonicalization. Array
 * order remains meaningful; bytes/private material must use explicit codecs. */
export function walrusBatchCanonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') { check(Number.isFinite(input), 'CANONICAL_NUMBER_INVALID'); return input }
    if (Array.isArray(input)) return input.map(normalize)
    check(input && typeof input === 'object' && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null), 'CANONICAL_JSON_VALUE_INVALID')
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize((input as Record<string, unknown>)[key])]))
  }
  return JSON.stringify(normalize(value))
}
export function walrusBatchJsonHash(value: unknown) { return walrusBatchHash(utf8.encode(walrusBatchCanonicalJson(value))) }
export function walrusBatchKeys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length
    && names.every(name => Object.hasOwn(value, name)), 'SHAPE_INVALID')
}
export function walrusBatchAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
}
export function walrusBatchDigest(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false
  try { return fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value } catch { return false }
}
function hash(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
export function walrusBatchBase64(value: unknown, maxBytes: number): Uint8Array {
  check(typeof value === 'string' && value.length <= Math.ceil(maxBytes / 3) * 4, 'BASE64_SIZE_INVALID')
  const bytes = fromBase64(value)
  check(bytes.length <= maxBytes && toBase64(bytes) === value, 'BASE64_INVALID')
  return bytes
}
export interface WalrusBatchScope {
  network: 'mainnet' | 'testnet'
  owner: string
  releaseHash: string
  operationId: string
  intentHash: string
}
export interface WalrusBatchLifetime {
  signal: AbortSignal
  getAddress: () => string | null
  /** Must capture the parent's client/release/wallet generation, not just its
   * current address: an A→B→A transition must invalidate the original work. */
  isCurrent: () => boolean
}
export function assertWalrusBatchLifetime(scope: WalrusBatchScope, life: WalrusBatchLifetime) {
  life.signal.throwIfAborted()
  check(life.isCurrent() && life.getAddress() === scope.owner, 'LIFETIME_CHANGED')
}
/** Every asynchronous boundary is bounded; late crypto results are discarded.
 * Direct-node writers receive this same abort signal to stop outstanding I/O. */
export async function walrusBatchStep<T>(scope: WalrusBatchScope, life: WalrusBatchLifetime,
  run: (signal: AbortSignal) => PromiseLike<T> | T, discard?: (value: T) => void, timeoutMs = 30000): Promise<T> {
  assertWalrusBatchLifetime(scope, life)
  const timeout = new AbortController(), signal = AbortSignal.any([life.signal, timeout.signal])
  let finished = false, onAbort: (() => void) | undefined
  const timer = setTimeout(() => timeout.abort(new Error('WALRUS_BATCH_TIMEOUT_RETRY_SAME_OPERATION')), timeoutMs)
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => { assertWalrusBatchLifetime(scope, life); return run(signal) }).then(value => {
        try { check(!finished, 'LATE_RESULT'); assertWalrusBatchLifetime(scope, life); signal.throwIfAborted(); return value }
        catch (error) { discard?.(value); throw error }
      }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('WALRUS_BATCH_ABORTED'))
        signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort()
      }),
    ])
    assertWalrusBatchLifetime(scope, life)
    return value
  } finally {
    finished = true; clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
export interface WalrusBatchFileManifest {
  index: number
  recipient: string
  kind: SoulUploadKind
  uploadType: SoulUploadType
  fileName: string
  mimeType: string
  plaintextByteLength: number
  payloadByteLength: number
  contentHash: string
  payloadHash: string
  skillName: string | null
  encoding: { blobId: string; rootHash: string; encodingType: 'RS2'; nShards: number }
}
export interface WalrusBatchManifest {
  schema: 'soulidity.walrus-batch-manifest.v1'
  scope: WalrusBatchScope
  storageEpochs: number
  files: WalrusBatchFileManifest[]
}
export interface WalrusBatchProtection {
  contextHash: string
  encrypted: string
}
export interface WalrusBatchPreparation {
  schema: 'soulidity.walrus-batch-preparation.v1'
  manifest: WalrusBatchManifest
  manifestHash: string
  payloads: Uint8Array[]
  privateRecovery: WalrusBatchProtection | null
}
export interface WalrusBatchProtector {
  /** One aggregate wrapping call. The implementation must use the approved
   * Seal namespace/policy and AAD binding contextHash plus the caller's full
   * planned-slot/release scope; this layer never asks to sign. */
  protect(input: { manifest: WalrusBatchManifest; contextHash: string; plaintext: Uint8Array; signal: AbortSignal }): Promise<Uint8Array>
  /** Validate the actual encrypted-object namespace/document/AAD/keyset. Shape
   * parsing alone is not a claim that arbitrary callback bytes are encrypted. */
  verify(input: { manifest: WalrusBatchManifest; protection: WalrusBatchProtection; signal: AbortSignal }): Promise<void>
}
export function parseWalrusBatchScope(input: unknown): WalrusBatchScope {
  const s = structuredClone(input) as WalrusBatchScope
  walrusBatchKeys(s, ['network', 'owner', 'releaseHash', 'operationId', 'intentHash'])
  check(['mainnet', 'testnet'].includes(s.network) && walrusBatchAddress(s.owner)
    && hash(s.releaseHash) && hash(s.intentHash) && text(s.operationId, 256), 'SCOPE_INVALID')
  return s
}
export function parseWalrusBatchManifest(input: unknown): WalrusBatchManifest {
  const m = structuredClone(input) as WalrusBatchManifest
  walrusBatchKeys(m, ['schema', 'scope', 'storageEpochs', 'files'])
  check(m.schema === 'soulidity.walrus-batch-manifest.v1' && Number.isInteger(m.storageEpochs)
    && m.storageEpochs > 0 && m.storageEpochs <= 0xffffffff, 'MANIFEST_INVALID')
  m.scope = parseWalrusBatchScope(m.scope)
  check(Array.isArray(m.files) && m.files.length <= WALRUS_BATCH_MAX_FILES, 'FILE_COUNT_INVALID')
  let total = 0
  for (const [index, file] of m.files.entries()) {
    walrusBatchKeys(file, ['index', 'recipient', 'kind', 'uploadType', 'fileName', 'mimeType', 'plaintextByteLength',
      'payloadByteLength', 'contentHash', 'payloadHash', 'skillName', 'encoding'])
    check(file.index === index && walrusBatchAddress(file.recipient) && ['persona-sprite', 'soul-content'].includes(file.kind)
      && ['public', 'encrypted'].includes(file.uploadType) && text(file.fileName, 4096) && text(file.mimeType, 1024)
      && Number.isSafeInteger(file.plaintextByteLength) && file.plaintextByteLength >= 0
      && Number.isSafeInteger(file.payloadByteLength) && file.payloadByteLength > 0 && file.payloadByteLength <= MAX_FILE_BYTES
      && file.payloadByteLength === file.plaintextByteLength + (file.uploadType === 'encrypted' ? 16 : 0)
      && hash(file.contentHash) && hash(file.payloadHash)
      && (file.skillName === null || /^[a-z0-9_-]{1,32}$/.test(file.skillName)), 'FILE_MANIFEST_INVALID')
    if (file.uploadType === 'public') check(file.contentHash === file.payloadHash, 'PUBLIC_HASH_MISMATCH')
    walrusBatchKeys(file.encoding, ['blobId', 'rootHash', 'encodingType', 'nShards'])
    check(text(file.encoding.blobId, 100) && blobIdFromInt(blobIdToInt(file.encoding.blobId)) === file.encoding.blobId
      && walrusBatchBase64(file.encoding.rootHash, 32).length === 32 && file.encoding.encodingType === 'RS2'
      && Number.isInteger(file.encoding.nShards) && file.encoding.nShards > 0 && file.encoding.nShards <= 65535, 'ENCODING_INVALID')
    total += file.payloadByteLength
  }
  check(total <= WALRUS_BATCH_MAX_BYTES && m.files.every(file => file.encoding.nShards === m.files[0].encoding.nShards), 'BATCH_BUDGET_OR_SHARDS_INVALID')
  return m
}
export function parseWalrusBatchPreparation(input: unknown): WalrusBatchPreparation {
  const p = structuredClone(input) as WalrusBatchPreparation
  walrusBatchKeys(p, ['schema', 'manifest', 'manifestHash', 'payloads', 'privateRecovery'])
  check(p.schema === 'soulidity.walrus-batch-preparation.v1', 'PREPARATION_SCHEMA_INVALID')
  p.manifest = parseWalrusBatchManifest(p.manifest)
  check(p.manifestHash === walrusBatchJsonHash(p.manifest) && Array.isArray(p.payloads)
    && p.payloads.length === p.manifest.files.length, 'MANIFEST_HASH_MISMATCH')
  for (const [index, bytes] of p.payloads.entries()) check(bytes instanceof Uint8Array
    && bytes.length === p.manifest.files[index].payloadByteLength && walrusBatchHash(bytes) === p.manifest.files[index].payloadHash,
  'PAYLOAD_MISMATCH')
  const privateFiles = p.manifest.files.some(file => file.uploadType === 'encrypted')
  check(privateFiles === (p.privateRecovery !== null), 'PRIVATE_RECOVERY_REQUIRED')
  if (p.privateRecovery) {
    walrusBatchKeys(p.privateRecovery, ['contextHash', 'encrypted'])
    check(p.privateRecovery.contextHash === p.manifestHash && walrusBatchBase64(p.privateRecovery.encrypted, 8 * 1024 * 1024).length > 0,
      'PRIVATE_RECOVERY_BINDING_INVALID')
  }
  return p
}
export function walrusBatchPreparationHash(input: WalrusBatchPreparation) {
  const p = parseWalrusBatchPreparation(input)
  return walrusBatchJsonHash({ schema: p.schema, manifestHash: p.manifestHash, privateRecovery: p.privateRecovery })
}
export function exportWalrusBatchPreparation(input: WalrusBatchPreparation) {
  const p = parseWalrusBatchPreparation(input)
  return walrusBatchCanonicalJson({ ...p, payloads: p.payloads.map(bytes => toBase64(bytes)) })
}
/** Staging only: importing does not install a WAL, pay, unlock or authorize a
 * transaction. The parent verifies its operation and the protected material. */
export function importWalrusBatchPreparation(text: string) {
  check(typeof text === 'string' && text.length <= Math.ceil(WALRUS_BATCH_MAX_BYTES * 4 / 3) + 32 * 1024 * 1024, 'IMPORT_BUDGET')
  const value = JSON.parse(text)
  check(Array.isArray(value?.payloads) && value.payloads.length <= WALRUS_BATCH_MAX_FILES, 'IMPORT_PAYLOADS_INVALID')
  const result = parseWalrusBatchPreparation({ ...value, payloads: value.payloads.map((v: unknown) => walrusBatchBase64(v, MAX_FILE_BYTES)) })
  check(exportWalrusBatchPreparation(result) === text, 'IMPORT_NONCANONICAL')
  return result
}
function clearPrepared(file: PreparedFile) {
  file.plaintext.fill(0); file.payload.fill(0)
  if (file.encrypted) { file.encrypted.material.dek = ''; file.encrypted.material.iv = '' }
}
export async function prepareWalrusBatch(params: {
  scope: WalrusBatchScope; files: readonly BatchSoulUploadFile[]; storageEpochs: number
  client: Pick<WalrusClient, 'encodeBlob' | 'systemState' | 'reset'>
  lifetime: WalrusBatchLifetime; protector: WalrusBatchProtector | null
}): Promise<WalrusBatchPreparation> {
  const scope = parseWalrusBatchScope(params.scope), life = { ...params.lifetime }, client = params.client, protector = params.protector && { ...params.protector }
  const files = params.files.map(file => ({ ...file })), epochs = params.storageEpochs
  check(files.length <= WALRUS_BATCH_MAX_FILES && Number.isInteger(epochs) && epochs > 0 && epochs <= 0xffffffff,
    'PREPARATION_INPUT_INVALID')
  check(files.every(file => file.file instanceof File) && files.reduce((sum, file) => sum + file.file.size + 16, 0) <= WALRUS_BATCH_MAX_BYTES,
    'SOURCE_BUDGET')
  check(!files.some(file => file.uploadType === 'encrypted') || protector, 'PROTECTOR_REQUIRED')
  assertWalrusBatchLifetime(scope, life)
  // An empty Collection may reference an existing public image URL. It still
  // needs the parent's committed create journal, but no Walrus query/payment.
  if (!files.length) {
    const manifest: WalrusBatchManifest = { schema: 'soulidity.walrus-batch-manifest.v1', scope, storageEpochs: epochs, files: [] }
    return parseWalrusBatchPreparation({ schema: 'soulidity.walrus-batch-preparation.v1', manifest,
      manifestHash: walrusBatchJsonHash(manifest), payloads: [], privateRecovery: null })
  }
  client.reset()
  const system = await walrusBatchStep(scope, life, () => client.systemState())
  const nShards = system.committee.n_shards, epoch = system.committee.epoch
  const manifest: WalrusBatchManifest = { schema: 'soulidity.walrus-batch-manifest.v1', scope, storageEpochs: epochs, files: [] }
  const payloads: Uint8Array[] = [], secrets: Array<{ index: number; material: PendingSealMaterial }> = []
  let rawSecrets: Uint8Array | undefined
  try {
    for (const [index, item] of files.entries()) {
      const base = await walrusBatchStep(scope, life, () => readAndHashUploadFile(item), value => value.plaintext.fill(0))
      let prepared: PreparedFile | undefined
      try {
        prepared = await walrusBatchStep(scope, life, () => preparePayload(item, index, base), clearPrepared)
        const encoded = await walrusBatchStep(scope, life, () => client.encodeBlob(new Uint8Array(prepared!.payload)))
        const bytes = new Uint8Array(prepared.payload)
        payloads.push(bytes)
        manifest.files.push({ index, recipient: item.sendObjectTo?.trim() || scope.owner, kind: item.kind, uploadType: item.uploadType,
          fileName: prepared.normalizedFile.name || 'bundle', mimeType: prepared.contentType,
          plaintextByteLength: prepared.plaintext.length, payloadByteLength: bytes.length,
          contentHash: prepared.contentHash, payloadHash: walrusBatchHash(bytes), skillName: prepared.skillBundleMetadata?.skillName ?? null,
          encoding: { blobId: encoded.blobId, rootHash: toBase64(encoded.rootHash), encodingType: 'RS2', nShards } })
        check(Number(encoded.metadata.V1.unencoded_length) === bytes.length
          && (encoded.metadata.V1.encoding_type === 'RS2' || typeof encoded.metadata.V1.encoding_type === 'object'
            && 'RS2' in encoded.metadata.V1.encoding_type), 'SDK_ENCODING_MISMATCH')
        if (prepared.encrypted) secrets.push({ index, material: { ...prepared.encrypted.material } })
      } finally { base.plaintext.fill(0); if (prepared) clearPrepared(prepared) }
    }
    client.reset()
    const current = await walrusBatchStep(scope, life, () => client.systemState())
    check(current.committee.epoch === epoch && current.committee.n_shards === nShards, 'COMMITTEE_CHANGED_BEFORE_PAYMENT')
    const validated = parseWalrusBatchManifest(manifest), manifestHash = walrusBatchJsonHash(validated)
    let privateRecovery: WalrusBatchProtection | null = null
    if (secrets.length) {
      rawSecrets = utf8.encode(JSON.stringify({ schema: 'soulidity.walrus-batch-private.v1', manifestHash, materials: secrets }))
      const callbackInput = new Uint8Array(rawSecrets)
      try {
        const wrapped = await walrusBatchStep(scope, life, signal => protector!.protect({ manifest: structuredClone(validated),
          contextHash: manifestHash, plaintext: callbackInput, signal }), value => value.fill(0))
        try { privateRecovery = { contextHash: manifestHash, encrypted: toBase64(wrapped) } } finally { wrapped.fill(0) }
      } finally { callbackInput.fill(0) }
      await walrusBatchStep(scope, life, signal => protector!.verify({ manifest: structuredClone(validated), protection: { ...privateRecovery! }, signal }))
    }
    const result = parseWalrusBatchPreparation({ schema: 'soulidity.walrus-batch-preparation.v1', manifest: validated, manifestHash, payloads, privateRecovery })
    return result
  } finally {
    rawSecrets?.fill(0)
    for (const entry of secrets) { entry.material.dek = ''; entry.material.iv = '' }
    // parse returns independent buffers. Keep no second durable-source copy.
    for (const bytes of payloads) bytes.fill(0)
  }
}
/** Caller performs one explicit Seal unlock. The returned keys are transient;
 * decoding never re-encrypts payloads and cannot authorize payment or minting. */
export async function unlockWalrusBatchMaterials(params: {
  preparation: WalrusBatchPreparation; lifetime: WalrusBatchLifetime
  unlock: (input: { manifest: WalrusBatchManifest; protection: WalrusBatchProtection; signal: AbortSignal }) => Promise<Uint8Array>
}): Promise<Array<{ index: number; material: PendingSealMaterial }>> {
  const p = parseWalrusBatchPreparation(params.preparation), scope = p.manifest.scope, life = { ...params.lifetime }, unlock = params.unlock
  check(p.privateRecovery, 'NO_PRIVATE_MATERIAL')
  const raw = await walrusBatchStep(scope, life, signal => unlock({ manifest: structuredClone(p.manifest), protection: { ...p.privateRecovery! }, signal }), value => value.fill(0))
  const result: Array<{ index: number; material: PendingSealMaterial }> = []
  try {
    check(raw.length <= 4 * 1024 * 1024, 'PRIVATE_MATERIAL_BUDGET')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw), value = JSON.parse(text)
    walrusBatchKeys(value, ['schema', 'manifestHash', 'materials'])
    const expected = p.manifest.files.filter(file => file.uploadType === 'encrypted')
    check(text === JSON.stringify(value) && value.schema === 'soulidity.walrus-batch-private.v1' && value.manifestHash === p.manifestHash
      && Array.isArray(value.materials) && value.materials.length === expected.length, 'PRIVATE_MATERIAL_BINDING')
    for (const [position, entry] of (value.materials as Array<{ index: number; material: PendingSealMaterial }>).entries()) {
      walrusBatchKeys(entry, ['index', 'material'])
      const file = expected[position], m = entry.material
      walrusBatchKeys(m, ['version', 'dek', 'iv', 'contentHash', 'mimeType', 'fileName'])
      check(entry.index === file.index && m.version === 1 && m.contentHash === file.contentHash && m.mimeType === file.mimeType
        && m.fileName === file.fileName, 'PRIVATE_FILE_BINDING')
      let dek: Uint8Array | undefined, iv: Uint8Array | undefined, plaintext: Uint8Array | undefined
      try {
        dek = walrusBatchBase64(m.dek, 32); iv = walrusBatchBase64(m.iv, 12)
        check(dek.length === 32 && iv.length === 12, 'PRIVATE_KEY_INVALID')
        const key = await walrusBatchStep(scope, life, () => crypto.subtle.importKey('raw', new Uint8Array(dek!), 'AES-GCM', false, ['decrypt']))
        plaintext = await walrusBatchStep(scope, life, async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv!) }, key,
          new Uint8Array(p.payloads[file.index]))), value => value.fill(0))
        check(plaintext.length === file.plaintextByteLength && walrusBatchHash(plaintext) === file.contentHash, 'PRIVATE_SOURCE_MISMATCH')
        result.push({ index: entry.index, material: { ...m } })
      } finally { dek?.fill(0); iv?.fill(0); plaintext?.fill(0) }
    }
    return result
  } catch (error) {
    for (const entry of result) { entry.material.dek = ''; entry.material.iv = '' }
    throw error
  } finally { raw.fill(0); p.payloads.forEach(bytes => bytes.fill(0)) }
}
