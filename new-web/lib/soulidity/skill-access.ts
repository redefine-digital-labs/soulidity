import { SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import type { SkillAccessResponse } from '@/lib/soulidity/types'

const AES_GCM_ALGORITHM = 'AES-GCM'
const AES_GCM_CIPHER = 'AES-GCM-256'
const CONTENT_HASH_BYTES = 32
const DEK_BYTES = 32
const DOCUMENT_ID_DOMAIN = 'soul-skill:'
const DOCUMENT_ID_VERSION = 0x01
const IV_BYTES = 12
const SUI_CLOCK_OBJECT_ID = '0x6'

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.startsWith('0x') ? value.slice(2) : value
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error('Invalid hex string')
  }

  const bytes = new Uint8Array(normalized.length / 2)
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array) {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function padBase64(value: string) {
  const remainder = value.length % 4
  return remainder === 0 ? value : `${value}${'='.repeat(4 - remainder)}`
}

function base64ToBytes(value: string) {
  const normalized = padBase64(value)
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'))
  }

  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function getCrypto() {
  const cryptoInstance = globalThis.crypto
  if (!cryptoInstance?.subtle) {
    throw new Error('Web Crypto is not available in this runtime')
  }
  return cryptoInstance
}

function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
}

async function sha256Hex(data: Uint8Array) {
  const digest = await getCrypto().subtle.digest('SHA-256', toCryptoBytes(data))
  return bytesToHex(new Uint8Array(digest)).slice(2).toLowerCase()
}

async function importAesKey(rawKey: Uint8Array) {
  return getCrypto().subtle.importKey(
    'raw',
    toCryptoBytes(rawKey),
    { name: AES_GCM_ALGORITHM, length: 256 },
    false,
    ['decrypt'],
  )
}

function assertSkillDocumentMatchesVersion(documentIdHex: string, versionObjectId: string) {
  const documentIdBytes = hexToBytes(documentIdHex)
  const prefix = new Uint8Array([
    ...new TextEncoder().encode(DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...hexToBytes(versionObjectId),
  ])

  if (documentIdBytes.length < prefix.length) {
    throw new Error('Skill document id is too short')
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (documentIdBytes[index] !== prefix[index]) {
      throw new Error('Skill document id does not match the requested version')
    }
  }
}

function parseSkillAccessResponse(payload: unknown): SkillAccessResponse {
  if (!isRecord(payload) || !isRecord(payload.artifact)) {
    throw new Error('Skill access response is invalid')
  }
  if (
    payload.visibility === 'public'
    && isNullableString(payload.artifact.walrusBlobUrl)
    && isNullableString(payload.artifact.walrusBlobId)
    && typeof payload.artifact.blobObjectId === 'string'
  ) {
    return payload as SkillAccessResponse
  }

  if (
    payload.visibility === 'private'
    && isRecord(payload.accessPolicy)
    && isRecord(payload.seal)
    && isRecord(payload.sealSidecar)
    && typeof payload.accessPolicy.packageId === 'string'
    && typeof payload.accessPolicy.stateObjectId === 'string'
    && typeof payload.accessPolicy.skillsObjectId === 'string'
    && typeof payload.accessPolicy.versionObjectId === 'string'
    && payload.accessPolicy.moduleName === 'skills'
    && (
      payload.accessPolicy.functionName === 'approve_private_read_owner'
      || payload.accessPolicy.functionName === 'approve_private_read_granted_agent'
    )
    && isNullableString(payload.accessPolicy.soulGrantObjectId)
    && typeof payload.accessPolicy.documentIdHex === 'string'
    && (payload.seal.network === 'testnet' || payload.seal.network === 'mainnet')
    && typeof payload.seal.threshold === 'number'
    && typeof payload.seal.verifyKeyServers === 'boolean'
    && Array.isArray(payload.seal.serverConfigs)
    && typeof payload.sealSidecar.encryptedDek === 'string'
    && typeof payload.sealSidecar.iv === 'string'
    && payload.sealSidecar.cipher === AES_GCM_CIPHER
    && typeof payload.sealSidecar.fileName === 'string'
    && typeof payload.sealSidecar.mimeType === 'string'
    && typeof payload.sealSidecar.contentHash === 'string'
    && typeof payload.viewerAddress === 'string'
    && (payload.accessKind === 'owner' || payload.accessKind === 'granted-agent')
    && typeof payload.sessionTtlMin === 'number'
  ) {
    return payload as SkillAccessResponse
  }

  throw new Error('Skill access response is invalid')
}

export function readSkillAccessError(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error
  }
  return fallback
}

