import { EncryptedObject, type SealClient } from '@mysten/seal'
import { bcs } from '@mysten/sui/bcs'
import { toHex } from '@mysten/sui/utils'
import { derivePrivateNamedLoadoutSealId } from '@soulidity/sdk'
import { assertNativeSealEncryptionProfile } from './native-seal-profile'
import { completeReadStep } from './native-complete-read-client'
import type { NativeCompleteReadTarget } from './native-complete-read-types'
import { PRIVATE_LOADOUT_MAX_BYTES, decodePrivateLoadoutLibrary, encodePrivateLoadoutLibrary, privateLoadoutCanonical,
  privateLoadoutCheck as check, privateLoadoutHash, privateLoadoutId, privateLoadoutU64, validatePrivateLoadoutScope,
  type PrivateLoadoutLibrary, type PrivateLoadoutScope } from './private-loadout-library'

export type PrivateLoadoutSealPolicy = NativeCompleteReadTarget['policy']
export interface PrivateLoadoutCryptoContext {
  scope: PrivateLoadoutScope; revision: string; requestId: string; originalPackageId: string
}
const MAX_ENVELOPE = 16 * 1024 * 1024, MAX_WRAPPED_KEY = 128 * 1024
const V = bcs.vector(bcs.u8())
export const PrivateLoadoutEnvelopeBcs = bcs.struct('PrivateLoadoutEnvelopeV1', {
  version: bcs.u8(), aad: V, wrapped_dek: V, iv: V, ciphertext: V,
})
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
const copy = (bytes: Uint8Array) => new Uint8Array(bytes)
export function privateLoadoutCryptoContext(value: PrivateLoadoutCryptoContext) {
  const v = structuredClone(value)
  check(v && Object.keys(v).length === 4 && ['scope', 'revision', 'requestId', 'originalPackageId'].every(k => Object.hasOwn(v, k))
    && privateLoadoutU64(v.revision) && v.revision !== '0' && privateLoadoutHash(v.requestId) && privateLoadoutId(v.originalPackageId),
  'PRIVATE_LOADOUT_CRYPTO_CONTEXT_INVALID')
  v.scope = validatePrivateLoadoutScope(v.scope)
  return v
}
export function privateLoadoutAad(context: PrivateLoadoutCryptoContext) {
  return new TextEncoder().encode(privateLoadoutCanonical({ domain: 'soulidity/private-named-loadouts/aes-gcm/v1', schema: 1,
    ...privateLoadoutCryptoContext(context) }))
}
export function validatePrivateLoadoutSealPolicy(input: PrivateLoadoutSealPolicy) {
  const p = structuredClone(input); assertNativeSealEncryptionProfile(p)
  check(Object.keys(p).length === 6 && ['threshold', 'maxPlaintextBytes', 'keyServers', 'cipherSuite', 'keyDerivation', 'ciphertextFormat'].every(k => Object.hasOwn(p, k))
    && Number.isInteger(p.threshold) && p.threshold > 0 && p.threshold < 255
    && Number.isSafeInteger(p.maxPlaintextBytes) && p.maxPlaintextBytes >= 32 && p.maxPlaintextBytes <= 12 * 1024 * 1024
    && Array.isArray(p.keyServers) && p.keyServers.length > 0 && p.keyServers.length < 255, 'PRIVATE_LOADOUT_SEAL_POLICY_INVALID')
  let total = 0; const seen = new Set<string>()
  for (const row of p.keyServers) {
    check(row && Object.keys(row).every(k => ['objectId', 'weight', 'aggregatorUrl'].includes(k)) && privateLoadoutId(row.objectId)
      && !seen.has(row.objectId) && Number.isInteger(row.weight) && row.weight > 0 && row.weight < 255, 'PRIVATE_LOADOUT_SEAL_SERVICES_INVALID')
    if (row.aggregatorUrl !== undefined) {
      const url = new URL(row.aggregatorUrl)
      check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'PRIVATE_LOADOUT_SEAL_ENDPOINT_INVALID')
    }
    seen.add(row.objectId); total += row.weight
  }
  check(total < 255 && total >= p.threshold, 'PRIVATE_LOADOUT_SEAL_THRESHOLD_INVALID')
  return p
}
/** This is a 32-byte DEK wrapper, never the whole library. The component policy's
 * plaintext bound applies to that key, not to the 8 MiB private document. */
