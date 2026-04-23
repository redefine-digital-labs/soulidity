import { SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'

const AES_GCM_ALGORITHM = 'AES-GCM'
const AES_GCM_CIPHER = 'AES-GCM-256'
const CONTENT_HASH_BYTES = 32
const DEK_BYTES = 32
const IV_BYTES = 12
const DOCUMENT_ID_DOMAIN = 'soul-asset:'
const DOCUMENT_ID_VERSION = 0x01
const DOCUMENT_ID_NONCE = new Uint8Array(16).fill(0x5a)
const SUI_CLOCK_OBJECT_ID = '0x6'

type FetchLike = typeof fetch

export interface PrivateAssetAccessResponse {
  visibility: 'private'
  artifact: {
    walrusBlobUrl: string | null
    walrusBlobId: string | null
    blobObjectId: string
  }
  accessPolicy: {
    packageId: string
    stateObjectId: string
    assetsObjectId: string
    assetName: string
    versionIndex: number
    moduleName: 'assets' | 'content_access'
    functionName:
      | 'seal_approve_asset_read_owner'
      | 'seal_approve_asset_read_granted_agent'
      | 'seal_approve_asset_allowlisted'
    soulGrantObjectId: string | null
    accessListOnChainId?: string
    documentIdHex: string
  }
  seal: {
    network: 'testnet' | 'mainnet'
    threshold: number
    verifyKeyServers: boolean
    serverConfigs: Array<{
      objectId: string
      weight: number
      aggregatorUrl?: string
    }>
  }
  sealSidecar: {
    encryptedDek: string
    iv: string
    cipher: 'AES-GCM-256'
    fileName: string
    mimeType: string
    contentHash: string
  }
  viewerAddress: string
  accessKind: 'owner' | 'granted-agent' | 'allowlisted'
  sessionTtlMin: number
}

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

function generateAssetDocumentIdForVersion(assetsObjectId: string, assetName: string, versionIndex: number) {
  if (!assetName.trim()) {
    throw new Error('assetName is required')
  }

  const assetsBytes = hexToBytes(assetsObjectId)
  const assetNameBytes = new TextEncoder().encode(assetName.trim())
  const versionBytes = u64ToBytes(versionIndex)
  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode(DOCUMENT_ID_DOMAIN),
    DOCUMENT_ID_VERSION,
    ...assetsBytes,
    ...assetNameBytes,
    0x00,
    ...versionBytes,
    ...DOCUMENT_ID_NONCE,
  ]))
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

