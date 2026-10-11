import { EncryptedObject, SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, fromHex, toBase64 } from '@mysten/sui/utils'
import { deriveContentUploadRecoveryId, type SealEnvelopeSidecar } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { assertBrowserContentSealObject, validateBrowserContentSealConfig, type BrowserContentSealConfig } from '../soulidity/browser-content-open'
import type { ContentAppendCryptoWallet } from '../soulidity/content-append-preparation'
import { encryptContentKeyEnvelope } from '../soulidity/content-key-envelope'
import { CONTENT_ENVELOPE_SCHEMA, encodeContentEnvelope } from '../soulidity/content-envelope'
import { parseWalrusBatchManifest, parseWalrusBatchScope, walrusBatchAddress, walrusBatchBase64, walrusBatchHash,
  walrusBatchCanonicalJson, walrusBatchJsonHash, walrusBatchKeys, walrusBatchStep, type WalrusBatchLifetime, type WalrusBatchManifest,
  type WalrusBatchProtection, type WalrusBatchProtector, type WalrusBatchScope } from './walrus-batch-preparation'

const utf8 = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true }), MAX_PRIVATE = 4 * 1024 * 1024
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`WALRUS_BATCH_SEAL_${code}`) }
const same = (a: unknown, b: unknown) => walrusBatchCanonicalJson(a) === walrusBatchCanonicalJson(b)
export interface WalrusBatchSealSlot { fileIndex: number; contentObjectId: string; kind: number; name: string; versionIndex: string }
export interface WalrusBatchSealContext {
  schema: 'soulidity.walrus-batch-seal.v1'
  scope: WalrusBatchScope
  originalPackageId: string; callablePackageId: string; recoveryNonce: string
  sealConfig: BrowserContentSealConfig
  slots: WalrusBatchSealSlot[]
}
export interface WalrusBatchInitialSidecar { fileIndex: number; sidecar: SealEnvelopeSidecar & { sealPackageId: string } }
export function parseWalrusBatchSealContext(input: unknown): WalrusBatchSealContext {
  const c = structuredClone(input) as WalrusBatchSealContext
  walrusBatchKeys(c, ['schema', 'scope', 'originalPackageId', 'callablePackageId', 'recoveryNonce', 'sealConfig', 'slots'])
  c.scope = parseWalrusBatchScope(c.scope); c.sealConfig = validateBrowserContentSealConfig(c.sealConfig)
  check(c.schema === 'soulidity.walrus-batch-seal.v1' && c.scope.network === 'mainnet'
    && walrusBatchAddress(c.originalPackageId) && walrusBatchAddress(c.callablePackageId)
    && typeof c.recoveryNonce === 'string' && /^[0-9a-f]{32}$/.test(c.recoveryNonce)
    && Array.isArray(c.slots) && c.slots.length > 0 && c.slots.length <= 4096, 'CONTEXT_INVALID')
  let previous = -1; const identities = new Set<string>()
  for (const slot of c.slots) {
    walrusBatchKeys(slot, ['fileIndex', 'contentObjectId', 'kind', 'name', 'versionIndex'])
    check(Number.isSafeInteger(slot.fileIndex) && slot.fileIndex > previous && slot.fileIndex < 4096
      && walrusBatchAddress(slot.contentObjectId) && Number.isInteger(slot.kind) && slot.kind >= 0 && slot.kind <= 0xffffffff
      && typeof slot.name === 'string' && /^[a-z0-9_-]{1,32}$/.test(slot.name)
      && (slot.kind !== 0 || slot.name === 'soul') && (slot.kind !== 1 || slot.name === 'default')
      && typeof slot.versionIndex === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(slot.versionIndex)
      && BigInt(slot.versionIndex) <= 18446744073709551615n, 'SLOT_INVALID')
    const identity = `${slot.contentObjectId}:${slot.kind}:${slot.name}:${slot.versionIndex}`
    check(!identities.has(identity), 'DUPLICATE_SLOT'); identities.add(identity); previous = slot.fileIndex
  }
  return c
}
function manifestFor(context: WalrusBatchSealContext, input: WalrusBatchManifest) {
  const manifest = parseWalrusBatchManifest(input)
  check(same(manifest.scope, context.scope), 'MANIFEST_SCOPE_MISMATCH')
  const encrypted = manifest.files.filter(file => file.uploadType === 'encrypted')
  check(encrypted.length === context.slots.length && encrypted.every((file, i) => file.index === context.slots[i].fileIndex
    && file.recipient === context.scope.owner), 'PRIVATE_SLOT_MAPPING')
  return manifest
}
function recoveryId(context: WalrusBatchSealContext, manifest: WalrusBatchManifest) {
  return deriveContentUploadRecoveryId({ author: context.scope.owner, contentObjectId: context.slots[0].contentObjectId,
    operationHash: walrusBatchJsonHash(manifest), nonce: context.recoveryNonce })
}
function recoveryAad(context: WalrusBatchSealContext, manifestHash: string) {
  // Fixed-size commitment to every planned Content slot, not only the first
  // recovery namespace ID. The parent separately commits the public sidecars.
  return utf8.encode(JSON.stringify({ schema: 'soulidity.walrus-batch-recovery-aad.v1', manifestHash,
    sealContextHash: walrusBatchJsonHash(context) }))
}
function assertProtection(context: WalrusBatchSealContext, manifest: WalrusBatchManifest, protection: WalrusBatchProtection) {
  walrusBatchKeys(protection, ['contextHash', 'encrypted'])
  const expected = walrusBatchJsonHash(manifest)
  check(protection.contextHash === expected, 'PROTECTION_CONTEXT_MISMATCH')
  const bytes = walrusBatchBase64(protection.encrypted, MAX_PRIVATE + 128 * 1024)
  const parsed = EncryptedObject.parse(bytes)
  check(parsed.ciphertext.$kind === 'Aes256Gcm', 'CIPHER_INVALID')
  assertBrowserContentSealObject(bytes, { packageId: context.originalPackageId, documentId: recoveryId(context, manifest),
    config: context.sealConfig, plaintextByteLength: parsed.ciphertext.Aes256Gcm.blob.length - 16,
    maximumPlaintextByteLength: MAX_PRIVATE, aad: recoveryAad(context, expected) })
}
/** Pure wire-format, namespace, full-context AAD and keyset verification. This
 * does not decrypt the private recovery or attest a chain transaction. */