export async function assertPrivateLoadoutWrappedKey(bytes: Uint8Array, context: PrivateLoadoutCryptoContext, policy: PrivateLoadoutSealPolicy) {
  const c = privateLoadoutCryptoContext(context), p = validatePrivateLoadoutSealPolicy(policy), input = copy(bytes)
  check(input.length > 0 && input.length <= MAX_WRAPPED_KEY, 'PRIVATE_LOADOUT_WRAPPED_KEY_SIZE')
  const aad = privateLoadoutAad(c), sealId = await derivePrivateNamedLoadoutSealId(c.scope)
  const parsed = EncryptedObject.parse(input), payload = parsed.ciphertext.$kind === 'Aes256Gcm' ? parsed.ciphertext.Aes256Gcm : null
  check(equal(input, EncryptedObject.serialize(parsed).toBytes()) && parsed.version === 0 && parsed.packageId === c.originalPackageId
    && parsed.id === toHex(sealId) && parsed.threshold === p.threshold && payload?.aad && equal(payload.aad, aad)
    && payload.blob.length === 48, 'PRIVATE_LOADOUT_WRAPPED_KEY_IDENTITY')
  const counts = new Map<string, number>(), indices = new Set<number>()
  for (const [service, index] of parsed.services) {
    check(index > 0 && index <= parsed.services.length && !indices.has(index), 'PRIVATE_LOADOUT_SEAL_SHARE_INDEX')
    indices.add(index); counts.set(service, (counts.get(service) ?? 0) + 1)
  }
  check(counts.size === p.keyServers.length && p.keyServers.every(s => counts.get(s.objectId) === s.weight)
    && parsed.encryptedShares.$kind === 'BonehFranklinBLS12381'
    && parsed.encryptedShares.BonehFranklinBLS12381.encryptedShares.length === parsed.services.length, 'PRIVATE_LOADOUT_SEAL_SHARES_INVALID')
}
function secretStep(signal: AbortSignal) {
  return async <T>(run: () => Promise<T>, discard?: (value: T) => void): Promise<T> => {
    const value = await completeReadStep(signal, run, discard)
    try { signal.throwIfAborted(); return value } catch (error) { discard?.(value); throw error }
  }
}
/** Preflight untrusted bytes before the browser asks for a Seal session
 * signature. Decryption repeats this gate on its own captured inputs. */
export async function validatePrivateLoadoutEnvelope(params: {
  bytes: Uint8Array; context: PrivateLoadoutCryptoContext; policy: PrivateLoadoutSealPolicy
}) {
  const context = privateLoadoutCryptoContext(params.context), policy = validatePrivateLoadoutSealPolicy(params.policy), bytes = copy(params.bytes)
  check(bytes.length > 0 && bytes.length <= MAX_ENVELOPE, 'PRIVATE_LOADOUT_ENVELOPE_SIZE')
  const value = PrivateLoadoutEnvelopeBcs.parse(bytes), wrapped = new Uint8Array(value.wrapped_dek), aad = privateLoadoutAad(context)
  check(equal(bytes, PrivateLoadoutEnvelopeBcs.serialize(value, { maxSize: MAX_ENVELOPE }).toBytes()) && value.version === 1
    && equal(new Uint8Array(value.aad), aad) && value.iv.length === 12 && value.ciphertext.length > 16
    && value.ciphertext.length <= PRIVATE_LOADOUT_MAX_BYTES + 16, 'PRIVATE_LOADOUT_ENVELOPE_INVALID')
  await assertPrivateLoadoutWrappedKey(wrapped, context, policy)
  return { value, wrapped, aad }
}
/** Browser caller supplies a fresh, verified-policy SealClient and revalidates
 * actual owner/head/capture before and after. Only ciphertext leaves this helper. */
