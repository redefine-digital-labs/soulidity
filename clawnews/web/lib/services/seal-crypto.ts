import type { SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type { AccessPolicyDescriptor } from '@/lib/services/seal'
import { suiClient, type SealEnvelopeSidecar } from '@soulidity/sdk'

const AES_GCM_ALGORITHM = 'AES-GCM'
const AES_GCM_CIPHER_LABEL = 'AES-GCM-256'
const CONTENT_HASH_HEX_PATTERN = /^[0-9a-f]{64}$/
const DEK_BYTES = 32
const CONTENT_HASH_BYTES = 32
const IV_BYTES = 12
const DOCUMENT_ID_NONCE_BYTES = 16
const DOCUMENT_ID_DOMAIN = 'soul-seal:'
const DOCUMENT_ID_VERSION = 0x01
const MEMORY_DOCUMENT_ID_DOMAIN = 'soul-memory:'
const MEMORY_DOCUMENT_ID_NONCE = new Uint8Array(16).fill(0x4d)
const SKILL_DOCUMENT_ID_DOMAIN = 'soul-skill:'
const SKILL_DOCUMENT_ID_NONCE = new Uint8Array(16).fill(0x5a)
const ASSET_DOCUMENT_ID_DOMAIN = 'soul-asset:'
const ASSET_DOCUMENT_ID_NONCE = new Uint8Array(16).fill(0x5a)
const CONTENT_DOCUMENT_ID_DOMAIN = 'soul-content:'
const MAX_ENCRYPTED_DEK_BASE64_LENGTH = 16 * 1024
const DOCUMENT_ID_DOMAIN_SPECS = [
  { domain: DOCUMENT_ID_DOMAIN, minSuffixBytes: 32 + DOCUMENT_ID_NONCE_BYTES },
  { domain: MEMORY_DOCUMENT_ID_DOMAIN, minSuffixBytes: 32 + 8 + MEMORY_DOCUMENT_ID_NONCE.length },
  { domain: SKILL_DOCUMENT_ID_DOMAIN, minSuffixBytes: 32 + 1 + 8 + SKILL_DOCUMENT_ID_NONCE.length },
  { domain: ASSET_DOCUMENT_ID_DOMAIN, minSuffixBytes: 32 + 1 + 8 + ASSET_DOCUMENT_ID_NONCE.length },
  { domain: CONTENT_DOCUMENT_ID_DOMAIN, minSuffixBytes: 4 + 32 + 1 + 8 + DOCUMENT_ID_NONCE_BYTES },
] as const

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

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function u64ToBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('u64 value must be a non-negative safe integer')
  }
  const bytes = new Uint8Array(8)
  let remaining = BigInt(value)
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
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
  if (value.length === 0) return false
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
    { name: AES_GCM_ALGORITHM, length: 256 },
    false,
    usage,
  )
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', toCryptoBytes(data))
  return stripHexPrefix(bytesToHex(new Uint8Array(digest)))
}

function normalizeSuiHex(value: string): string {
  return stripHexPrefix(normalizeSuiAddress(value)).toLowerCase()
}

function isValidDocumentIdForDomains(
  value: string,
  specs: readonly { domain: string; minSuffixBytes: number }[],
): boolean {
  if (!value.startsWith('0x')) return false
  const hex = stripHexPrefix(value)
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return false
  }

  const bytes = hexToBytes(value)
  for (const spec of specs) {
    const domainBytes = new TextEncoder().encode(spec.domain)
    const minimumLength = domainBytes.length + 1 + spec.minSuffixBytes
    if (bytes.length < minimumLength) continue
    let domainMatches = true
    for (let index = 0; index < domainBytes.length; index += 1) {
      if (bytes[index] !== domainBytes[index]) {
        domainMatches = false
        break
      }
    }
    if (domainMatches && bytes[domainBytes.length] === DOCUMENT_ID_VERSION) {
      return true
    }
  }

  return false
}

function isValidDocumentId(value: string): boolean {
  return isValidDocumentIdForDomains(value, [DOCUMENT_ID_DOMAIN_SPECS[0]])
}

function isValidSealEnvelopeDocumentId(value: string): boolean {
  return isValidDocumentIdForDomains(value, DOCUMENT_ID_DOMAIN_SPECS)
}

