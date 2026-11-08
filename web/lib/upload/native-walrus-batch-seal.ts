import { EncryptedObject, SealClient, SessionKey } from '@mysten/seal'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { deriveContentUploadRecoveryId } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import type { ContentAppendCryptoWallet } from '../soulidity/content-append-preparation'
import { assertBrowserContentSealObject, validateBrowserContentSealConfig, type BrowserContentSealConfig } from '../soulidity/browser-content-open'
import { encryptNativeCreationEnvelope, parseNativeCreationEnvelope, buildNativeCreationRecoveryApproval,
  type NativeCreationEnvelope } from '../soulidity/native-creation-envelope'
import { nativeCreationSealNamespace } from '../soulidity/native-creation-transaction'
import { parseWalrusBatchScope, parseWalrusBatchManifest, walrusBatchKeys, walrusBatchAddress, walrusBatchBase64,
  walrusBatchJsonHash, walrusBatchCanonicalJson, walrusBatchStep,
  type WalrusBatchScope, type WalrusBatchLifetime, type WalrusBatchManifest, type WalrusBatchProtection,
  type WalrusBatchProtector } from './walrus-batch-preparation'

export interface NativeBatchSealContext {
  schema: 'soulidity.native-batch-seal.v1'
  scope: WalrusBatchScope
  nativeOriginalPackageId: string
  nativeCallablePackageId: string
  contentId: string
  recoveryNonce: string
  sealConfig: BrowserContentSealConfig
  slots: { fileIndex: number; kind: number; name: string; nonce: string }[]
}
export interface NativeBatchEnvelope { fileIndex: number; envelope: NativeCreationEnvelope }
const utf8 = new TextEncoder(), maxPrivate = 4 * 1024 * 1024
function check(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(`NATIVE_BATCH_SEAL_${code}`) }
const same = (a: unknown, b: unknown) => walrusBatchCanonicalJson(a) === walrusBatchCanonicalJson(b)
export function parseNativeBatchSealContext(input: unknown): NativeBatchSealContext {
  const c = structuredClone(input) as NativeBatchSealContext
  walrusBatchKeys(c, ['schema', 'scope', 'nativeOriginalPackageId', 'nativeCallablePackageId', 'contentId', 'recoveryNonce', 'sealConfig', 'slots'])
  c.scope = parseWalrusBatchScope(c.scope); c.sealConfig = validateBrowserContentSealConfig(c.sealConfig)
  check(c.schema === 'soulidity.native-batch-seal.v1' && c.scope.network === 'mainnet'
    && walrusBatchAddress(c.nativeOriginalPackageId) && walrusBatchAddress(c.nativeCallablePackageId)
    && walrusBatchAddress(c.contentId) && /^[0-9a-f]{32}$/.test(c.recoveryNonce)
    && Array.isArray(c.slots) && c.slots.length >= 2 && c.slots.length <= 128, 'CONTEXT_INVALID')
  let previous = -1; const slots = new Set<string>()
  for (const slot of c.slots) {
    walrusBatchKeys(slot, ['fileIndex', 'kind', 'name', 'nonce'])
    check(Number.isSafeInteger(slot.fileIndex) && slot.fileIndex > previous && slot.fileIndex < 4096, 'FILE_ORDER')
    nativeCreationSealNamespace(c.contentId, slot.kind, slot.name, slot.nonce)
    const key = `${slot.kind}:${slot.name}`; check(!slots.has(key), 'DUPLICATE_SLOT'); slots.add(key); previous = slot.fileIndex
  }
  check(slots.has('0:soul') && slots.has('1:default'), 'FOUNDING_REQUIRED')
  return c
}
function manifestFor(c: NativeBatchSealContext, input: WalrusBatchManifest) {
  const m = parseWalrusBatchManifest(input), files = m.files.filter(f => f.uploadType === 'encrypted')
  check(same(m.scope, c.scope) && files.length === c.slots.length
    && files.every((f, i) => f.index === c.slots[i].fileIndex && f.recipient === c.scope.owner), 'FILE_MAPPING')
  return m
}
function recoveryScope(c: NativeBatchSealContext, m: WalrusBatchManifest) {
  return { author: c.scope.owner, contentObjectId: c.contentId, operationHash: walrusBatchJsonHash(m), nonce: c.recoveryNonce }
}
function aad(c: NativeBatchSealContext, hash: string) {
  return utf8.encode(walrusBatchCanonicalJson({ schema: 'soulidity.native-batch-recovery-aad.v1',
    manifestHash: hash, contextHash: walrusBatchJsonHash(c) }))
}
export function verifyNativeBatchProtection(context: NativeBatchSealContext, input: WalrusBatchManifest, value: WalrusBatchProtection) {
  const c = parseNativeBatchSealContext(context), m = manifestFor(c, input), p = structuredClone(value)
  walrusBatchKeys(p, ['contextHash', 'encrypted']); check(p.contextHash === walrusBatchJsonHash(m), 'MANIFEST_HASH')
  const bytes = walrusBatchBase64(p.encrypted, maxPrivate + 128 * 1024), object = EncryptedObject.parse(bytes)
  check(object.ciphertext.$kind === 'Aes256Gcm', 'CIPHER')
  assertBrowserContentSealObject(bytes, { packageId: c.nativeOriginalPackageId, documentId: deriveContentUploadRecoveryId(recoveryScope(c, m)),
    config: c.sealConfig, plaintextByteLength: object.ciphertext.Aes256Gcm.blob.length - 16,
    maximumPlaintextByteLength: maxPrivate, aad: aad(c, p.contextHash) })
  return p
}
export function verifyNativeBatchEnvelopes(context: NativeBatchSealContext, input: WalrusBatchManifest, rowsInput: NativeBatchEnvelope[]) {
  const c = parseNativeBatchSealContext(context), m = manifestFor(c, input), rows = structuredClone(rowsInput)
  check(Array.isArray(rows) && rows.length === c.slots.length, 'ENVELOPE_COUNT')
  rows.forEach((row, i) => {
    walrusBatchKeys(row, ['fileIndex', 'envelope'])
    const slot = c.slots[i], file = m.files[slot.fileIndex], e = parseNativeCreationEnvelope(row.envelope, c.sealConfig)
    check(row.fileIndex === slot.fileIndex && e.sealPackageId === c.nativeOriginalPackageId && e.contentId === c.contentId
      && e.kind === slot.kind && e.name === slot.name && e.nonce === slot.nonce && e.contentHash === file.contentHash
      && e.mimeType === file.mimeType && e.fileName === file.fileName, 'ENVELOPE_MAPPING')
  })
  return rows
}
/** Canonical producer adapter for the existing uploader, never an alternate
 * storage payment/signing implementation. It uses its own explicit schema and
 * Native policy; legacy saved contexts keep their original crypto/controller.
 * Preparation has zero prompts. Cold unlock requires a proved parent binding. */
