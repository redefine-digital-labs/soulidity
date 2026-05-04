import { SealClient, SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { isValidContentDocumentId, type ContentAccessResponse } from '@soulidity/sdk'

const AES_GCM_ALGORITHM = 'AES-GCM'
const AES_GCM_CIPHER = 'AES-GCM-256'
const CONTENT_HASH_BYTES = 32
const DEK_BYTES = 32
const IV_BYTES = 12
const SUI_CLOCK_OBJECT_ID = '0x6'

type FetchLike = typeof fetch

export type SealedContentAccess = Extract<ContentAccessResponse, { visibility: 'sealed' }>

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

const VALID_FUNCTION_NAMES = new Set([
  'seal_approve_content_owner',
  'seal_approve_content_granted_agent',
  'seal_approve_content_public',
  'seal_approve_content_paid_access',
])

const VALID_ACCESS_KINDS = new Set(['owner', 'granted-agent', 'paid', 'public'])
const VALID_MODULE_NAMES = new Set(['content', 'paid_access'])

export function parseContentAccessResponse(payload: unknown): SealedContentAccess {
  if (
    !isRecord(payload)
    || payload.visibility !== 'sealed'
    || !isRecord(payload.artifact)
    || !isRecord(payload.accessPolicy)
    || !isRecord(payload.seal)
    || !isRecord(payload.sealSidecar)
    || !isNullableString(payload.artifact.walrusBlobUrl)
    || !isNullableString(payload.artifact.walrusBlobId)
    || typeof payload.artifact.blobObjectId !== 'string'
    || typeof payload.accessPolicy.packageId !== 'string'
    || typeof payload.accessPolicy.stateObjectId !== 'string'
    || typeof payload.accessPolicy.contentObjectId !== 'string'
    || typeof payload.accessPolicy.kind !== 'number'
    || typeof payload.accessPolicy.name !== 'string'
    || typeof payload.accessPolicy.versionIndex !== 'number'
    || typeof payload.accessPolicy.moduleName !== 'string'
    || !VALID_MODULE_NAMES.has(payload.accessPolicy.moduleName)
    || typeof payload.accessPolicy.functionName !== 'string'
    || !VALID_FUNCTION_NAMES.has(payload.accessPolicy.functionName)
    || !isNullableString(payload.accessPolicy.soulGrantObjectId)
    || !isNullableString((payload.accessPolicy as Record<string, unknown>).paidAccessListOnChainId)
    || typeof payload.accessPolicy.documentIdHex !== 'string'
    || !isValidContentDocumentId(payload.accessPolicy.documentIdHex)
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
    || typeof payload.accessKind !== 'string'
    || !VALID_ACCESS_KINDS.has(payload.accessKind)
    || typeof payload.sessionTtlMin !== 'number'
  ) {
    throw new Error('Content access response is invalid')
  }

  return payload as unknown as SealedContentAccess
}

async function buildContentApprovalTxBytes(params: {
  access: SealedContentAccess
  suiClient: unknown
}) {
  const { access } = params
  const { accessPolicy } = access

  const tx = new Transaction()
  tx.setSender(access.viewerAddress)

  const documentIdBytes = tx.pure.vector(
    'u8',
    Array.from(hexToBytes(accessPolicy.documentIdHex)),
  )
  const stateArg = tx.object(accessPolicy.stateObjectId)
  const contentArg = tx.object(accessPolicy.contentObjectId)
  const kindArg = tx.pure.u32(accessPolicy.kind)
  const nameArg = tx.pure.string(accessPolicy.name)
  const versionArg = tx.pure.u64(BigInt(accessPolicy.versionIndex))

  let target: string
  let argumentsList: ReturnType<Transaction['pure']['u32']>[]
  switch (accessPolicy.functionName) {
    case 'seal_approve_content_owner':
      target = `${accessPolicy.packageId}::content::seal_approve_content_owner`
      argumentsList = [documentIdBytes, stateArg, contentArg, kindArg, nameArg, versionArg]
      break
    case 'seal_approve_content_granted_agent': {
      if (!accessPolicy.soulGrantObjectId) {
        throw new Error('Granted-agent access requires soulGrantObjectId')
      }
      target = `${accessPolicy.packageId}::content::seal_approve_content_granted_agent`
      argumentsList = [
        documentIdBytes,
        stateArg,
        contentArg,
        tx.object(accessPolicy.soulGrantObjectId),
        kindArg,
        nameArg,
        versionArg,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ]
      break
    }
    case 'seal_approve_content_public':
      target = `${accessPolicy.packageId}::content::seal_approve_content_public`
      argumentsList = [documentIdBytes, stateArg, contentArg, kindArg, nameArg, versionArg]
      break
    case 'seal_approve_content_paid_access': {
      const paidAccessListId = (accessPolicy as { paidAccessListOnChainId?: string | null })
        .paidAccessListOnChainId
      if (!paidAccessListId) {
        throw new Error('Paid access requires paidAccessListOnChainId')
      }
      target = `${accessPolicy.packageId}::paid_access::seal_approve_content_paid_access`
      argumentsList = [
        documentIdBytes,
        stateArg,
        tx.object(paidAccessListId),
        contentArg,
        kindArg,
        nameArg,
        versionArg,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ]
      break
    }
    default: {
      const exhaustive: never = accessPolicy.functionName
      throw new Error(`Unsupported Seal approval function: ${exhaustive as string}`)
    }
  }

  tx.moveCall({ target, arguments: argumentsList as never[] })

  return tx.build({ client: params.suiClient as never, onlyTransactionKind: true })
}

export async function loadDecryptedContentVersion(params: {
  access: SealedContentAccess
  signPersonalMessage: (message: Uint8Array) => Promise<string>
  suiClient: unknown
  fetchImpl?: FetchLike
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const access = params.access
  const walrusBlobUrl = access.artifact.walrusBlobUrl
  if (!walrusBlobUrl) {
    throw new Error('Sealed content Walrus blob URL is missing')
  }

  const sessionKey = await SessionKey.create({
    address: access.viewerAddress,
    packageId: access.accessPolicy.packageId,
    ttlMin: access.sessionTtlMin,
    suiClient: params.suiClient as never,
  })
  const personalMessageSignature = await params.signPersonalMessage(sessionKey.getPersonalMessage())
  await sessionKey.setPersonalMessageSignature(personalMessageSignature)

  const txBytes = await buildContentApprovalTxBytes({
    access,
    suiClient: params.suiClient,
  })
  const encryptedBlobResponse = await fetchImpl(walrusBlobUrl)
  if (!encryptedBlobResponse.ok) {
    throw new Error('Failed to download encrypted content payload')
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
      throw new Error('Content DEK payload is invalid')
    }

    const dek = keyMaterial.slice(0, DEK_BYTES)
    const boundContentHash = bytesToHex(keyMaterial.slice(DEK_BYTES)).slice(2).toLowerCase()
    if (boundContentHash !== access.sealSidecar.contentHash.toLowerCase()) {
      throw new Error('Content hash binding mismatch')
    }

    const iv = base64ToBytes(access.sealSidecar.iv)
    if (iv.length !== IV_BYTES) {
      throw new Error('Content IV is invalid')
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
      throw new Error('Content hash mismatch')
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
