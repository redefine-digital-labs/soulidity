import { EncryptedObject, SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, fromHex, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { isContentDocumentIdForVersion, profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { completeReadAggregatorUrls } from '@/lib/animacraft/native-protected-read-authority'
import { BROWSER_CONTENT_MAX_BYTES, readBrowserContentAccess, type BrowserContentAccess } from './browser-content-access'

export interface BrowserContentSealConfig {
  threshold: number; ttlMin: number
  serverConfigs: { objectId: string; weight: number; aggregatorUrl: string }[]
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const exact = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function validateBrowserContentSealConfig(input: BrowserContentSealConfig): BrowserContentSealConfig {
  const c = structuredClone(input)
  check(exact(c, ['threshold', 'ttlMin', 'serverConfigs']) && Number.isInteger(c.threshold) && c.threshold > 0 && c.threshold < 255
    && Number.isInteger(c.ttlMin) && c.ttlMin >= 1 && c.ttlMin <= 30 && Array.isArray(c.serverConfigs)
    && c.serverConfigs.length > 0 && c.serverConfigs.length <= 64, 'Content Seal configuration is invalid')
  const urls = completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify(c.serverConfigs) })
  let total = 0
  for (const server of c.serverConfigs) {
    check(exact(server, ['objectId', 'weight', 'aggregatorUrl']) && Number.isInteger(server.weight) && server.weight > 0
      && server.weight < 255 && urls.has(server.objectId), 'Explicit public content key servers are required')
    total += server.weight; server.aggregatorUrl = urls.get(server.objectId)!
  }
  check(total < 255 && total >= c.threshold, 'Content Seal threshold is invalid')
  return freeze(c)
}
export function getBrowserContentSealConfig(): BrowserContentSealConfig {
  check(process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet', 'Content reads require the configured mainnet release')
  check(process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS !== 'false', 'Content key server verification must be enabled')
  return validateBrowserContentSealConfig({ threshold: Number(process.env.NEXT_PUBLIC_SEAL_THRESHOLD),
    ttlMin: Number(process.env.NEXT_PUBLIC_SEAL_SESSION_TTL_MIN),
    serverConfigs: JSON.parse(process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS || 'null') })
}

/** Current typed-content is encrypted even for READ_PUBLIC. The chain reader
 * proves authorization and the exact envelope; public does not mean plaintext. */
export function buildBrowserContentApproval(access: BrowserContentAccess): Transaction {
  const p = access.accessPolicy, tx = new Transaction()
  check(p && p.stateObjectId === access.stateId && p.contentObjectId === access.contentId
    && p.kind === access.kind && p.name === access.name && p.versionIndex === access.versionIndex,
  'Content approval identity mismatch')
  const args = [tx.pure.vector('u8', fromHex(p.documentIdHex)), tx.object(p.stateObjectId)]
  if (p.functionName === 'seal_approve_content_paid_access') {
    check(p.moduleName === 'paid_access' && p.paidAccessListOnChainId && !p.soulGrantObjectId, 'Content paid approval is invalid')
    args.push(tx.object(p.paidAccessListOnChainId), tx.object(p.contentObjectId))
  } else {
    check(p.moduleName === 'content' && ['seal_approve_content_owner', 'seal_approve_content_granted_agent', 'seal_approve_content_public'].includes(p.functionName),
      'Content approval target is invalid')
    args.push(tx.object(p.contentObjectId))
    if (p.functionName === 'seal_approve_content_granted_agent') {
      check(p.soulGrantObjectId && !p.paidAccessListOnChainId, 'Content grant approval is invalid')
      args.push(tx.object(p.soulGrantObjectId))
    } else check(!p.soulGrantObjectId && !p.paidAccessListOnChainId, 'Unexpected content approval object')
  }
  args.push(tx.pure.u32(p.kind), tx.pure.string(p.name), tx.pure.u64(p.versionIndex))
  if (p.functionName === 'seal_approve_content_granted_agent' || p.functionName === 'seal_approve_content_paid_access') args.push(tx.object('0x6'))
  tx.moveCall({ target: `${p.callablePackageId}::${p.moduleName}::${p.functionName}`, arguments: args })
  return tx
}

export function assertBrowserContentSealObject(bytes: Uint8Array, options: {
  packageId: string; documentId: string; config: BrowserContentSealConfig; plaintextByteLength: number; aad?: Uint8Array
  /** Batch recovery only; ordinary content-key envelopes retain the 128 KiB
   * default. This is a parser budget, not a change to any Seal access policy. */
  maximumPlaintextByteLength?: number
}) {
  const { config, aad = new Uint8Array() } = options
  const maximum = options.maximumPlaintextByteLength ?? 128 * 1024
  check(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 4 * 1024 * 1024,
    'Content encrypted key size budget is invalid')
  check(bytes instanceof Uint8Array && bytes.length <= maximum + 128 * 1024, 'Content encrypted key exceeds its size budget')
  const parsed = EncryptedObject.parse(bytes)
  check(Number.isSafeInteger(options.plaintextByteLength) && options.plaintextByteLength > 0 && options.plaintextByteLength <= maximum
    && toBase64(EncryptedObject.serialize(parsed).toBytes()) === toBase64(bytes)
    && parsed.version === 0 && parsed.packageId === options.packageId && parsed.id === options.documentId.replace(/^0x/, '')
    && parsed.threshold === config.threshold && parsed.ciphertext.$kind === 'Aes256Gcm'
    && parsed.ciphertext.Aes256Gcm.blob.length === options.plaintextByteLength + 16
    && toHex(parsed.ciphertext.Aes256Gcm.aad ?? new Uint8Array()) === toHex(aad),
  'Content encrypted key identity is invalid')
  const counts = new Map<string, number>(), indices = new Set<number>()
  for (const [id, index] of parsed.services) {
    check(index > 0 && index <= parsed.services.length && !indices.has(index), 'Content encrypted key share index is invalid')
    indices.add(index); counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  check(counts.size === config.serverConfigs.length && config.serverConfigs.every(s => counts.get(s.objectId) === s.weight)
    && parsed.encryptedShares.$kind === 'BonehFranklinBLS12381'
    && parsed.encryptedShares.BonehFranklinBLS12381.encryptedShares.length === parsed.services.length,
  'Content encrypted key services do not match the public configuration')
}

function wrappedKey(access: BrowserContentAccess, config: BrowserContentSealConfig) {
  const p = access.accessPolicy, s = access.sealSidecar
  check(p && s && s.sealPackageId === p.sealPackageId && p.documentIdHex.replace(/^0x/, '') === s.documentId.replace(/^0x/, '')
    && isContentDocumentIdForVersion(s.documentId, { contentObjectId: access.contentId, kind: access.kind,
      name: access.name, versionIndex: BigInt(access.versionIndex) }), 'Content Seal document mismatch')
  const bytes = fromBase64(s.encryptedDek)
  check(bytes.length <= 16 * 1024, 'Content encrypted key is too large')
  assertBrowserContentSealObject(bytes, { packageId: p.sealPackageId, documentId: s.documentId, config, plaintextByteLength: 64 })
  return bytes
}

/** Own the response before handoff, bound actual streaming bytes and release
 * partial buffers on failure. No redirect, cookies or arbitrary artifact URL. */
export async function fetchBrowserContentBytes(access: BrowserContentAccess, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const artifact = structuredClone(access.artifact), size = BigInt(artifact.byteLength)
  check(size >= 16n && size <= BigInt(BROWSER_CONTENT_MAX_BYTES), 'Content exceeds the browser read limit')
  const abort = AbortSignal.any([signal, AbortSignal.timeout(30000)])
  abort.throwIfAborted()
  let response: Response | undefined, discarded = false
  const discard = (r: Response) => { if (!discarded) { discarded = true; void r.body?.cancel().catch(() => {}) } }
  const pending = fetcher(artifact.walrusBlobUrl, { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: abort })
    .then(r => { response = r; if (abort.aborted) discard(r); return r })
  void pending.catch(() => {})
  try { response = await profileReadStep(abort, () => pending, discard); abort.throwIfAborted() }
  catch (error) { if (response) discard(response); throw error }
  const length = response.headers.get('content-length')
  if (!response.ok || !response.body || (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || BigInt(length) !== size))) {
    discard(response); throw new Error('Content storage response is missing or has the wrong length')
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let count = 0
  try {
    for (;;) {
      const next = await profileReadStep(abort, () => reader.read(), v => v.value?.fill(0))
      abort.throwIfAborted()
      if (next.done) break
      count += next.value.byteLength
      if (BigInt(count) > size) { next.value.fill(0); throw new Error('Content storage response exceeds its certified length') }
      chunks.push(next.value)
    }
    check(BigInt(count) === size, 'Content storage response is truncated')
    const bytes = new Uint8Array(count); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
}

export interface BrowserContentOpenParams {
  request: Parameters<typeof readBrowserContentAccess>[0]
  sealConfig: BrowserContentSealConfig
  client: SuiGrpcClient; sealClient: SealCompatibleClient; signal: AbortSignal
  getAddress: () => string | null; signPersonalMessage: (message: Uint8Array) => Promise<string>
}
interface Dependencies { read?: typeof readBrowserContentAccess; fetcher?: typeof fetch }
/** Only this explicit operation asks for a personal message. It never submits
 * transactions, and never persists plaintext, session keys or decrypted DEKs. */
export async function openBrowserSoulContent(params: BrowserContentOpenParams, dependencies: Dependencies = {}) {
  const request = structuredClone({ ...params.request, signal: undefined }), config = validateBrowserContentSealConfig(params.sealConfig)
  const { signal, client, sealClient, getAddress, signPersonalMessage } = params, deps = { ...dependencies }
  const viewer = request.viewerAddress
  const guard = () => { signal.throwIfAborted(); check(viewer && getAddress() === viewer, 'Content wallet session changed') }
  const step = async <T>(run: () => Promise<T>, discard?: (v: T) => void): Promise<T> => {
    guard(); const value = await profileReadStep(signal, run, discard)
    try { guard(); return value } catch (error) { discard?.(value); throw error }
  }
  const proof = await step(() => (deps.read ?? readBrowserContentAccess)({ ...request, signal }, { client: () => client }))
  const access = structuredClone(proof.access), encryptedKey = wrappedKey(access, config)
  check(access.viewerAddress === viewer && access.accessPolicy.sealPackageId === request.config.target.soulidityOriginalPackageId
    && access.accessPolicy.callablePackageId === request.config.target.soulidityCallablePackageId, 'Content release identity mismatch')
  const verify = async () => {
    await step(proof.recheck)
    check((await step(() => sealClient.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST, 'Content Seal client is on a different network')
  }
  let ciphertext: Uint8Array | undefined, keyMaterial: Uint8Array | undefined, plaintext: Uint8Array | undefined
  try {
    ciphertext = await step(() => fetchBrowserContentBytes(access, signal, deps.fetcher), v => v.fill(0))
    await verify()
    const seal = new SealClient({ suiClient: sealClient, serverConfigs: config.serverConfigs, verifyKeyServers: true, timeout: 10000 })
    await step(() => seal.getKeyServers())
    const tx = buildBrowserContentApproval(access)
    const txBytes = await step(() => tx.build({ client, onlyTransactionKind: true }))
    const session = await step(() => SessionKey.create({ address: viewer!, packageId: access.accessPolicy.sealPackageId,
      ttlMin: config.ttlMin, suiClient: sealClient }))
    await verify()
    const signature = await step(() => signPersonalMessage(session.getPersonalMessage()))
    // Seal SDK verifies the personal signature belongs to this exact address.
    await step(() => session.setPersonalMessageSignature(signature))
    await verify()
    keyMaterial = await step(() => seal.decrypt({ data: encryptedKey, sessionKey: session, txBytes, checkShareConsistency: true }), v => v.fill(0))
    const s = access.sealSidecar
    check(keyMaterial.length === 64 && toHex(keyMaterial.subarray(32)) === s.contentHash, 'Content key hash binding mismatch')
    const key = await step(() => crypto.subtle.importKey('raw', new Uint8Array(keyMaterial!.subarray(0, 32)), { name: 'AES-GCM' }, false, ['decrypt']))
    plaintext = await step(async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromBase64(s.iv)) },
      key, new Uint8Array(ciphertext!))), v => v.fill(0))
    check(toHex(sha256(plaintext)) === s.contentHash, 'Content plaintext hash mismatch')
    await verify(); guard()
    const result = { bytes: plaintext, fileName: s.fileName, mimeType: s.mimeType }
    plaintext = undefined // Ownership transfers to the caller, which must clear it.
    return result
  } finally { ciphertext?.fill(0); keyMaterial?.fill(0); plaintext?.fill(0); encryptedKey.fill(0) }
}
