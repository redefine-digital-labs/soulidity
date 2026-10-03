import { EncryptedObject, SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { buildAnimacraftNativeCompleteApprovalV8, getBlobUrl } from '@soulidity/sdk'
import type { NativeCompleteReadTarget } from './native-complete-read-types'
import { assertNativeSealEncryptionProfile } from './native-seal-profile'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'

const MAX_CIPHERTEXT = 16 * 1024 * 1024
const MAX_PLAINTEXT = 12 * 1024 * 1024
export type NativeSealReadTarget = Pick<NativeCompleteReadTarget, 'owner' | 'release' | 'ciphertext' | 'policy'>
export interface NativeSealReadParams {
  soulId: string; owner: string; client: SealCompatibleClient; signal: AbortSignal
  getAddress: () => string | null
  signPersonalMessage: (message: Uint8Array) => Promise<string>
  read: () => Promise<unknown>
  onPhase?: (phase: 'verifying' | 'authorizing' | 'decrypting') => void
  fetcher?: typeof fetch
}
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])
const hash = async (bytes: Uint8Array) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/** Keep stalled transports/decoders observed, without publishing a late result. */
export async function completeReadStep<T>(signal: AbortSignal, run: () => Promise<T>, discard?: (value: T) => void): Promise<T> {
  signal.throwIfAborted()
  let cancel: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
  })
  try {
    return await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted(); return run()
    }).then(value => {
      if (signal.aborted) { discard?.(value); signal.throwIfAborted() }
      return value
    }), aborted])
  } finally { signal.removeEventListener('abort', cancel) }
}

export function assertNativeCompleteReadTarget(value: unknown, soulId: string, owner: string): NativeCompleteReadTarget {
  const v = structuredClone(value) as NativeCompleteReadTarget
  check(v?.schema === 'native-complete-read-v1' && v.soulId === soulId && v.owner === owner,
    'The connected wallet is not the current owner of this completed artwork.')
  for (const key of ['soulId', 'stateId', 'owner', 'bindingId', 'outputId', 'receiptId', 'rootId',
    'protocolConfigId', 'catalogId', 'releaseConfigId', 'sealRegistryId', 'sealPolicyId'] as const) {
    check(id(v[key]), 'Invalid protected artwork target.')
  }
  check(/^(0|[1-9][0-9]*)$/.test(v.ownershipEpoch) && BigInt(v.ownershipEpoch) <= 18446744073709551615n
    && id(v.release?.originalPackageId) && id(v.release?.callablePackageId), 'Invalid protected artwork release.')
  assertNativeSealReadMetadata(v)
  // Validate the full ABI before any download or wallet interaction.
  approval(v)
  return v
}

/** Shared browser-only envelope policy; raw chain evidence and Seal's live
 * approval checks retain authority over the current read. */
export function assertNativeSealReadMetadata(v: NativeSealReadTarget) {
  check(id(v.release?.originalPackageId) && id(v.release?.callablePackageId)
    && typeof v.release?.callableDigest === 'string'
    && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.release.callableDigest)
    && fromBase58(v.release.callableDigest).length === 32
    && toBase58(fromBase58(v.release.callableDigest)) === v.release.callableDigest,
  'Invalid protected artwork release digest.')
  const c = v.ciphertext; const p = v.policy
  assertNativeSealEncryptionProfile(p)
  check(c && /^[A-Za-z0-9_-]{43}$/.test(c.blobId) && /^[0-9a-f]{64}$/.test(c.sha256)
    && Array.isArray(c.sealId) && c.sealId.length === 32
    && c.sealId.every(b => Number.isInteger(b) && b >= 0 && b <= 255)
    && typeof c.aadBase64 === 'string' && c.aadBase64.length > 0 && c.aadBase64.length < 8192
    && toBase64(fromBase64(c.aadBase64)) === c.aadBase64, 'Invalid protected artwork identity.')
  check(toBase64(fromBase64(c.blobId.replaceAll('-', '+').replaceAll('_', '/') + '='))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === c.blobId, 'Invalid protected Blob ID.')
  check(p && Number.isSafeInteger(p.threshold) && p.threshold > 0 && p.threshold < 255
    && Number.isSafeInteger(p.maxPlaintextBytes) && p.maxPlaintextBytes > 0 && p.maxPlaintextBytes <= MAX_PLAINTEXT
    && Array.isArray(p.keyServers) && p.keyServers.length > 0 && p.keyServers.length < 255,
  'Invalid protected artwork key policy.')
  const seen = new Set<string>(); let weight = 0
  for (const row of p.keyServers) {
    check(id(row.objectId) && !seen.has(row.objectId) && Number.isInteger(row.weight) && row.weight > 0 && row.weight < 255,
      'Invalid protected artwork key server.')
    seen.add(row.objectId); weight += row.weight
    if (row.aggregatorUrl !== undefined) {
      const url = new URL(row.aggregatorUrl)
      check(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search,
        'Invalid protected artwork key server endpoint.')
    }
  }
  check(weight < 255 && weight >= p.threshold, 'Invalid protected artwork threshold.')
}