export function createNativeWalrusBatchSealProtector(params: {
  context: NativeBatchSealContext; wallet: ContentAppendCryptoWallet; lifetime: WalrusBatchLifetime
}) {
  const c = parseNativeBatchSealContext(params.context), wallet = { ...params.wallet }, life = { ...params.lifetime }
  let state: 'NEW' | 'PREPARING' | 'READY' | 'FAILED' = 'NEW', rows: NativeBatchEnvelope[] | null = null, preparedHash: string | null = null
  const step = <T>(signal: AbortSignal, run: () => Promise<T>, discard?: (value: T) => void) => walrusBatchStep(c.scope, {
    ...life, signal: AbortSignal.any([life.signal, wallet.signal, signal]),
    isCurrent: () => life.isCurrent() && wallet.getAddress() === c.scope.owner,
  }, run, discard)
  async function chain(signal: AbortSignal) {
    const ids = await step(signal, () => Promise.all([wallet.client.core.getChainIdentifier(), wallet.sealClient.core.getChainIdentifier()]))
    check(ids.every(id => id.chainIdentifier === MAINNET_GENESIS_DIGEST), 'CHAIN')
  }
  async function seal(signal: AbortSignal) {
    await chain(signal)
    const client = new SealClient({ suiClient: wallet.sealClient, serverConfigs: c.sealConfig.serverConfigs, verifyKeyServers: true, timeout: 10000 })
    await step(signal, () => client.getKeyServers()); return client
  }
  const protector: WalrusBatchProtector = {
    async protect(input) {
      check(state === 'NEW', 'ALREADY_USED'); state = 'PREPARING'
      const raw = new Uint8Array(input.plaintext); let value: any
      try {
        const m = manifestFor(c, input.manifest), hash = walrusBatchJsonHash(m)
        check(raw.length > 0 && raw.length <= maxPrivate && input.contextHash === hash, 'PRIVATE_BINDING')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(raw); value = JSON.parse(text)
        walrusBatchKeys(value, ['schema', 'manifestHash', 'materials'])
        check(text === JSON.stringify(value) && value.schema === 'soulidity.walrus-batch-private.v1' && value.manifestHash === hash
          && Array.isArray(value.materials) && value.materials.length === c.slots.length, 'PRIVATE_BINDING')
        value.materials.forEach((entry: any, i: number) => {
          walrusBatchKeys(entry, ['index', 'material']); walrusBatchKeys(entry.material, ['version', 'dek', 'iv', 'contentHash', 'mimeType', 'fileName'])
          const file = m.files[c.slots[i].fileIndex], material = entry.material
          check(entry.index === file.index && material.version === 1 && material.contentHash === file.contentHash
            && material.mimeType === file.mimeType && material.fileName === file.fileName, 'PRIVATE_FILE')
          const key = walrusBatchBase64(material.dek, 32), iv = walrusBatchBase64(material.iv, 12)
          try { check(key.length === 32 && iv.length === 12, 'PRIVATE_KEY') } finally { key.fill(0); iv.fill(0) }
        })
        const client = await seal(input.signal), envelopes: NativeBatchEnvelope[] = []
        for (const [i, slot] of c.slots.entries()) {
          const material = value.materials[i].material, dek = fromBase64(material.dek), iv = fromBase64(material.iv)
          try {
            const envelope = await encryptNativeCreationEnvelope({ sealPackageId: c.nativeOriginalPackageId, contentId: c.contentId,
              kind: slot.kind, name: slot.name, nonce: slot.nonce, contentHash: material.contentHash, mimeType: material.mimeType,
              fileName: material.fileName, dek, iv, config: c.sealConfig, signal: input.signal,
              encrypt: args => step(input.signal, () => client.encrypt(args), result => result.key.fill(0)) })
            envelopes.push({ fileIndex: slot.fileIndex, envelope })
          } finally { dek.fill(0); iv.fill(0) }
        }
        const wrapped = await step(input.signal, () => client.encrypt({ packageId: c.nativeOriginalPackageId,
          id: deriveContentUploadRecoveryId(recoveryScope(c, m)), data: raw, threshold: c.sealConfig.threshold, aad: aad(c, hash) }), result => result.key.fill(0))
        try {
          verifyNativeBatchProtection(c, m, { contextHash: hash, encrypted: toBase64(wrapped.encryptedObject) })
          await chain(input.signal); rows = verifyNativeBatchEnvelopes(c, m, envelopes); preparedHash = hash; state = 'READY'
          return new Uint8Array(wrapped.encryptedObject)
        } finally { wrapped.key.fill(0) }
      } finally {
        raw.fill(0); if (state === 'PREPARING') state = 'FAILED'
        if (Array.isArray(value?.materials)) for (const e of value.materials) if (e?.material) { e.material.dek = ''; e.material.iv = '' }
      }
    },
    async verify(input) { await step(input.signal, async () => { verifyNativeBatchProtection(c, input.manifest, input.protection) }) },
  }
  return {
    protector,
    envelopes(hash: string) { check(state === 'READY' && rows && preparedHash === hash, 'ENVELOPES_NOT_READY'); return structuredClone(rows) },
    async unlock(input: { manifest: WalrusBatchManifest; protection: WalrusBatchProtection; signal: AbortSignal },
      expected: { contextHash: string; protectionHash: string }) {
      const m = manifestFor(c, input.manifest), p = verifyNativeBatchProtection(c, m, input.protection)
      check(walrusBatchJsonHash(c) === expected.contextHash && walrusBatchJsonHash(p) === expected.protectionHash, 'PARENT_BINDING')
      const client = await seal(input.signal), tx = buildNativeCreationRecoveryApproval(c.nativeCallablePackageId, recoveryScope(c, m))
      const bytes = await step(input.signal, () => tx.build({ client: wallet.client, onlyTransactionKind: true }))
      const session = await step(input.signal, () => SessionKey.create({ address: c.scope.owner, packageId: c.nativeOriginalPackageId,
        ttlMin: c.sealConfig.ttlMin, suiClient: wallet.sealClient }))
      await chain(input.signal)
      const signature = await step(input.signal, () => wallet.signPersonalMessage(session.getPersonalMessage()))
      await step(input.signal, () => session.setPersonalMessageSignature(signature)); await chain(input.signal)
      return step(input.signal, () => client.decrypt({ data: fromBase64(p.encrypted), sessionKey: session, txBytes: bytes,
        checkShareConsistency: true }), result => result.fill(0))
    },
  }
}