export function verifyWalrusBatchProtection(contextInput: WalrusBatchSealContext, manifestInput: WalrusBatchManifest,
  protectionInput: WalrusBatchProtection) {
  const context = parseWalrusBatchSealContext(contextInput), manifest = manifestFor(context, manifestInput)
  const protection = structuredClone(protectionInput)
  assertProtection(context, manifest, protection); return protection
}
/** A hash is only an integrity value until the parent proves its complete
 * ordered manifest in the original signed register/create transaction. */
export function walrusBatchProtectionCommitment(protection: WalrusBatchProtection) {
  walrusBatchKeys(protection, ['contextHash', 'encrypted'])
  check(/^[0-9a-f]{64}$/.test(protection.contextHash), 'PROTECTION_CONTEXT_INVALID')
  walrusBatchBase64(protection.encrypted, MAX_PRIVATE + 128 * 1024)
  return walrusBatchJsonHash(protection)
}
export function verifyWalrusBatchInitialSidecars(contextInput: WalrusBatchSealContext, manifestInput: WalrusBatchManifest,
  input: readonly WalrusBatchInitialSidecar[]) {
  const context = parseWalrusBatchSealContext(contextInput), manifest = manifestFor(context, manifestInput), rows = structuredClone(input)
  check(Array.isArray(rows) && rows.length === context.slots.length, 'SIDECAR_COUNT')
  rows.forEach((row: WalrusBatchInitialSidecar, i: number) => {
    walrusBatchKeys(row, ['fileIndex', 'sidecar'])
    check(row.sidecar && typeof row.sidecar === 'object', 'SIDECAR_INVALID')
    const slot = context.slots[i], file = manifest.files[slot.fileIndex]
    check(row.fileIndex === slot.fileIndex && row.sidecar.contentHash === file.contentHash
      && row.sidecar.fileName === file.fileName && row.sidecar.mimeType === file.mimeType, 'SIDECAR_FILE_MISMATCH')
    encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, contentObjectId: slot.contentObjectId, kind: slot.kind,
      name: slot.name, versionIndex: slot.versionIndex, blobObjectId: slot.contentObjectId, sidecar: row.sidecar }, context.originalPackageId)
    assertBrowserContentSealObject(fromBase64(row.sidecar.encryptedDek), { packageId: context.originalPackageId,
      documentId: row.sidecar.documentId, config: context.sealConfig, plaintextByteLength: 64 })
  })
  return rows
}