function approval(v: NativeCompleteReadTarget) {
  return buildAnimacraftNativeCompleteApprovalV8({ releaseCallablePackageId: v.release.callablePackageId,
    signer: v.owner, soulStateId: v.stateId, provenanceBindingId: v.bindingId, completeOutputId: v.outputId,
    receiptId: v.receiptId, makerRootId: v.rootId, protocolConfigId: v.protocolConfigId, catalogId: v.catalogId,
    releaseConfigId: v.releaseConfigId, sealRegistryId: v.sealRegistryId, sealPolicyId: v.sealPolicyId,
    paymentCoinType: v.paymentCoinType, sealId: v.ciphertext.sealId })
}

/** Verify the actual committed Seal bytes before asking the wallet for access. */
export async function assertNativeCompleteCiphertext(bytes: Uint8Array, v: NativeCompleteReadTarget) {
  return assertNativeSealCiphertext(bytes, v, 33, MAX_PLAINTEXT)
}

export async function assertNativeSealCiphertext(bytes: Uint8Array, v: NativeSealReadTarget,
  minimumPlaintextBytes: number, maximumPlaintextBytes: number) {
  check(bytes.length > 0 && bytes.length <= MAX_CIPHERTEXT && await hash(bytes) === v.ciphertext.sha256,
    'Protected artwork ciphertext hash mismatch.')
  const parsed = EncryptedObject.parse(bytes)
  assertNativeSealEncryptionProfile(v.policy)
  const payload = parsed.ciphertext.$kind === 'Aes256Gcm' ? parsed.ciphertext.Aes256Gcm : null
  const aad = fromBase64(v.ciphertext.aadBase64)
  check(equal(bytes, EncryptedObject.serialize(parsed).toBytes()) && parsed.version === 0
    && parsed.packageId === v.release.originalPackageId && parsed.id === toHex(new Uint8Array(v.ciphertext.sealId))
    && await hash(aad) === parsed.id && payload?.aad && equal(payload.aad, aad)
    && parsed.threshold === v.policy.threshold, 'Protected artwork Seal identity or format mismatch.')
  const counts = new Map<string, number>(); const indices = new Set<number>()
  for (const [service, index] of parsed.services) {
    check(index > 0 && index <= parsed.services.length && !indices.has(index), 'Protected artwork share indices are invalid.')
    indices.add(index); counts.set(service, (counts.get(service) ?? 0) + 1)
  }
  check(counts.size === v.policy.keyServers.length
    && v.policy.keyServers.every(row => counts.get(row.objectId) === row.weight),
  'Protected artwork key servers differ from the committed policy.')
  check(parsed.encryptedShares.$kind === 'BonehFranklinBLS12381'
    && parsed.encryptedShares.BonehFranklinBLS12381.encryptedShares.length === parsed.services.length,
  'Protected artwork encrypted shares are incomplete.')
  check(payload.blob.length >= 16 + minimumPlaintextBytes
    && payload.blob.length <= Math.min(v.policy.maxPlaintextBytes, maximumPlaintextBytes) + 16,
    'Protected artwork plaintext size does not match its policy.')
}