export function assertDocumentIdMatchesExpectedBinding(params: {
  documentId: string
  expectedSoulObjectId: string
}) {
  if (!isValidDocumentId(params.documentId)) {
    throw new Error('Seal envelope sidecar documentId is invalid')
  }

  const expectedPrefix = bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...hexToBytes(params.expectedSoulObjectId),
  ])).slice(2).toLowerCase()

  if (!stripHexPrefix(params.documentId).toLowerCase().startsWith(expectedPrefix)) {
    throw new Error('Seal documentId does not belong to the expected soul')
  }
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

export function generateSealDocumentId(
  soulObjectId: string,
  nonce?: Uint8Array,
): string {
  const soulBytes = hexToBytes(soulObjectId)
  const resolvedNonce = nonce ?? getCrypto().getRandomValues(new Uint8Array(DOCUMENT_ID_NONCE_BYTES))
  if (resolvedNonce.length !== DOCUMENT_ID_NONCE_BYTES) {
    throw new Error(`Seal document id nonce must be ${DOCUMENT_ID_NONCE_BYTES} bytes`)
  }

  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...soulBytes,
    ...resolvedNonce,
  ]))
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
  if (!isValidSealEnvelopeDocumentId(documentId)) {
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
}): Promise<{ encryptedData: Uint8Array; sidecar: SealEnvelopeSidecar }> {
  const dek = getCrypto().getRandomValues(new Uint8Array(DEK_BYTES))
  let keyMaterial: Uint8Array | null = null
  try {
    const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES))
    const documentId = generateSealDocumentId(params.accessPolicy.soulObjectId, params.nonce)
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

export async function createSealEnvelopeSidecar(params: {
  sealClient: Pick<SealClient, 'encrypt'>
  packageId: string
  soulObjectId: string
  threshold: number
  dek: Uint8Array
  iv: Uint8Array
  contentHash: string
  mimeType: string
  fileName: string
  nonce?: Uint8Array
}): Promise<SealEnvelopeSidecar> {
  if (params.dek.length !== DEK_BYTES) {
    throw new Error('Seal envelope DEK must be 32 bytes')
  }
  if (params.iv.length !== IV_BYTES) {
    throw new Error(`Seal envelope IV must be ${IV_BYTES} bytes`)
  }
  if (!CONTENT_HASH_HEX_PATTERN.test(params.contentHash)) {
    throw new Error('contentHash must be a 64-character hex string')
  }

  const keyMaterial = createSealKeyMaterial(params.dek, params.contentHash)
  try {
    const documentId = generateSealDocumentId(params.soulObjectId, params.nonce)
    const { encryptedObject } = await params.sealClient.encrypt({
      threshold: params.threshold,
      packageId: params.packageId,
      id: documentId,
      data: keyMaterial,
    })

    return {
      version: 1,
      mode: 'seal-envelope',
      documentId,
      encryptedDek: bytesToBase64(new Uint8Array(encryptedObject)),
      iv: bytesToBase64(params.iv),
      cipher: AES_GCM_CIPHER_LABEL,
      mimeType: params.mimeType,
      fileName: params.fileName,
      contentHash: params.contentHash,
    }
  } finally {
    keyMaterial.fill(0)
  }
}

export function generateSkillDocumentId(versionObjectId: string): string {
  const versionBytes = hexToBytes(versionObjectId)
  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(SKILL_DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...versionBytes,
    ...SKILL_DOCUMENT_ID_NONCE,
  ]))
}

export function generateMemoryDocumentId(memoryObjectId: string, timestampKey: number): string {
  const memoryBytes = hexToBytes(memoryObjectId)
  const timestampBytes = u64ToBytes(timestampKey)
  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(MEMORY_DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...memoryBytes,
    ...timestampBytes,
    ...MEMORY_DOCUMENT_ID_NONCE,
  ]))
}

export function generateAssetDocumentIdForVersion(
  assetsObjectId: string,
  assetName: string,
  versionIndex: number,
): string {
  if (!assetName.trim()) {
    throw new Error('assetName is required')
  }

  const assetsBytes = hexToBytes(assetsObjectId)
  const assetNameBytes = new TextEncoder().encode(assetName.trim())
  const versionBytes = u64ToBytes(versionIndex)
  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(ASSET_DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...assetsBytes,
    ...assetNameBytes,
    0x00,
    ...versionBytes,
    ...ASSET_DOCUMENT_ID_NONCE,
  ]))
}

