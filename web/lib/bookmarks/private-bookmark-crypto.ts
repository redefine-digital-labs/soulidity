import { bcs } from '@mysten/sui/bcs'
import { toHex } from '@mysten/sui/utils'
import type { SealClient } from '@mysten/seal'
import { derivePrivateWalletBookmarksSealId } from '@soulidity/sdk'
import { profileReadStep } from '@soulidity/sdk'
import { assertBrowserContentSealObject, validateBrowserContentSealConfig, type BrowserContentSealConfig } from '../soulidity/browser-content-open'
import { PRIVATE_BOOKMARK_MAX_BYTES, bookmarkCanonical, bookmarkCheck as check, bookmarkHash, bookmarkId, bookmarkU64,
  decodePrivateBookmarkLibrary, encodePrivateBookmarkLibrary, validatePrivateBookmarkLibrary, validatePrivateBookmarkScope,
  type PrivateBookmarkLibrary, type PrivateBookmarkScope } from './private-bookmark-library'

export interface PrivateBookmarkCryptoContext {
  scope: PrivateBookmarkScope; chainIdentifier: string; originalPackageId: string; revision: string; requestId: string
}
const MAX_ENVELOPE = 16 * 1024 * 1024, MAX_WRAPPED = 256 * 1024
const V = bcs.vector(bcs.u8())
export const PrivateBookmarkEnvelopeBcs = bcs.struct('PrivateBookmarkEnvelopeV1', {
  version: bcs.u8(), aad: V, wrapped_dek: V, iv: V, ciphertext: V,
})
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i])
export function privateBookmarkCryptoContext(input: PrivateBookmarkCryptoContext): PrivateBookmarkCryptoContext {
  const value = structuredClone(input)
  check(value && Object.keys(value).length === 5 && ['scope', 'chainIdentifier', 'originalPackageId', 'revision', 'requestId'].every(key => Object.hasOwn(value, key))
    && typeof value.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(value.chainIdentifier) && bookmarkId(value.originalPackageId)
    && bookmarkU64(value.revision) && value.revision !== '0' && bookmarkHash(value.requestId), 'CRYPTO_CONTEXT_INVALID')
  value.scope = validatePrivateBookmarkScope(value.scope)
  return value
}
/** Public AAD deliberately has no Soul IDs, bookmark count, intent or plaintext
 * hash. Only domain, wallet/registry/release and random request context leave memory. */
export function privateBookmarkAad(input: PrivateBookmarkCryptoContext): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(bookmarkCanonical({ domain: 'soulidity/private-bookmarks/aes-gcm/v1', version: 1,
    ...privateBookmarkCryptoContext(input) }))
}
export async function validatePrivateBookmarkEnvelope(params: {
  bytes: Uint8Array; context: PrivateBookmarkCryptoContext; sealConfig: BrowserContentSealConfig
}) {
  const context = privateBookmarkCryptoContext(params.context), config = validateBrowserContentSealConfig(params.sealConfig)
  check(params.bytes instanceof Uint8Array && params.bytes.length > 0 && params.bytes.length <= MAX_ENVELOPE, 'ENVELOPE_SIZE')
  const bytes = new Uint8Array(params.bytes), value = PrivateBookmarkEnvelopeBcs.parse(bytes), aad = privateBookmarkAad(context)
  check(equal(PrivateBookmarkEnvelopeBcs.serialize(value, { maxSize: MAX_ENVELOPE }).toBytes(), bytes)
    && value.version === 1 && equal(new Uint8Array(value.aad), aad) && value.iv.length === 12 && value.ciphertext.length > 16
    && value.ciphertext.length <= PRIVATE_BOOKMARK_MAX_BYTES + 16 && value.wrapped_dek.length > 0 && value.wrapped_dek.length <= MAX_WRAPPED, 'ENVELOPE_INVALID')
  const wrapped = new Uint8Array(value.wrapped_dek), sealId = await derivePrivateWalletBookmarksSealId(context.scope)
  assertBrowserContentSealObject(wrapped, { packageId: context.originalPackageId, documentId: toHex(sealId),
    config, plaintextByteLength: 32, aad })
  return { value, wrapped, aad }
}
function secretStep(signal: AbortSignal) {
  return async <T>(run: () => Promise<T>, discard?: (value: T) => void): Promise<T> => {
    const value = await profileReadStep(signal, run, discard)
    try { signal.throwIfAborted(); return value } catch (error) { discard?.(value); throw error }
  }
}
/** Encryption alone is not owner consent, storage proof or a committed save.
 * Actual wallet/head/chain checks surround it in the browser controller. */
