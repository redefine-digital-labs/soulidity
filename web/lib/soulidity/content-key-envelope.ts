import type { SealClient } from '@mysten/seal'
import { fromHex, toBase64 } from '@mysten/sui/utils'
import { generateContentDocumentIdHex, type SealEnvelopeSidecar } from '@soulidity/sdk'
import { CONTENT_ENVELOPE_SCHEMA, encodeContentEnvelope } from './content-envelope'
import { assertBrowserContentSealObject, validateBrowserContentSealConfig, type BrowserContentSealConfig } from './browser-content-open'

/** Shared local encryption primitive. The caller owns the lifecycle-aware Seal
 * client; this helper never requests an author or transaction signature. */
export async function encryptContentKeyEnvelope(params: {
  originalPackageId: string; contentObjectId: string; kind: number; name: string; versionIndex: string
  config: BrowserContentSealConfig; contentHash: string; dek: Uint8Array; iv: Uint8Array
  mimeType: string; fileName: string
  encrypt: SealClient['encrypt']
}): Promise<SealEnvelopeSidecar & { sealPackageId: string }> {
  const { originalPackageId, contentObjectId, kind, name, versionIndex, contentHash, mimeType, fileName, encrypt } = params
  const config = validateBrowserContentSealConfig(params.config), dek = new Uint8Array(params.dek), iv = new Uint8Array(params.iv)
  let material: Uint8Array | undefined
  const check = (value: unknown) => { if (!value) throw new Error('CONTENT_KEY_ENVELOPE_INVALID') }
  try {
    check(/^0x[0-9a-f]{64}$/.test(originalPackageId) && !/^0x0+$/.test(originalPackageId)
      && /^0x[0-9a-f]{64}$/.test(contentObjectId) && !/^0x0+$/.test(contentObjectId)
      && /^[0-9a-f]{64}$/.test(contentHash) && dek.length === 32 && iv.length === 12
      && Number.isInteger(kind) && kind >= 0 && kind <= 0xffffffff && /^[a-z0-9_-]{1,32}$/.test(name)
      && (kind !== 0 || name === 'soul') && (kind !== 1 || name === 'default')
      && /^(0|[1-9][0-9]{0,19})$/.test(versionIndex) && BigInt(versionIndex) <= 18446744073709551615n
      && typeof mimeType === 'string' && mimeType.length > 0 && mimeType.length <= 1024
      && typeof fileName === 'string' && fileName.length > 0 && fileName.length <= 4096)
    material = new Uint8Array(64); material.set(dek); material.set(fromHex(contentHash), 32)
    const documentId = generateContentDocumentIdHex({ contentObjectId, kind, name, versionIndex: BigInt(versionIndex) })
    const wrapped = await encrypt({ packageId: originalPackageId, id: documentId, threshold: config.threshold, data: material })
    try {
      assertBrowserContentSealObject(wrapped.encryptedObject, { packageId: originalPackageId, documentId, config, plaintextByteLength: 64 })
      const sidecar = { version: 1 as const, mode: 'seal-envelope' as const, sealPackageId: originalPackageId,
        documentId, encryptedDek: toBase64(wrapped.encryptedObject), iv: toBase64(iv), cipher: 'AES-GCM-256' as const,
        mimeType, fileName, contentHash }
      // Only validates the public sidecar. No allocated Blob is claimed here.
      encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, contentObjectId, kind, name, versionIndex,
        blobObjectId: contentObjectId, sidecar }, originalPackageId)
      return sidecar
    } finally { wrapped.key.fill(0) }
  } finally { material?.fill(0); dek.fill(0) }
}