export function generateSkillDocumentIdForVersion(
  skillsObjectId: string,
  skillName: string,
  versionIndex: number,
): string {
  if (!skillName.trim()) {
    throw new Error('skillName is required')
  }

  const skillsBytes = hexToBytes(skillsObjectId)
  const skillNameBytes = new TextEncoder().encode(skillName.trim())
  const versionBytes = u64ToBytes(versionIndex)
  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(SKILL_DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...skillsBytes,
    ...skillNameBytes,
    0x00,
    ...versionBytes,
    ...SKILL_DOCUMENT_ID_NONCE,
  ]))
}

export async function createMemoryEntrySealEnvelopeSidecar(params: {
  sealClient: Pick<SealClient, 'encrypt'>
  packageId: string
  memoryObjectId: string
  timestampKey: number
  threshold: number
  dek: Uint8Array
  iv: Uint8Array
  contentHash: string
  mimeType: string
  fileName: string
}): Promise<SealEnvelopeSidecar> {
  if (params.dek.length !== DEK_BYTES) {
    throw new Error('Seal envelope DEK must be 32 bytes')
  }
  if (params.iv.length !== IV_BYTES) {
    throw new Error(`Seal envelope IV must be ${IV_BYTES} bytes`)
  }
  if (!CONTENT_HASH_HEX_PATTERN.test(params.contentHash)) {
    throw new Error('contentHash must be a 64-character hex string')
  }

  const keyMaterial = createSealKeyMaterial(params.dek, params.contentHash)
  try {
    const documentId = generateMemoryDocumentId(params.memoryObjectId, params.timestampKey)
    const { encryptedObject } = await params.sealClient.encrypt({
      threshold: params.threshold,
      packageId: params.packageId,
      id: documentId,
      data: keyMaterial,
    })

    return {
      version: 1,
      mode: 'seal-envelope',
      documentId,
      encryptedDek: bytesToBase64(new Uint8Array(encryptedObject)),
      iv: bytesToBase64(params.iv),
      cipher: AES_GCM_CIPHER_LABEL,
      mimeType: params.mimeType,
      fileName: params.fileName,
      contentHash: params.contentHash,
    }
  } finally {
    keyMaterial.fill(0)
  }
}

export async function createSkillVersionSealEnvelopeSidecar(params: {
  sealClient: Pick<SealClient, 'encrypt'>
  packageId: string
  skillsObjectId: string
  skillName: string
  versionIndex: number
  threshold: number
  dek: Uint8Array
  iv: Uint8Array
  contentHash: string
  mimeType: string
  fileName: string
}): Promise<SealEnvelopeSidecar> {
  if (params.dek.length !== DEK_BYTES) {
    throw new Error('Seal envelope DEK must be 32 bytes')
  }
  if (params.iv.length !== IV_BYTES) {
    throw new Error(`Seal envelope IV must be ${IV_BYTES} bytes`)
  }
  if (!CONTENT_HASH_HEX_PATTERN.test(params.contentHash)) {
    throw new Error('contentHash must be a 64-character hex string')
  }

  const keyMaterial = createSealKeyMaterial(params.dek, params.contentHash)
  try {
    const documentId = generateSkillDocumentIdForVersion(
      params.skillsObjectId,
      params.skillName,
      params.versionIndex,
    )
    const { encryptedObject } = await params.sealClient.encrypt({
      threshold: params.threshold,
      packageId: params.packageId,
      id: documentId,
      data: keyMaterial,
    })

    return {
      version: 1,
      mode: 'seal-envelope',
      documentId,
      encryptedDek: bytesToBase64(new Uint8Array(encryptedObject)),
      iv: bytesToBase64(params.iv),
      cipher: AES_GCM_CIPHER_LABEL,
      mimeType: params.mimeType,
      fileName: params.fileName,
      contentHash: params.contentHash,
    }
  } finally {
    keyMaterial.fill(0)
  }
}