/** Production crypto composition for the uploader. Fresh preparation encrypts
 * each public content envelope plus ONE private batch recovery bundle; it asks
 * for no wallet signature. The parent must persist context, returned sidecars,
 * preparation and their complete manifest before the first paid transaction. */
export function createWalrusBatchSealProtector(params: {
  context: WalrusBatchSealContext; wallet: ContentAppendCryptoWallet; lifetime: WalrusBatchLifetime
}) {
  const context = parseWalrusBatchSealContext(params.context), wallet = { ...params.wallet }, life = { ...params.lifetime }
  let preparedSidecars: WalrusBatchInitialSidecar[] | null = null
  let preparedManifestHash: string | null = null
  let state: 'NEW' | 'PREPARING' | 'PREPARED' | 'FAILED' = 'NEW'
  const step = <T>(signal: AbortSignal, run: () => Promise<T>, discard?: (value: T) => void) =>
    walrusBatchStep(context.scope, { ...life, signal: AbortSignal.any([life.signal, wallet.signal, signal]),
      isCurrent: () => life.isCurrent() && wallet.getAddress() === context.scope.owner }, run, discard)
  const chain = async (signal: AbortSignal) => {
    const values = await step(signal, () => Promise.all([wallet.client.core.getChainIdentifier(), wallet.sealClient.core.getChainIdentifier()]))
    check(values.every(value => value.chainIdentifier === MAINNET_GENESIS_DIGEST), 'NETWORK_MISMATCH')
  }
  const openSeal = async (signal: AbortSignal) => {
    await chain(signal)
    const seal = new SealClient({ suiClient: wallet.sealClient, serverConfigs: context.sealConfig.serverConfigs, verifyKeyServers: true, timeout: 10000 })
    await step(signal, () => seal.getKeyServers()); return seal
  }
  const protector: WalrusBatchProtector = {
    async protect(input) {
      // Reserve synchronously. Concurrent uploads may encrypt identical source
      // metadata with different AES keys and must never overwrite this result.
      check(state === 'NEW', 'PROTECTOR_ALREADY_USED'); state = 'PREPARING'
      let raw: Uint8Array | undefined
      let value: any
      try {
        const manifest = manifestFor(context, input.manifest), contextHash = input.contextHash
        raw = new Uint8Array(input.plaintext)
        check(raw.length > 0 && raw.length <= MAX_PRIVATE && contextHash === walrusBatchJsonHash(manifest), 'PREPARATION_INVALID')
        const text = decoder.decode(raw); value = JSON.parse(text)
        walrusBatchKeys(value, ['schema', 'manifestHash', 'materials'])
        check(text === JSON.stringify(value) && value.schema === 'soulidity.walrus-batch-private.v1' && value.manifestHash === contextHash
          && Array.isArray(value.materials) && value.materials.length === context.slots.length, 'PRIVATE_MANIFEST_INVALID')
        // Validate every row before contacting key servers or producing output.
        value.materials.forEach((entry: any, i: number) => {
          walrusBatchKeys(entry, ['index', 'material']); walrusBatchKeys(entry.material, ['version', 'dek', 'iv', 'contentHash', 'mimeType', 'fileName'])
          const file = manifest.files[context.slots[i].fileIndex], material = entry.material
          check(entry.index === file.index && material.version === 1 && material.contentHash === file.contentHash
            && material.mimeType === file.mimeType && material.fileName === file.fileName, 'PRIVATE_MATERIAL_MISMATCH')
          const key = walrusBatchBase64(material.dek, 32), iv = walrusBatchBase64(material.iv, 12)
          try { check(key.length === 32 && iv.length === 12, 'KEY_INVALID') } finally { key.fill(0); iv.fill(0) }
        })
        const seal = await openSeal(input.signal), sidecars: WalrusBatchInitialSidecar[] = []
        for (const [i, slot] of context.slots.entries()) {
          const material = value.materials[i].material, dek = fromBase64(material.dek), iv = fromBase64(material.iv)
          try {
            const sidecar = await encryptContentKeyEnvelope({ ...slot, originalPackageId: context.originalPackageId, config: context.sealConfig,
              contentHash: material.contentHash, mimeType: material.mimeType, fileName: material.fileName, dek, iv,
              encrypt: args => step(input.signal, () => seal.encrypt(args), result => result.key.fill(0)) })
            sidecars.push({ fileIndex: slot.fileIndex, sidecar })
          } finally { dek.fill(0); iv.fill(0) }
        }
        const wrapped = await step(input.signal, () => seal.encrypt({ packageId: context.originalPackageId,
          id: recoveryId(context, manifest), threshold: context.sealConfig.threshold, data: raw!, aad: recoveryAad(context, contextHash) }), result => result.key.fill(0))
        try {
          assertProtection(context, manifest, { contextHash, encrypted: toBase64(wrapped.encryptedObject) })
          await chain(input.signal)
          preparedSidecars = verifyWalrusBatchInitialSidecars(context, manifest, sidecars)
          preparedManifestHash = contextHash; state = 'PREPARED'
          return new Uint8Array(wrapped.encryptedObject)
        } finally { wrapped.key.fill(0) }
      } finally {
        raw?.fill(0)
        if (state === 'PREPARING') state = 'FAILED'
        if (Array.isArray(value?.materials)) for (const entry of value.materials) if (entry?.material) { entry.material.dek = ''; entry.material.iv = '' }
      }
    },
    async verify(input) {
      const manifest = manifestFor(context, input.manifest), protection = structuredClone(input.protection)
      await step(input.signal, async () => { assertProtection(context, manifest, protection) })
    },
  }
  return {
    protector,
    sidecars(expectedManifestHash: string) {
      check(state === 'PREPARED' && preparedSidecars, 'SIDECARS_NOT_PREPARED')
      check(preparedManifestHash === expectedManifestHash, 'SIDECAR_MANIFEST_MISMATCH'); return structuredClone(preparedSidecars)
    },
    /** expectedProtectionCommitment comes from a proved parent manifest, not
     * the ciphertext's own journal. One session decrypts the entire batch. */
    async unlock(input: { manifest: WalrusBatchManifest; protection: WalrusBatchProtection; signal: AbortSignal }, expectedProtectionCommitment: string) {
      const manifest = manifestFor(context, input.manifest), protection = structuredClone(input.protection)
      check(walrusBatchProtectionCommitment(protection) === expectedProtectionCommitment, 'PARENT_COMMITMENT_MISMATCH')
      assertProtection(context, manifest, protection)
      const seal = await openSeal(input.signal), tx = new Transaction()
      tx.moveCall({ target: `${context.callablePackageId}::content::seal_approve_upload_recovery`,
        arguments: [tx.pure.vector('u8', fromHex(recoveryId(context, manifest)))] })
      const txBytes = await step(input.signal, () => tx.build({ client: wallet.client, onlyTransactionKind: true }))
      const session = await step(input.signal, () => SessionKey.create({ address: context.scope.owner, packageId: context.originalPackageId,
        ttlMin: context.sealConfig.ttlMin, suiClient: wallet.sealClient }))
      await chain(input.signal)
      const signature = await step(input.signal, () => wallet.signPersonalMessage(session.getPersonalMessage()))
      await step(input.signal, () => session.setPersonalMessageSignature(signature)); await chain(input.signal)
      return step(input.signal, () => seal.decrypt({ data: fromBase64(protection.encrypted), sessionKey: session, txBytes,
        checkShareConsistency: true }), result => result.fill(0))
    },
  }
}