async function download(v: NativeSealReadTarget, signal: AbortSignal, fetcher: typeof fetch) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  const response = await completeReadStep(deadline, () => fetcher(getBlobUrl(v.ciphertext.blobId), {
    signal: deadline, credentials: 'omit', redirect: 'error', cache: 'no-store',
  }))
  check(response.ok && response.body, 'Protected artwork storage is unavailable. Please retry.')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_CIPHERTEXT)) {
    void response.body.cancel().catch(() => {}); throw new Error('Protected artwork exceeds its download limit.')
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  try {
    for (;;) {
      const row = await completeReadStep(deadline, () => reader.read())
      if (row.done) break
      total += row.value.length
      check(total <= MAX_CIPHERTEXT, 'Protected artwork exceeds its download limit.'); chunks.push(row.value)
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  check(declared === null || Number(declared) === total, 'Protected artwork download was incomplete.')
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

function assertPng(bytes: Uint8Array, limit: number) {
  check(bytes.length >= 33 && bytes.length <= limit
    && equal(bytes.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'Decrypted artwork is not a valid PNG.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  check(view.getUint32(8) === 13 && equal(bytes.subarray(12, 16), new TextEncoder().encode('IHDR'))
    && view.getUint32(16) > 0 && view.getUint32(16) <= 8192 && view.getUint32(20) > 0 && view.getUint32(20) <= 8192,
  'Decrypted artwork dimensions are invalid.')
}

/** One explicit read action. No transaction signing/broadcast, storage, key cache
 * or native sidecar DEK format. Fresh client/session per attempt; direct Seal PNG. */
export async function decryptNativeCompleteArtwork(params: NativeSealReadParams) {
  const { bytes } = await decryptNativeSealBytes(params, {
    validateTarget: value => assertNativeCompleteReadTarget(value, params.soulId, params.owner),
    buildApproval: approval, minimumPlaintextBytes: 33, maximumPlaintextBytes: MAX_PLAINTEXT,
    validatePlaintext: (bytes, target) => assertPng(bytes, target.policy.maxPlaintextBytes),
  })
  try {
    params.signal.throwIfAborted()
    check(params.getAddress() === params.owner, 'The wallet changed. Reopen the artwork with the current wallet.')
    return new Blob([new Uint8Array(bytes)], { type: 'image/png' })
  }
  finally { bytes.fill(0) }
}

/** One shared, cancellable Seal operation. Successful raw bytes become the
 * caller's responsibility; every failed/cancelled/late plaintext is zeroed. */
export async function decryptNativeSealBytes<T extends NativeSealReadTarget>(params: NativeSealReadParams, options: {
  validateTarget: (value: unknown) => T
  buildApproval: (target: T) => ReturnType<typeof buildAnimacraftNativeCompleteApprovalV8>
  minimumPlaintextBytes: number
  maximumPlaintextBytes: number
  validatePlaintext?: (bytes: Uint8Array, target: T) => void
  ciphertextBytes?: Uint8Array
}): Promise<{ target: T; bytes: Uint8Array }> {
  // The renderer may already have fetched the exact committed ciphertext.
  // Snapshot it before awaiting; it still passes the complete envelope gate.
  const suppliedCiphertext = options.ciphertextBytes === undefined ? undefined : new Uint8Array(options.ciphertextBytes)
  const { signal } = params
  const guard = () => { signal.throwIfAborted(); check(params.getAddress() === params.owner,
    'The wallet changed. Reopen the artwork with the current wallet.') }
  const step = async <T>(run: () => Promise<T>, discard?: (value: T) => void) => {
    guard(); const value = await completeReadStep(signal, run, discard)
    try { guard(); return value } catch (error) { discard?.(value); throw error }
  }
  const read = async () => {
    check((await step(() => params.client.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST,
      'Switch to the verified mainnet connection before opening this artwork.')
    return options.validateTarget(await step(params.read))
  }
  params.onPhase?.('verifying'); const target = await read()
  const bytes = suppliedCiphertext ?? await step(() => download(target, signal, params.fetcher ?? fetch))
  await step(() => assertNativeSealCiphertext(bytes, target, options.minimumPlaintextBytes, options.maximumPlaintextBytes))
  const seal = new SealClient({ suiClient: params.client,
    serverConfigs: target.policy.keyServers.map(row => ({ objectId: row.objectId, weight: row.weight,
      ...(row.aggregatorUrl ? { aggregatorUrl: row.aggregatorUrl } : {}) })), verifyKeyServers: true, timeout: 10000 })
  // Detect unusable service configuration before prompting the user.
  await step(() => seal.getKeyServers())
  const txBytes = await step(() => options.buildApproval(target).build({ client: params.client, onlyTransactionKind: true }))
  const unchanged = async () => check(JSON.stringify(await read()) === JSON.stringify(target),
    'Artwork ownership or release policy changed. Please retry.')
  const session = await step(() => SessionKey.create({ address: params.owner,
    packageId: target.release.originalPackageId, ttlMin: 10, suiClient: params.client }))
  await unchanged(); guard(); params.onPhase?.('authorizing')
  const signature = await step(() => params.signPersonalMessage(session.getPersonalMessage()))
  await step(() => session.setPersonalMessageSignature(signature))
  await unchanged(); guard(); params.onPhase?.('decrypting')
  const plaintext = await step(() => seal.decrypt({ data: bytes, sessionKey: session, txBytes,
    checkShareConsistency: true }), bytes => bytes.fill(0))
  try {
    check(plaintext.length >= options.minimumPlaintextBytes
      && plaintext.length <= Math.min(target.policy.maxPlaintextBytes, options.maximumPlaintextBytes),
    'Protected artwork plaintext size does not match its policy.')
    options.validatePlaintext?.(plaintext, target)
    await unchanged(); guard()
    return { target, bytes: plaintext }
  } catch (error) { plaintext.fill(0); throw error }
}
