import { SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { generateAssetDocumentIdForVersion } from '@/lib/services/seal-crypto'
import type { AssetAccessResponse } from '@/lib/soulidity/types'

const AES_GCM_ALGORITHM = 'AES-GCM'
const AES_GCM_CIPHER = 'AES-GCM-256'
const CONTENT_HASH_BYTES = 32
const DEK_BYTES = 32
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

function parseAssetAccessResponse(payload: unknown): AssetAccessResponse {
  if (!isRecord(payload) || !isRecord(payload.artifact)) {
    throw new Error('Asset access response is invalid')
  }
  if (
    payload.visibility === 'public'
    && isNullableString(payload.artifact.walrusBlobUrl)
    && isNullableString(payload.artifact.walrusBlobId)
    && typeof payload.artifact.blobObjectId === 'string'
  ) {
    return payload as AssetAccessResponse
  }

  if (
    payload.visibility === 'private'
    && isRecord(payload.accessPolicy)
    && isRecord(payload.seal)
    && isRecord(payload.sealSidecar)
    && typeof payload.accessPolicy.packageId === 'string'
    && typeof payload.accessPolicy.stateObjectId === 'string'
    && typeof payload.accessPolicy.assetsObjectId === 'string'
    && typeof payload.accessPolicy.assetName === 'string'
    && typeof payload.accessPolicy.versionIndex === 'number'
    && (payload.accessPolicy.moduleName === 'assets' || payload.accessPolicy.moduleName === 'content_access')
    && (
      payload.accessPolicy.functionName === 'seal_approve_asset_read_owner'
      || payload.accessPolicy.functionName === 'seal_approve_asset_read_granted_agent'
      || payload.accessPolicy.functionName === 'seal_approve_asset_allowlisted'
    )
    && isNullableString(payload.accessPolicy.soulGrantObjectId)
    && (payload.accessPolicy.accessListOnChainId == null || typeof payload.accessPolicy.accessListOnChainId === 'string')
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
    && (
      payload.accessKind === 'owner'
      || payload.accessKind === 'granted-agent'
      || payload.accessKind === 'allowlisted'
    )
    && typeof payload.sessionTtlMin === 'number'
  ) {
    return payload as AssetAccessResponse
  }

  throw new Error('Asset access response is invalid')
}

export function readAssetAccessError(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error
  }
  return fallback
}

function assertAssetDocumentMatchesVersion(params: {
  documentIdHex: string
  assetsObjectId: string
  assetName: string
  versionIndex: number
}) {
  const expectedDocumentId = generateAssetDocumentIdForVersion(
    params.assetsObjectId,
    params.assetName,
    params.versionIndex,
  ).toLowerCase()
  if (params.documentIdHex.toLowerCase() !== expectedDocumentId) {
    throw new Error('Asset document id does not match the requested version')
  }
}

async function buildAssetApprovalTxBytes(params: {
  access: Extract<AssetAccessResponse, { visibility: 'private' }>
  suiClient: unknown
}) {
  assertAssetDocumentMatchesVersion({
    documentIdHex: params.access.accessPolicy.documentIdHex,
    assetsObjectId: params.access.accessPolicy.assetsObjectId,
    assetName: params.access.accessPolicy.assetName,
    versionIndex: params.access.accessPolicy.versionIndex,
  })

  const tx = new Transaction()
  tx.setSender(params.access.viewerAddress)
  const documentIdBytes = tx.pure.vector(
    'u8',
    Array.from(hexToBytes(params.access.accessPolicy.documentIdHex)),
  )

  let argumentsList = [
    documentIdBytes,
    tx.object(params.access.accessPolicy.stateObjectId),
  ]

  if (params.access.accessPolicy.moduleName === 'content_access') {
    argumentsList = [
      ...argumentsList,
      tx.object(params.access.accessPolicy.accessListOnChainId!),
    ]
  }

  argumentsList = [
    ...argumentsList,
    tx.object(params.access.accessPolicy.assetsObjectId),
    tx.pure.string(params.access.accessPolicy.assetName),
    tx.pure.u64(params.access.accessPolicy.versionIndex),
  ]

  if (params.access.accessPolicy.functionName === 'seal_approve_asset_read_granted_agent') {
    argumentsList = [
      ...argumentsList,
      tx.object(params.access.accessPolicy.soulGrantObjectId!),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ]
  } else if (params.access.accessPolicy.functionName === 'seal_approve_asset_allowlisted') {
    argumentsList = [
      ...argumentsList,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ]
  }

  tx.moveCall({
    target: `${params.access.accessPolicy.packageId}::${params.access.accessPolicy.moduleName}::${params.access.accessPolicy.functionName}`,
    arguments: argumentsList,
  })

  return tx.build({ client: params.suiClient as never, onlyTransactionKind: true })
}

