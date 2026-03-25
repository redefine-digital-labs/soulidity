import type { SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { AccessPolicyDescriptor } from '@web/lib/services/seal'
import { suiClient } from '@web/lib/sui'

const AES_GCM_ALGORITHM = 'AES-GCM'
const AES_GCM_CIPHER_LABEL = 'AES-GCM-256'
const CONTENT_HASH_HEX_PATTERN = /^[0-9a-f]{64}$/
const DEK_BYTES = 32
const CONTENT_HASH_BYTES = 32
const IV_BYTES = 12
const DOCUMENT_ID_NONCE_BYTES = 16
const DOCUMENT_ID_MIN_BYTES = DOCUMENT_ID_NONCE_BYTES + 1
const MAX_ENCRYPTED_DEK_BASE64_LENGTH = 16 * 1024

export interface SealEnvelopeSidecar {
  version: 1
  mode: 'seal-envelope'
  documentId: string
  encryptedDek: string
  iv: string
  cipher: 'AES-GCM-256'
  mimeType: string
  fileName: string
  contentHash: string
}

function getCrypto(): Crypto {
  const cryptoInstance = globalThis.crypto
  if (!cryptoInstance?.subtle) {
    throw new Error('Web Crypto is not available in this runtime')
  }

  return cryptoInstance
}

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value
}

function hexToBytes(value: string): Uint8Array {
  const hex = stripHexPrefix(value)
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('Invalid hex string')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16)
  }

  return bytes
}

function isValidDocumentId(value: string): boolean {
  if (!value.startsWith('0x')) {
    return false
  }

  const hex = stripHexPrefix(value)
  return (
    hex.length > 0 &&
    hex.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(hex) &&
    hex.length / 2 > DOCUMENT_ID_NONCE_BYTES &&
    hex.length / 2 >= DOCUMENT_ID_MIN_BYTES
  )
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function padBase64(value: string): string {
  const remainder = value.length % 4
  return remainder === 0 ? value : value + '='.repeat(4 - remainder)
}

function base64ToBytes(value: string): Uint8Array {
  const normalizedValue = padBase64(value)
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalizedValue, 'base64'))
  }

  const binary = atob(normalizedValue)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function isValidBase64(value: string): boolean {
  if (value.length === 0) {
    return false
  }

  const normalizedValue = padBase64(value)
  return (
    normalizedValue.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalizedValue)
  )
}

function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
}

async function importAesKey(rawKey: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    'raw',
    toCryptoBytes(rawKey),
    {
      name: AES_GCM_ALGORITHM,
      length: 256,
    },
    false,
    usage,
  )
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', toCryptoBytes(data))
  return stripHexPrefix(bytesToHex(new Uint8Array(digest)))
}

export function createSealKeyMaterial(dek: Uint8Array, contentHash: string): Uint8Array {
  const contentHashBytes = hexToBytes(contentHash)
  if (contentHashBytes.length !== CONTENT_HASH_BYTES) {
    throw new Error('Seal envelope content hash must be 32 bytes')
  }

  const keyMaterial = new Uint8Array(DEK_BYTES + CONTENT_HASH_BYTES)
  keyMaterial.set(dek, 0)
  keyMaterial.set(contentHashBytes, DEK_BYTES)
  return keyMaterial
}

function assertDocumentIdMatchesExpectedBinding(params: {
  documentId: string
  expectedSeriesObjectId: string
  expectedReleaseObjectId?: string | null
}) {
  if (!isValidDocumentId(params.documentId)) {
    throw new Error('Seal envelope sidecar documentId is invalid')
  }

  if (params.expectedReleaseObjectId) {
    if (!isSealDocumentIdBoundToRelease(
      params.documentId,
      params.expectedSeriesObjectId,
      params.expectedReleaseObjectId,
    )) {
      throw new Error('Seal documentId does not belong to the expected release')
    }
    return
  }

  if (!isSealDocumentIdInSeriesNamespace(params.documentId, params.expectedSeriesObjectId)) {
    throw new Error('Seal documentId does not belong to the expected series')
  }
}

export function generateSealDocumentId(
  seriesObjectId: string,
  nonce?: Uint8Array,
  releaseObjectId?: string | null,
): string {
  const seriesBytes = hexToBytes(seriesObjectId)
  const releaseBytes = releaseObjectId ? hexToBytes(releaseObjectId) : null
  const resolvedNonce = nonce ?? getCrypto().getRandomValues(new Uint8Array(DOCUMENT_ID_NONCE_BYTES))
  if (resolvedNonce.length !== DOCUMENT_ID_NONCE_BYTES) {
    throw new Error(`Seal document id nonce must be ${DOCUMENT_ID_NONCE_BYTES} bytes`)
  }

  return bytesToHex(new Uint8Array([
    ...seriesBytes,
    ...(releaseBytes ?? []),
    ...resolvedNonce,
  ]))
}

