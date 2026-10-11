/**
 * Phase 2 Seal document-id construction. Mirrors the layout enforced by
 * `assert_matching_document_id` in `move/soulidity/sources/content.move`:
 *
 *   13 bytes domain "soul-content:"
 * + 1 byte  DOCUMENT_ID_VERSION (0x01)
 * + 4 bytes kind (u32 BE)
 * + 32 bytes content_object_id
 * + name UTF-8 bytes (variable)
 * + 1 byte  separator 0x00
 * + 8 bytes version_index (u64 BE)
 * + 16 bytes nonce
 *
 * Total: 75 + name_len bytes.
 */

const DOMAIN = 'soul-content:'
const DOMAIN_BYTES = new TextEncoder().encode(DOMAIN)
const DOCUMENT_ID_VERSION = 0x01
const CONTENT_OBJECT_ID_BYTES = 32
const KIND_BYTES = 4
const VERSION_INDEX_BYTES = 8
const NONCE_BYTES = 16

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value
}

function hexToBytes(value: string): Uint8Array {
  const hex = stripHexPrefix(value)
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid hex string')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function u32ToBigEndian(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('u32 value out of range')
  }
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function u64ToBigEndian(value: number | bigint): Uint8Array {
  let remaining = typeof value === 'bigint' ? value : BigInt(value)
  if (remaining < 0n) {
    throw new Error('u64 value cannot be negative')
  }
  const bytes = new Uint8Array(VERSION_INDEX_BYTES)
  for (let index = VERSION_INDEX_BYTES - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
}

function getCryptoOrThrow(): Crypto {
  const cryptoInstance = globalThis.crypto
  if (!cryptoInstance?.getRandomValues) {
    throw new Error('Web Crypto is not available in this runtime')
  }
  return cryptoInstance
}

export interface GenerateContentDocumentIdParams {
  contentObjectId: string
  kind: number
  name: string
  versionIndex: number | bigint
  /** Optional 16-byte nonce. Random when omitted. */
  nonce?: Uint8Array
}

export type ContentDocumentVersionParams = Omit<GenerateContentDocumentIdParams, 'nonce'>

function bytesEqualAt(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset + expected.length > bytes.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false
  }
  return true
}

/**
 * Build a Phase 2 content document id (raw bytes) matching the Move
 * `assert_matching_document_id` layout.
 */
export function generateContentDocumentIdBytes(
  params: GenerateContentDocumentIdParams,
): Uint8Array {
  const contentIdBytes = hexToBytes(params.contentObjectId)
  if (contentIdBytes.length !== CONTENT_OBJECT_ID_BYTES) {
    throw new Error(`content object id must be ${CONTENT_OBJECT_ID_BYTES} bytes`)
  }
  const nameBytes = new TextEncoder().encode(params.name)
  const nonce = params.nonce ?? getCryptoOrThrow().getRandomValues(new Uint8Array(NONCE_BYTES))
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`content document id nonce must be ${NONCE_BYTES} bytes`)
  }

  const out = new Uint8Array(
    DOMAIN_BYTES.length
    + 1
    + KIND_BYTES
    + CONTENT_OBJECT_ID_BYTES
    + nameBytes.length
    + 1
    + VERSION_INDEX_BYTES
    + NONCE_BYTES,
  )
  let offset = 0
  out.set(DOMAIN_BYTES, offset)
  offset += DOMAIN_BYTES.length
  out[offset++] = DOCUMENT_ID_VERSION
  out.set(u32ToBigEndian(params.kind), offset)
  offset += KIND_BYTES
  out.set(contentIdBytes, offset)
  offset += CONTENT_OBJECT_ID_BYTES
  out.set(nameBytes, offset)
  offset += nameBytes.length
  out[offset++] = 0x00
  out.set(u64ToBigEndian(params.versionIndex), offset)
  offset += VERSION_INDEX_BYTES
  out.set(nonce, offset)
  return out
}

/**
 * Hex-encoded variant. Returns `0x...`. Equivalent to
 * `bytesToHex(generateContentDocumentIdBytes(...))`.
 */
export function generateContentDocumentIdHex(
  params: GenerateContentDocumentIdParams,
): string {
  return bytesToHex(generateContentDocumentIdBytes(params))
}

export function isValidContentDocumentId(value: string): boolean {
  let bytes: Uint8Array
  try {
    bytes = hexToBytes(value)
  } catch {
    return false
  }
  // Minimum length: 13 + 1 + 4 + 32 + 0 (empty name) + 1 + 8 + 16 = 75
  const minLength = DOMAIN_BYTES.length + 1 + KIND_BYTES + CONTENT_OBJECT_ID_BYTES + 1 + VERSION_INDEX_BYTES + NONCE_BYTES
  if (bytes.length < minLength) return false
  for (let i = 0; i < DOMAIN_BYTES.length; i += 1) {
    if (bytes[i] !== DOMAIN_BYTES[i]) return false
  }
  if (bytes[DOMAIN_BYTES.length] !== DOCUMENT_ID_VERSION) return false
  return true
}

export function isContentDocumentIdForVersion(
  value: string,
  params: ContentDocumentVersionParams,
): boolean {
  let bytes: Uint8Array
  let contentIdBytes: Uint8Array
  let kindBytes: Uint8Array
  let versionIndexBytes: Uint8Array
  try {
    bytes = hexToBytes(value)
    contentIdBytes = hexToBytes(params.contentObjectId)
    kindBytes = u32ToBigEndian(params.kind)
    versionIndexBytes = u64ToBigEndian(params.versionIndex)
  } catch {
    return false
  }
  if (contentIdBytes.length !== CONTENT_OBJECT_ID_BYTES) return false

  const nameBytes = new TextEncoder().encode(params.name)
  const expectedLength = DOMAIN_BYTES.length
    + 1
    + KIND_BYTES
    + CONTENT_OBJECT_ID_BYTES
    + nameBytes.length
    + 1
    + VERSION_INDEX_BYTES
    + NONCE_BYTES
  if (bytes.length !== expectedLength) return false

  let offset = 0
  if (!bytesEqualAt(bytes, offset, DOMAIN_BYTES)) return false
  offset += DOMAIN_BYTES.length
  if (bytes[offset++] !== DOCUMENT_ID_VERSION) return false
  if (!bytesEqualAt(bytes, offset, kindBytes)) return false
  offset += KIND_BYTES
  if (!bytesEqualAt(bytes, offset, contentIdBytes)) return false
  offset += CONTENT_OBJECT_ID_BYTES
  if (!bytesEqualAt(bytes, offset, nameBytes)) return false
  offset += nameBytes.length
  if (bytes[offset++] !== 0x00) return false
  if (!bytesEqualAt(bytes, offset, versionIndexBytes)) return false
  return true
}