export async function encryptPrivateLoadoutLibrary(params: {
  library: PrivateLoadoutLibrary; context: PrivateLoadoutCryptoContext; policy: PrivateLoadoutSealPolicy
  seal: Pick<SealClient, 'encrypt'>; signal: AbortSignal; verify: () => Promise<void>
}) {
  const context = privateLoadoutCryptoContext(params.context), policy = validatePrivateLoadoutSealPolicy(params.policy)
  const plain = encodePrivateLoadoutLibrary(params.library), { signal, seal, verify } = params, step = secretStep(signal)
  let dek: Uint8Array<ArrayBuffer> | undefined
  try {
    check(params.library.revision === context.revision && params.library.intent?.requestId === context.requestId
      && privateLoadoutCanonical(params.library.scope) === privateLoadoutCanonical(context.scope), 'PRIVATE_LOADOUT_ENCRYPT_SCOPE_MISMATCH')
    await step(verify)
    dek = crypto.getRandomValues(new Uint8Array(32)); const iv = crypto.getRandomValues(new Uint8Array(12)), aad = privateLoadoutAad(context)
    const key = await step(() => crypto.subtle.importKey('raw', dek!, { name: 'AES-GCM' }, false, ['encrypt']))
    const ciphertext = new Uint8Array(await step(() => crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain)))
    const sealId = await step(() => derivePrivateNamedLoadoutSealId(context.scope))
    const wrapped = await step(() => seal.encrypt({ threshold: policy.threshold, packageId: context.originalPackageId,
      id: toHex(sealId), data: dek!, aad }), result => result.key.fill(0))
    wrapped.key.fill(0)
    await step(() => assertPrivateLoadoutWrappedKey(wrapped.encryptedObject, context, policy))
    const bytes = PrivateLoadoutEnvelopeBcs.serialize({ version: 1, aad, wrapped_dek: wrapped.encryptedObject, iv, ciphertext },
      { maxSize: MAX_ENVELOPE }).toBytes()
    await step(verify)
    return bytes
  } finally { plain.fill(0); dek?.fill(0) }
}
/** Raw chain reader must first prove this exact envelope's Blob/hash/head. This
 * helper does not authorize a download or infer scope from self-described bytes. */
export async function decryptPrivateLoadoutLibrary(params: {
  bytes: Uint8Array; context: PrivateLoadoutCryptoContext; policy: PrivateLoadoutSealPolicy; signal: AbortSignal
  unwrap: (wrapped: Uint8Array) => Promise<Uint8Array>; verify: () => Promise<void>
}) {
  const context = privateLoadoutCryptoContext(params.context), policy = validatePrivateLoadoutSealPolicy(params.policy)
  const bytes = copy(params.bytes), { signal, unwrap, verify } = params, step = secretStep(signal)
  const { value, wrapped, aad } = await step(() => validatePrivateLoadoutEnvelope({ bytes, context, policy }))
  await step(verify)
  const dek = await step(() => unwrap(wrapped), key => key.fill(0))
  let plaintext: Uint8Array | undefined
  let keyBytes: Uint8Array<ArrayBuffer> | undefined
  try {
    check(dek.length === 32, 'PRIVATE_LOADOUT_DEK_SIZE')
    keyBytes = copy(dek)
    const key = await step(() => crypto.subtle.importKey('raw', keyBytes!, { name: 'AES-GCM' }, false, ['decrypt']))
    plaintext = await step(async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv), additionalData: aad },
      key, new Uint8Array(value.ciphertext))), bytes => bytes.fill(0))
    const library = decodePrivateLoadoutLibrary(plaintext, context.scope, context.revision)
    check(library.intent?.requestId === context.requestId, 'PRIVATE_LOADOUT_DECRYPT_REQUEST_MISMATCH')
    await step(verify)
    return library
  } finally { dek.fill(0); keyBytes?.fill(0); plaintext?.fill(0) }
}