export function isSealDocumentIdInSeriesNamespace(
  documentId: string,
  seriesObjectId: string,
): boolean {
  if (!isValidDocumentId(documentId)) {
    return false
  }

  try {
    const normalizedSeriesObjectId = normalizeSuiAddress(seriesObjectId)
    return stripHexPrefix(documentId).toLowerCase().startsWith(
      stripHexPrefix(normalizedSeriesObjectId).toLowerCase(),
    )
  } catch {
    return false
  }
}

export function isSealDocumentIdBoundToRelease(
  documentId: string,
  seriesObjectId: string,
  releaseObjectId: string,
): boolean {
  if (!isValidDocumentId(documentId)) {
    return false
  }

  try {
    const documentHex = stripHexPrefix(documentId).toLowerCase()
    const normalizedSeriesObjectId = stripHexPrefix(normalizeSuiAddress(seriesObjectId)).toLowerCase()
    const normalizedReleaseObjectId = stripHexPrefix(normalizeSuiAddress(releaseObjectId)).toLowerCase()

    return documentHex.startsWith(normalizedSeriesObjectId + normalizedReleaseObjectId)
  } catch {
    return false
  }
}

export function parseSealEnvelopeSidecar(value: unknown): SealEnvelopeSidecar {
  if (!value || typeof value !== 'object') {
    throw new Error('Seal envelope sidecar must be an object')
  }

  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || candidate.mode !== 'seal-envelope') {
    throw new Error('Unsupported Seal envelope sidecar version')
  }

  const documentId = typeof candidate.documentId === 'string' ? candidate.documentId : ''
  const encryptedDek = typeof candidate.encryptedDek === 'string' ? candidate.encryptedDek : ''
  const iv = typeof candidate.iv === 'string' ? candidate.iv : ''
  const cipher = candidate.cipher
  const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType : ''
  const fileName = typeof candidate.fileName === 'string' ? candidate.fileName : ''
  const contentHash = typeof candidate.contentHash === 'string' ? candidate.contentHash.toLowerCase() : ''

  if (!documentId || !encryptedDek || !iv || !cipher || !mimeType || !fileName || !contentHash) {
    throw new Error('Seal envelope sidecar is missing required fields')
  }
  if (cipher !== AES_GCM_CIPHER_LABEL) {
    throw new Error('Unsupported Seal envelope cipher')
  }
  if (!isValidDocumentId(documentId)) {
    throw new Error('Seal envelope sidecar documentId is invalid')
  }
  if (encryptedDek.length > MAX_ENCRYPTED_DEK_BASE64_LENGTH) {
    throw new Error('Seal envelope sidecar encryptedDek exceeds the size limit')
  }
  if (!isValidBase64(encryptedDek)) {
    throw new Error('Seal envelope sidecar encryptedDek is invalid base64')
  }
  if (!isValidBase64(iv)) {
    throw new Error('Seal envelope sidecar iv is invalid base64')
  }
  if (base64ToBytes(iv).length !== IV_BYTES) {
    throw new Error(`Seal envelope sidecar iv must decode to ${IV_BYTES} bytes`)
  }
  if (!CONTENT_HASH_HEX_PATTERN.test(contentHash)) {
    throw new Error('contentHash must be a 64-character hex string')
  }

  return {
    version: 1,
    mode: 'seal-envelope',
    documentId,
    encryptedDek,
    iv,
    cipher: AES_GCM_CIPHER_LABEL,
    mimeType,
    fileName,
    contentHash,
  }
}

export async function encryptBundle(params: {
  sealClient: Pick<SealClient, 'encrypt'>
  accessPolicy: AccessPolicyDescriptor
  data: Uint8Array
  threshold: number
  mimeType: string
  fileName: string
  nonce?: Uint8Array
  releaseObjectId?: string | null
}): Promise<{ encryptedData: Uint8Array; sidecar: SealEnvelopeSidecar }> {
  const dek = getCrypto().getRandomValues(new Uint8Array(DEK_BYTES))
  let keyMaterial: Uint8Array | null = null
  try {
    const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES))
    const releaseObjectId =
      params.accessPolicy.functionName === 'seal_approve_perpetual'
        ? params.releaseObjectId
        : null
    if (params.accessPolicy.functionName === 'seal_approve_perpetual' && !releaseObjectId) {
      throw new Error('releaseObjectId is required for perpetual Seal encryption')
    }
    const documentId = generateSealDocumentId(
      params.accessPolicy.seriesObjectId,
      params.nonce,
      releaseObjectId,
    )
    const contentHash = await sha256Hex(params.data)
    const key = await importAesKey(dek, ['encrypt'])
    const encryptedData = new Uint8Array(
      await getCrypto().subtle.encrypt(
        { name: AES_GCM_ALGORITHM, iv: toCryptoBytes(iv) },
        key,
        toCryptoBytes(params.data),
      ),
    )
    keyMaterial = createSealKeyMaterial(dek, contentHash)

    const { encryptedObject } = await params.sealClient.encrypt({
      threshold: params.threshold,
      packageId: params.accessPolicy.packageId,
      id: documentId,
      data: keyMaterial,
    })

    return {
      encryptedData,
      sidecar: {
        version: 1,
        mode: 'seal-envelope',
        documentId,
        encryptedDek: bytesToBase64(new Uint8Array(encryptedObject)),
        iv: bytesToBase64(iv),
        cipher: AES_GCM_CIPHER_LABEL,
        mimeType: params.mimeType,
        fileName: params.fileName,
        contentHash,
      },
    }
  } finally {
    keyMaterial?.fill(0)
    dek.fill(0)
  }
}

