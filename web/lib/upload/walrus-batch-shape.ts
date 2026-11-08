import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blobIdFromInt, blobIdToInt } from '@mysten/walrus'
import type { SoulUploadKind, SoulUploadType } from './client-upload'

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
  schema: 'soulidity.walrus-batch-manifest.v1' | 'soulidity.walrus-batch-manifest.v2'
  /** V2 explicitly commits permanent Blob storage; V1 remains deletable. */
  deletable?: false
  scope: WalrusBatchScope
  storageEpochs: number
  files: WalrusBatchFileManifest[]
}
export function walrusBatchDeletable(manifest: WalrusBatchManifest): boolean {
  if (manifest.schema === 'soulidity.walrus-batch-manifest.v1') {
    check(!Object.hasOwn(manifest, 'deletable'), 'PERSISTENCE_INVALID'); return true
  }
  check(manifest.schema === 'soulidity.walrus-batch-manifest.v2' && manifest.deletable === false, 'PERSISTENCE_INVALID')
  return false
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
  walrusBatchKeys(m, ['schema', 'scope', 'storageEpochs', 'files', ...(m.schema === 'soulidity.walrus-batch-manifest.v2' ? ['deletable'] : [])])
  check((m.schema === 'soulidity.walrus-batch-manifest.v1' || m.schema === 'soulidity.walrus-batch-manifest.v2' && m.deletable === false) && Number.isInteger(m.storageEpochs)
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
