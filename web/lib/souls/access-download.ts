import { SealClient, SessionKey } from '@mysten/seal'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { buildSealApprovalTxBytes, decryptBundle } from '@web/lib/services/seal-crypto'
import type { SoulAccessResponse } from '@web/lib/souls/types'

export const DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS = 60_000
const DOWNLOAD_FILENAME_MAX_BYTES = 255
const DOWNLOAD_FILENAME_BIDI_OVERRIDE_PATTERN = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const SUPPORTED_ACCESS_POLICY_FUNCTIONS = new Set([
  'seal_approve_owner_in_personal_kiosk',
  'seal_approve_allowlisted',
])

export function readAccessDownloadError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
    return (payload as { error: string }).error
  }
  return fallback
}

export function requirePrimarySuiWallet(address: string | null | undefined) {
  if (!address) {
    throw new Error('Bind a Sui wallet before accessing Soul content')
  }
  return address
}

export function sanitizeDownloadFileName(fileName: string) {
  const sanitized = truncateUtf8String(
    fileName
    .trim()
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(DOWNLOAD_FILENAME_BIDI_OVERRIDE_PATTERN, '_'),
    DOWNLOAD_FILENAME_MAX_BYTES,
  )

  return sanitized || 'soul-content.bin'
}

export function createSoulDownloadBlob(bytes: Uint8Array, mimeType = 'application/octet-stream') {
  try {
    const copiedBytes = new Uint8Array(new ArrayBuffer(bytes.length))
    copiedBytes.set(bytes)
    return new Blob([copiedBytes.buffer], { type: mimeType })
  } finally {
    bytes.fill(0)
  }
}

export function scheduleBlobUrlRevoke(
  blobUrl: string,
  params: {
    delayMs?: number
    revoke?: (blobUrl: string) => void
    schedule?: (callback: () => void, delayMs: number) => unknown
  } = {},
) {
  const revoke = params.revoke ?? ((scheduledBlobUrl: string) => URL.revokeObjectURL(scheduledBlobUrl))
  const schedule = params.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
  return schedule(() => revoke(blobUrl), params.delayMs ?? DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS)
}