/**
 * Callers own the returned plaintext buffer and should zero it after use.
 */
export async function decryptBundle(params: {
  sealClient: Pick<SealClient, 'decrypt'>
  sessionKey: SessionKey
  txBytes: Uint8Array
  encryptedData: Uint8Array
  sidecar: SealEnvelopeSidecar
  expectedSeriesObjectId: string
  expectedReleaseObjectId?: string | null
}): Promise<Uint8Array> {
  const sidecar = parseSealEnvelopeSidecar(params.sidecar)
  assertDocumentIdMatchesExpectedBinding({
    documentId: sidecar.documentId,
    expectedSeriesObjectId: params.expectedSeriesObjectId,
    expectedReleaseObjectId: params.expectedReleaseObjectId,
  })

  const keyMaterial = new Uint8Array(
    await params.sealClient.decrypt({
      data: base64ToBytes(sidecar.encryptedDek),
      sessionKey: params.sessionKey,
      txBytes: params.txBytes,
    }),
  )
  let plaintext: Uint8Array | null = null
  try {
    if (keyMaterial.length !== DEK_BYTES + CONTENT_HASH_BYTES) {
      throw new Error('Seal envelope key material is invalid')
    }
    if (sidecar.cipher !== AES_GCM_CIPHER_LABEL) {
      throw new Error('Unsupported Seal envelope cipher')
    }

    const dek = keyMaterial.subarray(0, DEK_BYTES)
    const boundContentHash = stripHexPrefix(bytesToHex(keyMaterial.subarray(DEK_BYTES))).toLowerCase()
    if (boundContentHash !== sidecar.contentHash.toLowerCase()) {
      throw new Error('Seal envelope content hash binding mismatch')
    }

    const key = await importAesKey(dek, ['decrypt'])
    plaintext = new Uint8Array(
      await getCrypto().subtle.decrypt(
        { name: AES_GCM_ALGORITHM, iv: toCryptoBytes(base64ToBytes(sidecar.iv)) },
        key,
        toCryptoBytes(params.encryptedData),
      ),
    )

    if ((await sha256Hex(plaintext)) !== boundContentHash) {
      throw new Error('Seal envelope content hash mismatch')
    }

    const result = plaintext
    plaintext = null
    return result
  } finally {
    plaintext?.fill(0)
    keyMaterial.fill(0)
  }
}

export async function buildSealApprovalTxBytes(params: {
  accessPolicy: AccessPolicyDescriptor
  documentId: string
  passObjectId: string
  releaseObjectId?: string | null
  clockObjectId?: string | null
}): Promise<Uint8Array> {
  const tx = new Transaction()
  const target =
    `${params.accessPolicy.packageId}::${params.accessPolicy.moduleName}::${params.accessPolicy.functionName}`

  if (params.accessPolicy.functionName === 'seal_approve_perpetual') {
    if (!params.releaseObjectId) {
      throw new Error('releaseObjectId is required for perpetual Seal approval')
    }
    assertDocumentIdMatchesExpectedBinding({
      documentId: params.documentId,
      expectedSeriesObjectId: params.accessPolicy.seriesObjectId,
      expectedReleaseObjectId: params.releaseObjectId,
    })

    tx.moveCall({
      target,
      arguments: [
        tx.pure.vector('u8', Array.from(hexToBytes(params.documentId))),
        tx.object(params.passObjectId),
        tx.object(params.releaseObjectId),
        tx.object(params.accessPolicy.seriesObjectId),
      ],
    })
  } else {
    assertDocumentIdMatchesExpectedBinding({
      documentId: params.documentId,
      expectedSeriesObjectId: params.accessPolicy.seriesObjectId,
    })

    tx.moveCall({
      target,
      arguments: [
        tx.pure.vector('u8', Array.from(hexToBytes(params.documentId))),
        tx.object(params.passObjectId),
        tx.object(params.accessPolicy.seriesObjectId),
        tx.object(params.clockObjectId ?? '0x6'),
      ],
    })
  }

  return tx.build({
    client: suiClient,
    onlyTransactionKind: true,
  })
}