export async function createAssetVersionSealEnvelopeSidecar(params: {
  sealClient: Pick<SealClient, 'encrypt'>
  packageId: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
  threshold: number
  dek: Uint8Array
  iv: Uint8Array
  contentHash: string
  mimeType: string
  fileName: string
}): Promise<SealEnvelopeSidecar> {
  if (params.dek.length !== DEK_BYTES) {
    throw new Error('Seal envelope DEK must be 32 bytes')
  }
  if (params.iv.length !== IV_BYTES) {
    throw new Error(`Seal envelope IV must be ${IV_BYTES} bytes`)
  }
  if (!CONTENT_HASH_HEX_PATTERN.test(params.contentHash)) {
    throw new Error('contentHash must be a 64-character hex string')
  }

  const keyMaterial = createSealKeyMaterial(params.dek, params.contentHash)
  try {
    const documentId = generateAssetDocumentIdForVersion(
      params.assetsObjectId,
      params.assetName,
      params.versionIndex,
    )
    const { encryptedObject } = await params.sealClient.encrypt({
      threshold: params.threshold,
      packageId: params.packageId,
      id: documentId,
      data: keyMaterial,
    })

    return {
      version: 1,
      mode: 'seal-envelope',
      documentId,
      encryptedDek: bytesToBase64(new Uint8Array(encryptedObject)),
      iv: bytesToBase64(params.iv),
      cipher: AES_GCM_CIPHER_LABEL,
      mimeType: params.mimeType,
      fileName: params.fileName,
      contentHash: params.contentHash,
    }
  } finally {
    keyMaterial.fill(0)
  }
}

export async function decryptBundle(params: {
  sealClient: Pick<SealClient, 'decrypt'>
  sessionKey: SessionKey
  txBytes: Uint8Array
  encryptedData: Uint8Array
  sidecar: SealEnvelopeSidecar
  expectedSoulObjectId: string
}): Promise<Uint8Array> {
  const sidecar = parseSealEnvelopeSidecar(params.sidecar)
  assertDocumentIdMatchesExpectedBinding({
    documentId: sidecar.documentId,
    expectedSoulObjectId: params.expectedSoulObjectId,
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
  soulAllowlistCapObjectId?: string | null
}): Promise<Uint8Array> {
  assertDocumentIdMatchesExpectedBinding({
    documentId: params.documentId,
    expectedSoulObjectId: params.accessPolicy.soulObjectId,
  })

  const tx = new Transaction()
  const target = `${params.accessPolicy.packageId}::${params.accessPolicy.moduleName}::${params.accessPolicy.functionName}`
  const documentIdArg = tx.pure.vector('u8', Array.from(hexToBytes(params.documentId)))
  const soulIdArg = tx.pure.id(params.accessPolicy.soulObjectId)
  let argumentsForCall

  if (params.accessPolicy.functionName === 'seal_approve_owner_in_personal_kiosk') {
    if (!params.accessPolicy.currentKioskId) {
      throw new Error('currentKioskId is required for owner Seal approval')
    }
    if (!params.accessPolicy.currentKioskCapOnChainId) {
      throw new Error('currentKioskCapOnChainId is required for owner Seal approval')
    }
    argumentsForCall = [
      documentIdArg,
      tx.object(params.accessPolicy.currentKioskId),
      tx.object(params.accessPolicy.currentKioskCapOnChainId),
      soulIdArg,
    ]
  } else if (params.accessPolicy.functionName === 'seal_approve_allowlisted') {
    if (!params.accessPolicy.allowlistRegistryObjectId) {
      throw new Error('allowlistRegistryObjectId is required for allowlisted Seal approval')
    }
    if (!params.soulAllowlistCapObjectId) {
      throw new Error('soulAllowlistCapObjectId is required for allowlisted Seal approval')
    }
    argumentsForCall = [
      documentIdArg,
      tx.object(params.accessPolicy.allowlistRegistryObjectId),
      soulIdArg,
      tx.object(params.soulAllowlistCapObjectId),
    ]
  } else {
    throw new Error(`Unknown Seal approval function: ${params.accessPolicy.functionName}`)
  }

  tx.moveCall({
    target,
    arguments: argumentsForCall,
  })

  return tx.build({
    client: suiClient,
    onlyTransactionKind: true,
  })
}

export function isSealDocumentIdBoundToSoul(documentId: string, soulObjectId: string): boolean {
  try {
    assertDocumentIdMatchesExpectedBinding({
      documentId,
      expectedSoulObjectId: normalizeSuiHex(soulObjectId),
    })
    return true
  } catch {
    return false
  }
}
