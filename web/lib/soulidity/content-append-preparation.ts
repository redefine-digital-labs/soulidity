import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, fromHex, toBase64, toHex } from '@mysten/sui/utils'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveContentUploadRecoveryId, assertContentUploadRecoveryId,
  profileReadStep, type SealEnvelopeSidecar } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { CONTENT_ENVELOPE_SCHEMA, encodeContentEnvelope, type ContentEnvelopeSlot } from './content-envelope'
import { assertBrowserContentSealObject, validateBrowserContentSealConfig, type BrowserContentSealConfig } from './browser-content-open'
import { encryptContentKeyEnvelope } from './content-key-envelope'

const utf8 = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true })
const digest = (bytes: Uint8Array) => toHex(sha256(bytes))
const canonical = (value: unknown) => JSON.stringify(value)
const id = (v: unknown) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_${code}`) }
function keys(v: unknown, names: string[]): asserts v is Record<string, unknown> {
  check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length
    && names.every(k => Object.hasOwn(v, k)), 'SHAPE_INVALID')
}

/** The public transaction intent is supplied/validated by the content controller.
 * This crypto layer binds its exact canonical bytes; a signature is evidence of
 * preparation, never permission to skip current chain authority or cost review. */
export interface ContentAppendPreparationScope {
  author: string; originalPackageId: string; callablePackageId: string
  contentObjectId: string; kind: number; name: string; versionIndex: string
  intentJson: string
}
export interface ContentAppendPreparation {
  schema: 'soulidity.content-append-preparation.v1'
  scope: ContentAppendPreparationScope
  sealConfig: BrowserContentSealConfig
  contentHash: string; payloadHash: string; plaintextByteLength: number
  ciphertext: Uint8Array
  sidecar: SealEnvelopeSidecar & { sealPackageId: string }
  recovery: { nonce: string; documentId: string; encrypted: string; plaintextByteLength: number }
  authorSignature: string
}
/** Encrypted material only, NOT an author attestation. Batch mint binds its
 * commitment to the complete first transaction; append signs it separately. */
export type ContentUploadMaterial = Omit<ContentAppendPreparation, 'authorSignature'>
type Unsigned = ContentUploadMaterial
export interface ContentAppendCryptoWallet {
  client: SuiGrpcClient; sealClient: SealCompatibleClient; signal: AbortSignal
  getAddress: () => string | null
  signPersonalMessage: (message: Uint8Array) => Promise<string>
}
function scope(input: ContentAppendPreparationScope) {
  const s = structuredClone(input)
  keys(s, ['author', 'originalPackageId', 'callablePackageId', 'contentObjectId', 'kind', 'name', 'versionIndex', 'intentJson'])
  check(id(s.author) && id(s.originalPackageId) && id(s.callablePackageId) && id(s.contentObjectId), 'SCOPE_ID_INVALID')
  check(Number.isInteger(s.kind) && s.kind >= 0 && s.kind <= 0xffffffff && /^[a-z0-9_-]{1,32}$/.test(s.name)
    && (s.kind !== 0 || s.name === 'soul') && (s.kind !== 1 || s.name === 'default')
    && /^(0|[1-9][0-9]{0,19})$/.test(s.versionIndex) && BigInt(s.versionIndex) <= 18446744073709551615n, 'SLOT_INVALID')
  check(typeof s.intentJson === 'string' && utf8.encode(s.intentJson).length <= 64 * 1024
    && canonical(JSON.parse(s.intentJson)) === s.intentJson, 'INTENT_INVALID')
  return s
}
export function contentAppendPreparationOperationHash(input: ContentAppendPreparationScope) {
  return digest(utf8.encode(canonical(scope(input))))
}
export function contentAppendPreparationMessage(record: Unsigned): Uint8Array {
  // No ciphertext body, raw key or private recovery plaintext in the wallet text.
  return utf8.encode('Soulidity: prepare encrypted content upload\n'
    + 'This confirms the content preparation below. It does not authorize a transaction or payment.\n'
    + canonical({ schema: record.schema, scope: record.scope, sealConfig: record.sealConfig,
      contentHash: record.contentHash, payloadHash: record.payloadHash, plaintextByteLength: record.plaintextByteLength,
      sidecarHash: digest(utf8.encode(canonical(record.sidecar))), recoveryHash: digest(utf8.encode(canonical(record.recovery))) }))
}
function slot(record: Unsigned, blobObjectId: string): ContentEnvelopeSlot {
  return { contentObjectId: record.scope.contentObjectId, kind: record.scope.kind, name: record.scope.name,
    versionIndex: record.scope.versionIndex, blobObjectId }
}
export function contentAppendPreparedEnvelope(record: Unsigned, blobObjectId: string): Uint8Array {
  return utf8.encode(encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot(record, blobObjectId), sidecar: record.sidecar },
    record.scope.originalPackageId))
}
export function validateContentUploadMaterial(input: ContentUploadMaterial): ContentUploadMaterial {
  const r = structuredClone(input)
  keys(r, ['schema', 'scope', 'sealConfig', 'contentHash', 'payloadHash', 'plaintextByteLength', 'ciphertext', 'sidecar', 'recovery'])
  check(r.schema === 'soulidity.content-append-preparation.v1', 'SCHEMA_INVALID')
  r.scope = scope(r.scope); r.sealConfig = validateBrowserContentSealConfig(r.sealConfig)
  check(hash(r.contentHash) && hash(r.payloadHash) && r.ciphertext instanceof Uint8Array
    && Number.isSafeInteger(r.plaintextByteLength) && r.plaintextByteLength >= 0 && r.plaintextByteLength <= 64 * 1024 * 1024 - 16
    && r.ciphertext.length === r.plaintextByteLength + 16 && digest(r.ciphertext) === r.payloadHash, 'CIPHERTEXT_INVALID')
  check(r.sidecar.contentHash === r.contentHash, 'CONTENT_HASH_MISMATCH')
  // Placeholder is used only to validate the sidecar before register allocates
  // the real Blob. It is never returned or stored as the on-chain envelope.
  contentAppendPreparedEnvelope(r, r.scope.contentObjectId)
  assertBrowserContentSealObject(fromBase64(r.sidecar.encryptedDek), { packageId: r.scope.originalPackageId,
    documentId: r.sidecar.documentId, config: r.sealConfig, plaintextByteLength: 64 })
  keys(r.recovery, ['nonce', 'documentId', 'encrypted', 'plaintextByteLength'])
  assertContentUploadRecoveryId(r.recovery.documentId, { author: r.scope.author, contentObjectId: r.scope.contentObjectId,
    operationHash: contentAppendPreparationOperationHash(r.scope), nonce: r.recovery.nonce })
  assertBrowserContentSealObject(fromBase64(r.recovery.encrypted), { packageId: r.scope.originalPackageId,
    documentId: r.recovery.documentId, config: r.sealConfig, plaintextByteLength: r.recovery.plaintextByteLength,
    aad: utf8.encode(canonical(r.scope)) })
  return r
}
function validate(input: ContentAppendPreparation): ContentAppendPreparation {
  keys(input, ['schema', 'scope', 'sealConfig', 'contentHash', 'payloadHash', 'plaintextByteLength', 'ciphertext', 'sidecar', 'recovery', 'authorSignature'])
  const { authorSignature, ...material } = input
  check(typeof authorSignature === 'string' && authorSignature.length > 0 && authorSignature.length <= 32768, 'AUTHOR_SIGNATURE_REQUIRED')
  return { ...validateContentUploadMaterial(material), authorSignature }
}
/** Caller must obtain the expected commitment from its independently verified
 * parent transaction, never from the same untrusted recovery record. */
export function contentUploadMaterialCommitment(input: ContentUploadMaterial): string {
  return digest(contentAppendPreparationMessage(validateContentUploadMaterial(input)))
}
export async function verifyContentAppendPreparation(input: ContentAppendPreparation, client: SuiGrpcClient) {
  const r = validate(input)
  await verifyPersonalMessageSignature(contentAppendPreparationMessage(r), r.authorSignature, { address: r.scope.author, client })
  return r
}
export function contentAppendPreparationFingerprint(input: ContentAppendPreparation) {
  const r = validate(input)
  return digest(utf8.encode(canonical({ message: toBase64(contentAppendPreparationMessage(r)), signature: r.authorSignature })))
}
function walletSteps(author: string, wallet: ContentAppendCryptoWallet) {
  const guard = () => { wallet.signal.throwIfAborted(); check(wallet.getAddress() === author, 'WALLET_CHANGED') }
  const step = async <T>(run: () => Promise<T>, discard?: (value: T) => void): Promise<T> => {
    guard(); const value = await profileReadStep(wallet.signal, run, discard)
    try { guard(); return value } catch (error) { discard?.(value); throw error }
  }
  const chain = async () => check((await step(() => wallet.sealClient.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST,
    'SEAL_NETWORK_MISMATCH')
  return { guard, step, chain }
}

/** The only wrapping path for both a first preparation and a verified rebase.
 * Rebase passes the existing ciphertext/IV/DEK, never encrypts the file again. */
export async function wrapContentUploadMaterial(params: {
  scope: ContentAppendPreparationScope; sealConfig: BrowserContentSealConfig; wallet: ContentAppendCryptoWallet
  ciphertext: Uint8Array; iv: Uint8Array; dek: Uint8Array; contentHash: string; plaintextByteLength: number
  mimeType: string; fileName: string
}): Promise<ContentUploadMaterial> {
  const s = scope(params.scope), config = validateBrowserContentSealConfig(params.sealConfig), wallet = { ...params.wallet }
  const ciphertext = new Uint8Array(params.ciphertext), iv = new Uint8Array(params.iv), dek = new Uint8Array(params.dek)
  const { contentHash, plaintextByteLength, mimeType, fileName } = params
  const { step, chain } = walletSteps(s.author, wallet)
  let recoveryPlaintext: Uint8Array | undefined, plaintext: Uint8Array | undefined
  try {
    check(dek.length === 32 && iv.length === 12 && hash(contentHash)
      && Number.isSafeInteger(plaintextByteLength) && plaintextByteLength >= 0 && plaintextByteLength <= 64 * 1024 * 1024 - 16
      && ciphertext.length === plaintextByteLength + 16 && typeof mimeType === 'string' && mimeType.length > 0 && mimeType.length <= 1024
      && typeof fileName === 'string' && fileName.length > 0 && fileName.length <= 4096, 'SOURCE_INVALID')
    // Batch passes the already encrypted payload. Verify its exact material;
    // never encrypt it again, which would invalidate a paid Walrus Blob ID.
    const key = await step(() => crypto.subtle.importKey('raw', new Uint8Array(dek), 'AES-GCM', false, ['decrypt']))
    plaintext = await step(async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)), v => v.fill(0))
    check(plaintext.length === plaintextByteLength && digest(plaintext) === contentHash, 'RECOVERED_SOURCE_MISMATCH')
    plaintext.fill(0); plaintext = undefined
    await chain()
    const seal = new SealClient({ suiClient: wallet.sealClient, serverConfigs: config.serverConfigs, verifyKeyServers: true, timeout: 10000 })
    await step(() => seal.getKeyServers())
    const sidecar = await encryptContentKeyEnvelope({ ...s, config, dek, iv, contentHash, mimeType, fileName,
      encrypt: args => step(() => seal.encrypt(args), value => value.key.fill(0)) })
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)))
    const recoveryId = deriveContentUploadRecoveryId({ author: s.author, contentObjectId: s.contentObjectId,
      operationHash: contentAppendPreparationOperationHash(s), nonce })
    recoveryPlaintext = utf8.encode(canonical({ schema: 'soulidity.content-append-private.v1', scope: s,
      dek: toBase64(dek), iv: toBase64(iv), contentHash, payloadHash: digest(ciphertext), sidecar }))
    const recovery = await step(() => seal.encrypt({ packageId: s.originalPackageId, id: recoveryId, threshold: config.threshold,
      data: recoveryPlaintext!, aad: utf8.encode(canonical(s)) }), v => v.key.fill(0))
    recovery.key.fill(0)
    const unsigned: Unsigned = { schema: 'soulidity.content-append-preparation.v1', scope: s, sealConfig: config,
      contentHash, payloadHash: digest(ciphertext), plaintextByteLength, ciphertext, sidecar,
      recovery: { nonce, documentId: recoveryId, encrypted: toBase64(recovery.encryptedObject), plaintextByteLength: recoveryPlaintext.length } }
    await chain()
    return validateContentUploadMaterial(unsigned)
  } finally { recoveryPlaintext?.fill(0); plaintext?.fill(0); dek.fill(0) }
}

async function wrapContentAppendMaterial(params: Parameters<typeof wrapContentUploadMaterial>[0]): Promise<ContentAppendPreparation> {
  const wallet = { ...params.wallet }, s = scope(params.scope)
  const { step, chain } = walletSteps(s.author, wallet)
  const unsigned = await wrapContentUploadMaterial(params)
  await chain()
  const authorSignature = await step(() => wallet.signPersonalMessage(contentAppendPreparationMessage(unsigned)))
  return step(() => verifyContentAppendPreparation({ ...unsigned, authorSignature }, wallet.client))
}

/** Only returned ciphertext, encrypted recovery and verified author attestation
 * may be persisted. Caller must commit/read back this record before paying. */
export async function prepareContentAppend(params: {
  scope: ContentAppendPreparationScope; sealConfig: BrowserContentSealConfig
  plaintext: Uint8Array; mimeType: string; fileName: string; wallet: ContentAppendCryptoWallet
}): Promise<ContentAppendPreparation> {
  const s = scope(params.scope), config = validateBrowserContentSealConfig(params.sealConfig)
  const plaintext = new Uint8Array(params.plaintext), wallet = { ...params.wallet }, mimeType = params.mimeType, fileName = params.fileName
  const { step, chain } = walletSteps(s.author, wallet)
  let dek: Uint8Array | undefined
  try {
    check(plaintext.length <= 64 * 1024 * 1024 - 16 && typeof mimeType === 'string'
      && mimeType.length > 0 && mimeType.length <= 1024 && typeof fileName === 'string'
      && fileName.length > 0 && fileName.length <= 4096, 'SOURCE_INVALID')
    await chain()
    dek = crypto.getRandomValues(new Uint8Array(32)); const iv = crypto.getRandomValues(new Uint8Array(12))
    const contentHash = digest(plaintext)
    const key = await step(() => crypto.subtle.importKey('raw', new Uint8Array(dek!), 'AES-GCM', false, ['encrypt']))
    const ciphertext = await step(async () => new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)), v => v.fill(0))
    return await wrapContentAppendMaterial({ scope: s, sealConfig: config, wallet, ciphertext, iv, dek,
      contentHash, plaintextByteLength: plaintext.length, mimeType, fileName })
  } finally { plaintext.fill(0); dek?.fill(0) }
}

/** Reproduce the author's private preparation, then rewrap its identical paid
 * ciphertext for a new attempt. This neither retires a packet nor proves current
 * append authority: the recovery coordinator must do both before activation. */
export async function rewrapContentAppendPreparation(params: {
  record: ContentAppendPreparation; nextScope: ContentAppendPreparationScope
  sealConfig: BrowserContentSealConfig; wallet: ContentAppendCryptoWallet
}): Promise<ContentAppendPreparation> {
  const next = scope(params.nextScope), config = validateBrowserContentSealConfig(params.sealConfig), wallet = { ...params.wallet }
  const record = await verifyContentAppendPreparation(params.record, wallet.client)
  check((['author', 'originalPackageId', 'callablePackageId', 'contentObjectId', 'kind', 'name'] as const)
    .every(key => next[key] === record.scope[key]) && BigInt(next.versionIndex) >= BigInt(record.scope.versionIndex), 'REBASE_SCOPE_MISMATCH')
  check(contentAppendPreparationOperationHash(next) !== contentAppendPreparationOperationHash(record.scope), 'REBASE_ATTEMPT_UNCHANGED')
  const unlocked = await unlockContentAppendPreparation(record, wallet)
  try {
    return await wrapContentAppendMaterial({ scope: next, sealConfig: config, wallet, ciphertext: record.ciphertext,
      iv: fromBase64(record.sidecar.iv), dek: unlocked.dek, contentHash: record.contentHash,
      plaintextByteLength: record.plaintextByteLength, mimeType: record.sidecar.mimeType, fileName: record.sidecar.fileName })
  } finally { unlocked.plaintext.fill(0); unlocked.dek.fill(0) }
}

/** Explicit author unlock for rebase/export recovery. Exact replay can verify
 * the signed stage without decrypting it. A successful unlock grants no append
 * authority; the caller still verifies current ownership/grant and paid WAL. */
export async function unlockContentAppendPreparation(input: ContentAppendPreparation, wallet: ContentAppendCryptoWallet) {
  const record = await verifyContentAppendPreparation(input, wallet.client)
  const { authorSignature: _signature, ...material } = record
  const result = await unlockContentUploadMaterial(material, contentUploadMaterialCommitment(material), wallet)
  return { ...result, record }
}

/** Batch recovery requests one explicit Seal session only when private source
 * material is needed. Ciphertext upload and exact signed replay need no unlock. */
export async function unlockContentUploadMaterial(input: ContentUploadMaterial, expectedCommitment: string, walletInput: ContentAppendCryptoWallet) {
  const wallet = { ...walletInput }, record = validateContentUploadMaterial(input), { scope: s } = record
  check(hash(expectedCommitment) && contentUploadMaterialCommitment(record) === expectedCommitment, 'MATERIAL_COMMITMENT_MISMATCH')
  const { step, chain } = walletSteps(s.author, wallet)
  let raw: Uint8Array | undefined, dek: Uint8Array | undefined, plaintext: Uint8Array | undefined
  try {
    await chain()
    const seal = new SealClient({ suiClient: wallet.sealClient, serverConfigs: record.sealConfig.serverConfigs, verifyKeyServers: true, timeout: 10000 })
    await step(() => seal.getKeyServers())
    const tx = new Transaction()
    tx.moveCall({ target: `${s.callablePackageId}::content::seal_approve_upload_recovery`,
      arguments: [tx.pure.vector('u8', fromHex(record.recovery.documentId))] })
    const txBytes = await step(() => tx.build({ client: wallet.client, onlyTransactionKind: true }))
    const session = await step(() => SessionKey.create({ address: s.author, packageId: s.originalPackageId,
      ttlMin: record.sealConfig.ttlMin, suiClient: wallet.sealClient }))
    await chain()
    const signature = await step(() => wallet.signPersonalMessage(session.getPersonalMessage()))
    await step(() => session.setPersonalMessageSignature(signature)); await chain()
    raw = await step(() => seal.decrypt({ data: fromBase64(record.recovery.encrypted), sessionKey: session, txBytes, checkShareConsistency: true }), v => v.fill(0))
    const text = decode.decode(raw), parsed = JSON.parse(text)
    keys(parsed, ['schema', 'scope', 'dek', 'iv', 'contentHash', 'payloadHash', 'sidecar'])
    check(text === canonical(parsed) && parsed.schema === 'soulidity.content-append-private.v1'
      && canonical(parsed.scope) === canonical(s) && parsed.contentHash === record.contentHash && parsed.payloadHash === record.payloadHash
      && canonical(parsed.sidecar) === canonical(record.sidecar) && parsed.iv === record.sidecar.iv, 'PRIVATE_RECOVERY_MISMATCH')
    check(typeof parsed.dek === 'string', 'RECOVERY_DEK_INVALID')
    dek = fromBase64(parsed.dek); check(dek.length === 32 && toBase64(dek) === parsed.dek, 'RECOVERY_DEK_INVALID')
    const key = await step(() => crypto.subtle.importKey('raw', new Uint8Array(dek!), 'AES-GCM', false, ['decrypt']))
    plaintext = await step(async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromBase64(record.sidecar.iv)) },
      key, new Uint8Array(record.ciphertext))), v => v.fill(0))
    check(plaintext.length === record.plaintextByteLength && digest(plaintext) === record.contentHash, 'RECOVERED_SOURCE_MISMATCH')
    const result = { record, plaintext, dek }; plaintext = undefined; dek = undefined; return result
  } finally { raw?.fill(0); dek?.fill(0); plaintext?.fill(0) }
}