function matchesRequestedSoulObjectId(left: string, right: string) {
  try {
    return normalizeSuiAddress(left) === normalizeSuiAddress(right)
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSupportedAccessPolicyFunction(
  value: unknown,
): value is SoulAccessResponse['accessPolicy']['functionName'] {
  return typeof value === 'string' && SUPPORTED_ACCESS_POLICY_FUNCTIONS.has(value)
}

function isValidSealServerConfig(
  value: unknown,
): value is SoulAccessResponse['seal']['serverConfigs'][number] {
  return isRecord(value)
    && typeof value.objectId === 'string'
    && typeof value.weight === 'number'
    && Number.isFinite(value.weight)
    && (value.aggregatorUrl === undefined || typeof value.aggregatorUrl === 'string')
}

function truncateUtf8String(value: string, maxBytes: number) {
  const encoder = new TextEncoder()
  if (encoder.encode(value).length <= maxBytes) {
    return value
  }

  let truncated = ''
  let usedBytes = 0
  for (const character of value) {
    const characterBytes = encoder.encode(character).length
    if (usedBytes + characterBytes > maxBytes) {
      break
    }
    truncated += character
    usedBytes += characterBytes
  }

  return truncated
}

function parseSoulAccessResponse(payload: unknown): SoulAccessResponse {
  if (!isRecord(payload)) {
    throw new Error('Soul access response is invalid')
  }

  const artifact = payload.artifact
  const accessPolicy = payload.accessPolicy
  const seal = payload.seal
  const sealSidecar = payload.sealSidecar

  if (
    !isRecord(artifact)
    || typeof artifact.walrusBlobUrl !== 'string'
    || typeof artifact.walrusBlobId !== 'string'
    || typeof artifact.contentBlobObjectId !== 'string'
    || !isRecord(accessPolicy)
    || typeof accessPolicy.packageId !== 'string'
    || typeof accessPolicy.soulObjectId !== 'string'
    || accessPolicy.moduleName !== 'seal_policy'
    || !isSupportedAccessPolicyFunction(accessPolicy.functionName)
    || !isNullableString(accessPolicy.currentKioskId)
    || !isNullableString(accessPolicy.currentKioskCapOnChainId)
    || !isNullableString(accessPolicy.allowlistRegistryObjectId)
    || !isNullableString(accessPolicy.soulAllowlistCapObjectId)
    || !isRecord(seal)
    || (seal.network !== 'testnet' && seal.network !== 'mainnet')
    || typeof seal.threshold !== 'number'
    || !Number.isFinite(seal.threshold)
    || typeof seal.verifyKeyServers !== 'boolean'
    || !Array.isArray(seal.serverConfigs)
    || !seal.serverConfigs.every(isValidSealServerConfig)
    || !isRecord(sealSidecar)
    || typeof sealSidecar.documentId !== 'string'
    || typeof sealSidecar.fileName !== 'string'
    || typeof sealSidecar.mimeType !== 'string'
    || typeof payload.viewerAddress !== 'string'
    || (payload.accessKind !== 'owner' && payload.accessKind !== 'allowlisted')
    || typeof payload.sessionTtlMin !== 'number'
  ) {
    throw new Error('Soul access response is invalid')
  }

  return payload as unknown as SoulAccessResponse
}

type AccessFetch = typeof fetch
type SessionKeyLike = {
  getPersonalMessage(): Uint8Array
  setPersonalMessageSignature(signature: string): Promise<void>
}

type CreateSessionKey = (params: {
  address: string
  packageId: string
  ttlMin: number
  suiClient: unknown
}) => Promise<SessionKeyLike>

export async function loadDecryptedSoulBundle(params: {
  soulObjectId: string
  getAuthHeaders: () => Promise<HeadersInit>
  signPersonalMessage: (message: Uint8Array) => Promise<string>
  suiClient: unknown
  fetchImpl?: AccessFetch
  createSessionKey?: CreateSessionKey
  createSealClient?: (config: ConstructorParameters<typeof SealClient>[0]) => SealClient
  buildSealApprovalTxBytesImpl?: typeof buildSealApprovalTxBytes
  decryptBundleImpl?: typeof decryptBundle
}) {
  const fetchImpl = params.fetchImpl ?? fetch
  const accessResponse = await fetchImpl(`/api/souls/${encodeURIComponent(params.soulObjectId)}/access`, {
    headers: await params.getAuthHeaders(),
  })
  const accessPayload = await accessResponse.json().catch(() => null)
  if (!accessResponse.ok) {
    throw new Error(readAccessDownloadError(accessPayload, 'Failed to fetch Soul access'))
  }

  const access = parseSoulAccessResponse(accessPayload)
  if (!matchesRequestedSoulObjectId(access.accessPolicy.soulObjectId, params.soulObjectId)) {
    throw new Error('Soul access response does not match the requested Soul')
  }
  const createSessionKey = params.createSessionKey ?? ((options) => SessionKey.create(options as never))
  const sessionKey = await createSessionKey({
    address: access.viewerAddress,
    packageId: access.accessPolicy.packageId,
    ttlMin: access.sessionTtlMin,
    suiClient: params.suiClient,
  })
  const personalMessageSignature = await params.signPersonalMessage(sessionKey.getPersonalMessage())
  await sessionKey.setPersonalMessageSignature(personalMessageSignature)

  const buildTxBytes = params.buildSealApprovalTxBytesImpl ?? buildSealApprovalTxBytes
  const txBytes = await buildTxBytes({
    accessPolicy: access.accessPolicy,
    documentId: access.sealSidecar.documentId,
    soulAllowlistCapObjectId: access.accessPolicy.soulAllowlistCapObjectId,
  })

  const encryptedBlobResponse = await fetchImpl(access.artifact.walrusBlobUrl)
  if (!encryptedBlobResponse.ok) {
    throw new Error('Failed to download encrypted Soul bundle')
  }
  const encryptedData = new Uint8Array(await encryptedBlobResponse.arrayBuffer())

  const createSealClient = params.createSealClient ?? ((config) => new SealClient(config))
  const sealClient = createSealClient({
    suiClient: params.suiClient as never,
    serverConfigs: access.seal.serverConfigs,
    verifyKeyServers: access.seal.verifyKeyServers,
  })

  const decrypt = params.decryptBundleImpl ?? decryptBundle
  const decryptedData = await decrypt({
    sealClient,
    sessionKey: sessionKey as never,
    txBytes,
    encryptedData,
    sidecar: access.sealSidecar,
    expectedSoulObjectId: access.accessPolicy.soulObjectId,
  })
  let bytes: Uint8Array | null = null
  try {
    bytes = new Uint8Array(decryptedData.byteLength)
    bytes.set(decryptedData)
    return {
      bytes,
      fileName: access.sealSidecar.fileName,
      mimeType: access.sealSidecar.mimeType,
    }
  } catch (copyError) {
    bytes?.fill(0)
    throw copyError
  } finally {
    decryptedData.fill(0)
  }
}