export async function fetchAssetAccess(params: {
  soulObjectId: string
  assetName: string
  versionIndex: number
  getAuthHeaders: () => Promise<HeadersInit>
  fetchImpl?: FetchLike
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const response = await fetchImpl(
    `/api/souls/${encodeURIComponent(params.soulObjectId)}/assets/${encodeURIComponent(params.assetName)}/versions/${encodeURIComponent(String(params.versionIndex))}/access`,
    { headers: await params.getAuthHeaders() },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readAssetAccessError(payload, 'Failed to fetch asset access'))
  }
  return parseAssetAccessResponse(payload)
}

export async function loadDecryptedPrivateAssetVersion(params: {
  access: Extract<AssetAccessResponse, { visibility: 'private' }>
  signPersonalMessage: (message: Uint8Array) => Promise<string>
  suiClient: unknown
  fetchImpl?: FetchLike
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const walrusBlobUrl = params.access.artifact.walrusBlobUrl
  if (!walrusBlobUrl) {
    throw new Error('Private asset Walrus blob URL is missing')
  }

  const sessionKey = await SessionKey.create({
    address: params.access.viewerAddress,
    packageId: params.access.accessPolicy.packageId,
    ttlMin: params.access.sessionTtlMin,
    suiClient: params.suiClient as never,
  })
  const personalMessageSignature = await params.signPersonalMessage(sessionKey.getPersonalMessage())
  await sessionKey.setPersonalMessageSignature(personalMessageSignature)

  const txBytes = await buildAssetApprovalTxBytes({
    access: params.access,
    suiClient: params.suiClient,
  })
  const encryptedBlobResponse = await fetchImpl(walrusBlobUrl)
  if (!encryptedBlobResponse.ok) {
    throw new Error('Failed to download encrypted asset payload')
  }
  const encryptedData = new Uint8Array(await encryptedBlobResponse.arrayBuffer())

  const sealClient = new SealClient({
    suiClient: params.suiClient as never,
    serverConfigs: params.access.seal.serverConfigs,
    verifyKeyServers: params.access.seal.verifyKeyServers,
  })
  const keyMaterial = new Uint8Array(await sealClient.decrypt({
    data: base64ToBytes(params.access.sealSidecar.encryptedDek),
    sessionKey,
    txBytes,
  }))

  try {
    if (keyMaterial.length !== DEK_BYTES + IV_BYTES + CONTENT_HASH_BYTES) {
      throw new Error('Unexpected DEK payload length returned by Seal')
    }

    const dek = keyMaterial.slice(0, DEK_BYTES)
    const iv = keyMaterial.slice(DEK_BYTES, DEK_BYTES + IV_BYTES)
    const expectedHash = bytesToHex(keyMaterial.slice(DEK_BYTES + IV_BYTES)).slice(2).toLowerCase()
    const aesKey = await importAesKey(dek)
    const decryptedBuffer = await getCrypto().subtle.decrypt(
      { name: AES_GCM_ALGORITHM, iv: toCryptoBytes(iv) },
      aesKey,
      toCryptoBytes(encryptedData),
    )
    const decrypted = new Uint8Array(decryptedBuffer)
    const actualHash = await sha256Hex(decrypted)
    if (actualHash !== expectedHash || actualHash !== params.access.sealSidecar.contentHash.toLowerCase()) {
      throw new Error('Decrypted asset content hash does not match the sealed envelope')
    }

    return {
      bytes: decrypted,
      fileName: params.access.sealSidecar.fileName,
      mimeType: params.access.sealSidecar.mimeType,
    }
  } finally {
    keyMaterial.fill(0)
  }
}
