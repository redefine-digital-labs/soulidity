import type { SealClient } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { fromHex, toBase64, toHex } from '@mysten/sui/utils'
import { walrusBatchAddress, walrusBatchBase64, walrusBatchKeys } from '../upload/walrus-batch-preparation'
import type { WalrusBatchFileManifest } from '../upload/walrus-batch-preparation'
import { deriveContentUploadRecoveryId, type ContentUploadRecoveryScope } from '@soulidity/sdk'
import { assertBrowserContentSealObject, validateBrowserContentSealConfig, type BrowserContentSealConfig } from './browser-content-open'
import { nativeCreationSealNamespace, nativeContentSealNamespace, type NativeCreationContent } from './native-creation-transaction'

export interface NativeCreationEnvelope {
  schema: 'soulidity.native-content-envelope.v1'
  sealPackageId: string
  contentId: string
  kind: number
  name: string
  nonce: string
  documentId: string
  encryptedDek: string
  iv: string
  contentHash: string
  mimeType: string
  fileName: string
}
const check = (ok: unknown) => { if (!ok) throw new Error('NATIVE_CONTENT_ENVELOPE_INVALID') }
export function parseNativeCreationEnvelope(input: unknown, sealConfig: BrowserContentSealConfig, version = '0'): NativeCreationEnvelope {
  const e = structuredClone(input) as NativeCreationEnvelope
  walrusBatchKeys(e, ['schema', 'sealPackageId', 'contentId', 'kind', 'name', 'nonce', 'documentId', 'encryptedDek', 'iv', 'contentHash', 'mimeType', 'fileName'])
  const config = validateBrowserContentSealConfig(sealConfig)
  check(e.schema === 'soulidity.native-content-envelope.v1' && walrusBatchAddress(e.sealPackageId)
    && typeof e.contentHash === 'string' && /^[0-9a-f]{64}$/.test(e.contentHash)
    && typeof e.mimeType === 'string' && e.mimeType.length > 0 && e.mimeType.length <= 1024
    && typeof e.fileName === 'string' && e.fileName.length > 0 && e.fileName.length <= 4096)
  check(e.documentId === toHex(nativeContentSealNamespace(e.contentId, e.kind, e.name, e.nonce, version)))
  check(walrusBatchBase64(e.iv, 12).length === 12)
  const encrypted = walrusBatchBase64(e.encryptedDek, 128 * 1024)
  assertBrowserContentSealObject(encrypted, { packageId: e.sealPackageId, documentId: e.documentId,
    config, plaintextByteLength: 64 })
  check(new TextEncoder().encode(JSON.stringify(e)).length <= 65536)
  return e
}

/** Wrap an already encrypted file's key for the canonical Native owner/read
 * policies. No transaction or wallet signature. The parent owns actual Seal
 * clients/lifetimes and must durably save this envelope before paying storage.
 * Caller-owned key material is never mutated or returned in the envelope. */
export async function encryptNativeCreationEnvelope(input: {
  sealPackageId: string; contentId: string; kind: number; name: string; nonce: string
  contentHash: string; mimeType: string; fileName: string
  dek: Uint8Array; iv: Uint8Array; config: BrowserContentSealConfig
  signal: AbortSignal; encrypt: SealClient['encrypt']
}): Promise<NativeCreationEnvelope> {
  walrusBatchKeys(input, ['sealPackageId', 'contentId', 'kind', 'name', 'nonce', 'contentHash', 'mimeType', 'fileName', 'dek', 'iv', 'config', 'signal', 'encrypt'])
  const { dek: sourceKey, iv: sourceIv, config: sourceConfig, signal, encrypt, ...metadata } = input
  const saved = structuredClone(metadata), config = validateBrowserContentSealConfig(sourceConfig)
  const dek = new Uint8Array(sourceKey), iv = new Uint8Array(sourceIv), material = new Uint8Array(64)
  try {
    signal.throwIfAborted()
    check(walrusBatchAddress(saved.sealPackageId) && dek.length === 32 && iv.length === 12
      && typeof saved.contentHash === 'string' && /^[0-9a-f]{64}$/.test(saved.contentHash)
      && typeof saved.mimeType === 'string' && saved.mimeType.length > 0 && saved.mimeType.length <= 1024
      && typeof saved.fileName === 'string' && saved.fileName.length > 0 && saved.fileName.length <= 4096)
    const documentId = toHex(nativeCreationSealNamespace(saved.contentId, saved.kind, saved.name, saved.nonce))
    material.set(dek); material.set(fromHex(saved.contentHash), 32)
    const wrapped = await encrypt({ packageId: saved.sealPackageId, id: documentId, threshold: config.threshold, data: material })
    try {
      signal.throwIfAborted()
      return parseNativeCreationEnvelope({ schema: 'soulidity.native-content-envelope.v1', ...saved, documentId,
        encryptedDek: toBase64(wrapped.encryptedObject), iv: toBase64(iv) }, config)
    } finally { wrapped.key.fill(0) }
  } finally { material.fill(0); dek.fill(0); iv.fill(0) }
}