async function buildSkillApprovalTxBytes(params: {
  access: Extract<SkillAccessResponse, { visibility: 'private' }>
  suiClient: unknown
}) {
  assertSkillDocumentMatchesVersion(params.access.accessPolicy.documentIdHex, params.access.accessPolicy.versionObjectId)

  const tx = new Transaction()
  tx.moveCall({
    target: `${params.access.accessPolicy.packageId}::skills::${params.access.accessPolicy.functionName}`,
    arguments:
      params.access.accessPolicy.functionName === 'approve_private_read_granted_agent'
        ? [
            tx.pure.vector('u8', Array.from(hexToBytes(params.access.accessPolicy.documentIdHex))),
            tx.object(params.access.accessPolicy.stateObjectId),
            tx.object(params.access.accessPolicy.skillsObjectId),
            tx.object(params.access.accessPolicy.versionObjectId),
            tx.object(params.access.accessPolicy.soulGrantObjectId!),
            tx.object(SUI_CLOCK_OBJECT_ID),
          ]
        : [
            tx.pure.vector('u8', Array.from(hexToBytes(params.access.accessPolicy.documentIdHex))),
            tx.object(params.access.accessPolicy.stateObjectId),
            tx.object(params.access.accessPolicy.skillsObjectId),
            tx.object(params.access.accessPolicy.versionObjectId),
          ],
  })

  return tx.build({ client: params.suiClient as never })
}

export async function fetchSkillAccess(params: {
  soulObjectId: string
  versionObjectId: string
  getAuthHeaders: () => Promise<HeadersInit>
  fetchImpl?: FetchLike
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const response = await fetchImpl(
    `/api/souls/${encodeURIComponent(params.soulObjectId)}/skills/${encodeURIComponent(params.versionObjectId)}/access`,
    { headers: await params.getAuthHeaders() },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readSkillAccessError(payload, 'Failed to fetch skill access'))
  }
  return parseSkillAccessResponse(payload)
}

export async function loadDecryptedPrivateSkillVersion(params: {
  access: Extract<SkillAccessResponse, { visibility: 'private' }>
  signPersonalMessage: (message: Uint8Array) => Promise<string>
  suiClient: unknown
  fetchImpl?: FetchLike
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const access = params.access
  const walrusBlobUrl = access.artifact.walrusBlobUrl
  if (!walrusBlobUrl) {
    throw new Error('Private skill Walrus blob URL is missing')
  }

  const sessionKey = await SessionKey.create({
    address: access.viewerAddress,
    packageId: access.accessPolicy.packageId,
    ttlMin: access.sessionTtlMin,
    suiClient: params.suiClient as never,
  })
  const personalMessageSignature = await params.signPersonalMessage(sessionKey.getPersonalMessage())
  await sessionKey.setPersonalMessageSignature(personalMessageSignature)

  const txBytes = await buildSkillApprovalTxBytes({
    access,
    suiClient: params.suiClient,
  })
  const encryptedBlobResponse = await fetchImpl(walrusBlobUrl)
  if (!encryptedBlobResponse.ok) {
    throw new Error('Failed to download encrypted skill payload')
  }
  const encryptedData = new Uint8Array(await encryptedBlobResponse.arrayBuffer())

  const sealClient = new SealClient({
    suiClient: params.suiClient as never,
    serverConfigs: access.seal.serverConfigs,
    verifyKeyServers: access.seal.verifyKeyServers,
  })
  const keyMaterial = new Uint8Array(await sealClient.decrypt({
    data: base64ToBytes(access.sealSidecar.encryptedDek),
    sessionKey,
    txBytes,
  }))

  try {
    if (keyMaterial.length !== DEK_BYTES + CONTENT_HASH_BYTES) {
      throw new Error('Skill DEK payload is invalid')
    }

    const dek = keyMaterial.slice(0, DEK_BYTES)
    const boundContentHash = bytesToHex(keyMaterial.slice(DEK_BYTES)).slice(2).toLowerCase()
    if (boundContentHash !== access.sealSidecar.contentHash.toLowerCase()) {
      throw new Error('Skill content hash binding mismatch')
    }

    const iv = base64ToBytes(access.sealSidecar.iv)
    if (iv.length !== IV_BYTES) {
      throw new Error('Skill IV is invalid')
    }

    const aesKey = await importAesKey(dek)
    const plaintext = new Uint8Array(
      await getCrypto().subtle.decrypt(
        { name: AES_GCM_ALGORITHM, iv },
        aesKey,
        toCryptoBytes(encryptedData),
      ),
    )
    if ((await sha256Hex(plaintext)) !== boundContentHash) {
      plaintext.fill(0)
      throw new Error('Skill content hash mismatch')
    }

    return {
      bytes: plaintext,
      fileName: access.sealSidecar.fileName,
      mimeType: access.sealSidecar.mimeType,
    }
  } finally {
    keyMaterial.fill(0)
  }
}