export function parsePrivateAssetAccess(payload: unknown): PrivateAssetAccessResponse {
  if (
    !isRecord(payload)
    || payload.visibility !== 'private'
    || !isRecord(payload.artifact)
    || !isRecord(payload.accessPolicy)
    || !isRecord(payload.seal)
    || !isRecord(payload.sealSidecar)
    || !isNullableString(payload.artifact.walrusBlobUrl)
    || !isNullableString(payload.artifact.walrusBlobId)
    || typeof payload.artifact.blobObjectId !== 'string'
    || typeof payload.accessPolicy.packageId !== 'string'
    || typeof payload.accessPolicy.stateObjectId !== 'string'
    || typeof payload.accessPolicy.assetsObjectId !== 'string'
    || typeof payload.accessPolicy.assetName !== 'string'
    || typeof payload.accessPolicy.versionIndex !== 'number'
    || (payload.accessPolicy.moduleName !== 'assets' && payload.accessPolicy.moduleName !== 'content_access')
    || (
      payload.accessPolicy.functionName !== 'seal_approve_asset_read_owner'
      && payload.accessPolicy.functionName !== 'seal_approve_asset_read_granted_agent'
      && payload.accessPolicy.functionName !== 'seal_approve_asset_allowlisted'
    )
    || !isNullableString(payload.accessPolicy.soulGrantObjectId)
    || (payload.accessPolicy.accessListOnChainId != null && typeof payload.accessPolicy.accessListOnChainId !== 'string')
    || typeof payload.accessPolicy.documentIdHex !== 'string'
    || (payload.seal.network !== 'testnet' && payload.seal.network !== 'mainnet')
    || typeof payload.seal.threshold !== 'number'
    || typeof payload.seal.verifyKeyServers !== 'boolean'
    || !Array.isArray(payload.seal.serverConfigs)
    || typeof payload.sealSidecar.encryptedDek !== 'string'
    || typeof payload.sealSidecar.iv !== 'string'
    || payload.sealSidecar.cipher !== AES_GCM_CIPHER
    || typeof payload.sealSidecar.fileName !== 'string'
    || typeof payload.sealSidecar.mimeType !== 'string'
    || typeof payload.sealSidecar.contentHash !== 'string'
    || typeof payload.viewerAddress !== 'string'
    || (
      payload.accessKind !== 'owner'
      && payload.accessKind !== 'granted-agent'
      && payload.accessKind !== 'allowlisted'
    )
    || typeof payload.sessionTtlMin !== 'number'
  ) {
    throw new Error('Private asset access response is invalid')
  }

  return payload as unknown as PrivateAssetAccessResponse
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
  access: PrivateAssetAccessResponse
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

  const sharedArguments = [
    documentIdBytes,
    tx.object(params.access.accessPolicy.stateObjectId),
    params.access.accessPolicy.moduleName === 'content_access'
      ? tx.object(params.access.accessPolicy.accessListOnChainId!)
      : null,
    tx.object(params.access.accessPolicy.assetsObjectId),
    tx.pure.string(params.access.accessPolicy.assetName),
    tx.pure.u64(params.access.accessPolicy.versionIndex),
  ].filter(Boolean)

  let argumentsList = sharedArguments
  if (params.access.accessPolicy.functionName === 'seal_approve_asset_read_granted_agent') {
    argumentsList = [
      ...sharedArguments,
      tx.object(params.access.accessPolicy.soulGrantObjectId!),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ]
  } else if (params.access.accessPolicy.functionName === 'seal_approve_asset_allowlisted') {
    argumentsList = [
      ...sharedArguments,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ]
  }

  tx.moveCall({
    target: `${params.access.accessPolicy.packageId}::${params.access.accessPolicy.moduleName}::${params.access.accessPolicy.functionName}`,
    arguments: argumentsList as never[],
  })

  return tx.build({ client: params.suiClient as never, onlyTransactionKind: true })
}

export async function loadDecryptedPrivateAssetVersion(params: {
  access: PrivateAssetAccessResponse
  signPersonalMessage: (message: Uint8Array) => Promise<string>
  suiClient: unknown
  fetchImpl?: FetchLike
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const access = params.access
  const walrusBlobUrl = access.artifact.walrusBlobUrl
  if (!walrusBlobUrl) {
    throw new Error('Private asset Walrus blob URL is missing')
  }

  const sessionKey = await SessionKey.create({
    address: access.viewerAddress,
    packageId: access.accessPolicy.packageId,
    ttlMin: access.sessionTtlMin,
    suiClient: params.suiClient as never,
  })
  const personalMessageSignature = await params.signPersonalMessage(sessionKey.getPersonalMessage())
  await sessionKey.setPersonalMessageSignature(personalMessageSignature)

  const txBytes = await buildAssetApprovalTxBytes({
    access,
    suiClient: params.suiClient,
  })
  const encryptedBlobResponse = await fetchImpl(walrusBlobUrl)
  if (!encryptedBlobResponse.ok) {
    throw new Error('Failed to download encrypted asset payload')
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
      throw new Error('Asset DEK payload is invalid')
    }

    const dek = keyMaterial.slice(0, DEK_BYTES)
    const boundContentHash = bytesToHex(keyMaterial.slice(DEK_BYTES)).slice(2).toLowerCase()
    if (boundContentHash !== access.sealSidecar.contentHash.toLowerCase()) {
      throw new Error('Asset content hash binding mismatch')
    }

    const iv = base64ToBytes(access.sealSidecar.iv)
    if (iv.length !== IV_BYTES) {
      throw new Error('Asset IV is invalid')
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
      throw new Error('Asset content hash mismatch')
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