/** Serialize only validated public envelope bytes into birth::append_initial.
 * The record's actual Blob reference supplies ciphertext custody/availability. */
export function nativeCreationEnvelopeBytes(input: NativeCreationEnvelope, config: BrowserContentSealConfig) {
  return [...new TextEncoder().encode(JSON.stringify(parseNativeCreationEnvelope(input, config)))]
}

/** Unsigned owner-read policy PTB. Envelope parsing proves ciphertext identity,
 * not current owner authority. The on-chain policy verifies the actual stored
 * record, source binding, Account and Kiosk before approving decryption. */
export function buildNativeCreationOwnerApproval(input: {
  envelope: NativeCreationEnvelope; config: BrowserContentSealConfig
  nativeCallablePackageId: string; kioskId: string; accountId: string; rootId: string; recordIndex: string; recordVersion?: string
}) {
  const e = parseNativeCreationEnvelope(input.envelope, input.config, input.recordVersion ?? '0')
  for (const id of [input.nativeCallablePackageId, input.kioskId, input.accountId, input.rootId]) check(walrusBatchAddress(id))
  check(/^(0|[1-9][0-9]{0,19})$/.test(input.recordIndex) && BigInt(input.recordIndex) <= 18446744073709551615n)
  const tx = new Transaction()
  tx.moveCall({ target: `${input.nativeCallablePackageId}::birth::seal_approve_content_owner`, arguments: [
    tx.pure.vector('u8', fromHex(e.documentId)), tx.object(input.kioskId), tx.object(input.accountId),
    tx.pure.id(input.rootId), tx.pure.u64(input.recordIndex),
  ] })
  return tx
}

/** Convert the verified upload's ciphertext metadata into a canonical founding
 * record. Parent receipt verification must supply the actual Blob object ID;
 * this pure conversion does not certify a registration or mint success. */
export function nativeCreationContentFromUpload(input: {
  file: WalrusBatchFileManifest; registeredBlobObjectId: string
  envelope: NativeCreationEnvelope; config: BrowserContentSealConfig
  readMask: string; downloadPolicy: number; setActive: boolean
}): NativeCreationContent {
  const e = parseNativeCreationEnvelope(input.envelope, input.config), file = structuredClone(input.file)
  check(walrusBatchAddress(input.registeredBlobObjectId) && file.uploadType === 'encrypted'
    && file.contentHash === e.contentHash && file.mimeType === e.mimeType && file.fileName === e.fileName
    && typeof file.payloadHash === 'string' && /^[0-9a-f]{64}$/.test(file.payloadHash))
  return { blobObjectId: input.registeredBlobObjectId, kind: e.kind, name: e.name, readMask: input.readMask,
    downloadPolicy: input.downloadPolicy, setActive: input.setActive, sha256: file.payloadHash,
    nonce: e.nonce, envelope: nativeCreationEnvelopeBytes(e, input.config) }
}

/** Exact author-only recovery policy for the persisted pre-mint upload scope.
 * Native and legacy Content policies use the same separate recovery grammar,
 * but the callable package/module is version-specific and must remain pinned. */
export function buildNativeCreationRecoveryApproval(nativeCallablePackageId: string, scope: ContentUploadRecoveryScope) {
  check(walrusBatchAddress(nativeCallablePackageId))
  const tx = new Transaction()
  tx.moveCall({ target: `${nativeCallablePackageId}::birth::seal_approve_upload_recovery`,
    arguments: [tx.pure.vector('u8', fromHex(deriveContentUploadRecoveryId(scope)))] })
  return tx
}
