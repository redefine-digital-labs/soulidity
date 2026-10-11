import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import { isContentDocumentIdForVersion, type SealEnvelopeSidecar } from '@soulidity/sdk'
import { assertSealEnvelopePackageId, parseSealEnvelopeSidecar } from '@/lib/services/seal-crypto'

export const CONTENT_ENVELOPE_SCHEMA = 'soulidity.content-envelope.v1'
export const CONTENT_ENVELOPE_MAX_BYTES = 64 * 1024
export interface ContentEnvelopeSlot {
  contentObjectId: string; kind: number; name: string; versionIndex: string; blobObjectId: string
}
export interface ContentEnvelope extends ContentEnvelopeSlot {
  schema: typeof CONTENT_ENVELOPE_SCHEMA
  sidecar: SealEnvelopeSidecar & { sealPackageId: string }
}
const utf8 = new TextEncoder()
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
function check(value: unknown): asserts value { if (!value) throw new Error('CONTENT_ENVELOPE_INVALID') }
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)))
}
const SlotKey = bcs.struct('ContentEnvelopeKeyV1', {
  content: bcs.Address, kind: bcs.u32(), name: bcs.string(), version: bcs.u64(),
})
function slot(input: ContentEnvelopeSlot): ContentEnvelopeSlot {
  check(id(input.contentObjectId) && id(input.blobObjectId) && Number.isInteger(input.kind)
    && input.kind >= 0 && input.kind <= 0xffffffff && typeof input.name === 'string' && input.name.length > 0
    && new TextDecoder('utf-8', { fatal: true }).decode(utf8.encode(input.name)) === input.name
    && typeof input.versionIndex === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(input.versionIndex)
    && BigInt(input.versionIndex) <= 18446744073709551615n)
  return { contentObjectId: input.contentObjectId, kind: input.kind, name: input.name,
    versionIndex: input.versionIndex, blobObjectId: input.blobObjectId }
}

/** Deterministic per-version key; BCS framing prevents delimiter/Unicode aliases.
 * The value also carries the full tuple. This key never authorizes decryption. */
export function contentEnvelopeKey(input: ContentEnvelopeSlot): string {
  const value = slot(input)
  return 'content_seal_envelope_v1:' + toHex(sha256(SlotKey.serialize({
    content: value.contentObjectId, kind: value.kind, name: value.name, version: value.versionIndex,
  }).toBytes()))
}

/** Public encrypted envelope only. Reject unknown fields BEFORE serialization,
 * including raw recovery keys; bind the embedded Seal object to the exact slot. */
export function encodeContentEnvelope(input: ContentEnvelope, originalPackageId: string): string {
  keys(input, ['schema', 'contentObjectId', 'kind', 'name', 'versionIndex', 'blobObjectId', 'sidecar'])
  check(input.schema === CONTENT_ENVELOPE_SCHEMA && id(originalPackageId))
  const identity = slot(input)
  keys(input.sidecar, ['version', 'mode', 'sealPackageId', 'documentId', 'encryptedDek', 'iv', 'cipher', 'mimeType', 'fileName', 'contentHash'])
  const sidecar = parseSealEnvelopeSidecar(input.sidecar)
  check(sidecar.sealPackageId === originalPackageId && isContentDocumentIdForVersion(sidecar.documentId, {
    contentObjectId: identity.contentObjectId, kind: identity.kind, name: identity.name, versionIndex: BigInt(identity.versionIndex),
  }))
  assertSealEnvelopePackageId(sidecar, originalPackageId)
  const value = JSON.stringify({ schema: CONTENT_ENVELOPE_SCHEMA, ...identity, sidecar })
  check(utf8.encode(value).length <= CONTENT_ENVELOPE_MAX_BYTES)
  return value
}

export function decodeContentEnvelope(text: string, expected: ContentEnvelopeSlot, originalPackageId: string): ContentEnvelope {
  check(typeof text === 'string' && utf8.encode(text).length <= CONTENT_ENVELOPE_MAX_BYTES)
  const value = JSON.parse(text) as ContentEnvelope
  check(encodeContentEnvelope(value, originalPackageId) === text
    && JSON.stringify(slot(value)) === JSON.stringify(slot(expected)))
  return value
}