export async function encryptPrivateBookmarkLibrary(params: {
  library: PrivateBookmarkLibrary; context: PrivateBookmarkCryptoContext; sealConfig: BrowserContentSealConfig
  seal: Pick<SealClient, 'encrypt'>; signal: AbortSignal; verify: () => Promise<void>
}): Promise<Uint8Array<ArrayBuffer>> {
  const context = privateBookmarkCryptoContext(params.context), sealConfig = validateBrowserContentSealConfig(params.sealConfig)
  const library = validatePrivateBookmarkLibrary(params.library, context.scope, context.revision)
  check(library.intent?.requestId === context.requestId, 'ENCRYPT_INTENT_MISMATCH')
  const plain = encodePrivateBookmarkLibrary(library), { seal, signal, verify } = params, step = secretStep(signal)
  let dek: Uint8Array<ArrayBuffer> | undefined
  try {
    await step(verify)
    dek = crypto.getRandomValues(new Uint8Array(32))
    const iv = crypto.getRandomValues(new Uint8Array(12)), aad = privateBookmarkAad(context)
    const key = await step(() => crypto.subtle.importKey('raw', dek!, { name: 'AES-GCM' }, false, ['encrypt']))
    const ciphertext = new Uint8Array(await step(() => crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain)))
    const sealId = await step(() => derivePrivateWalletBookmarksSealId(context.scope))
    const wrapped = await step(() => seal.encrypt({ threshold: sealConfig.threshold, packageId: context.originalPackageId,
      id: toHex(sealId), data: dek!, aad }), value => value.key.fill(0))
    wrapped.key.fill(0)
    const bytes = PrivateBookmarkEnvelopeBcs.serialize({ version: 1, aad, wrapped_dek: wrapped.encryptedObject, iv, ciphertext }, { maxSize: MAX_ENVELOPE }).toBytes()
    await step(() => validatePrivateBookmarkEnvelope({ bytes, context, sealConfig }))
    await step(verify)
    return bytes
  } finally { dek?.fill(0); plain.fill(0) }
}
/** A verified head or explicitly checked orphan must supply context; never infer
 * authorization from the envelope's self-described metadata. */
export async function decryptPrivateBookmarkLibrary(params: {
  bytes: Uint8Array; context: PrivateBookmarkCryptoContext; sealConfig: BrowserContentSealConfig; signal: AbortSignal
  unwrap: (wrapped: Uint8Array) => Promise<Uint8Array>; verify: () => Promise<void>
}): Promise<PrivateBookmarkLibrary> {
  const context = privateBookmarkCryptoContext(params.context), sealConfig = validateBrowserContentSealConfig(params.sealConfig)
  check(params.bytes instanceof Uint8Array && params.bytes.length <= MAX_ENVELOPE, 'ENVELOPE_SIZE')
  const bytes = new Uint8Array(params.bytes), { signal, unwrap, verify } = params, step = secretStep(signal)
  const { value, wrapped, aad } = await step(() => validatePrivateBookmarkEnvelope({ bytes, context, sealConfig }))
  await step(verify)
  const dek = await step(() => unwrap(wrapped), key => key.fill(0))
  let keyBytes: Uint8Array<ArrayBuffer> | undefined, plain: Uint8Array | undefined
  try {
    check(dek instanceof Uint8Array && dek.length === 32, 'DEK_SIZE')
    keyBytes = new Uint8Array(dek)
    const key = await step(() => crypto.subtle.importKey('raw', keyBytes!, { name: 'AES-GCM' }, false, ['decrypt']))
    plain = await step(async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv), additionalData: aad },
      key, new Uint8Array(value.ciphertext))), bytes => bytes.fill(0))
    const library = decodePrivateBookmarkLibrary(plain, context.scope, context.revision)
    check(library.intent?.requestId === context.requestId, 'DECRYPT_INTENT_MISMATCH')
    await step(verify)
    return library
  } finally { dek.fill(0); keyBytes?.fill(0); plain?.fill(0) }
}
