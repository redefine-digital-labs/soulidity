import {
  deserializeWalrusCertificate,
  type SerializedWalrusCertificate,
} from '@/lib/upload/walrus-batch-transport'

export interface ManagedUploaderCredentials {
  url: string
  token: string
}

export interface ManagedUploaderEncodedBlob {
  uploadId: string
  blobId: string
  rootHash: Uint8Array
  size: number
}

export interface ManagedUploaderCertificate {
  uploadId: string
  blobId: string
  blobObjectId: string
  certificate: ReturnType<typeof deserializeWalrusCertificate>
}

function getManagedUploaderUrl() {
  const url = process.env.NEXT_PUBLIC_WALRUS_UPLOADER_URL?.trim().replace(/\/+$/, '')
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_WALRUS_UPLOADER_URL is required for managed Walrus upload transport. '
      + 'Set NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=browser to use the emergency browser fallback.',
    )
  }
  return url
}

function base64ToBytes(value: string): Uint8Array {
  const bufferCtor = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer
  if (bufferCtor) return new Uint8Array(bufferCtor.from(value, 'base64'))

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function joinUploaderUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Walrus uploader returned invalid ${name}`)
  }
  return value
}

function assertNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Walrus uploader returned invalid ${name}`)
  }
  return value
}

function isSerializedWalrusCertificate(value: unknown): value is SerializedWalrusCertificate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SerializedWalrusCertificate>
  return Array.isArray(candidate.signers)
    && candidate.signers.every((signer) => Number.isInteger(signer) && signer >= 0)
    && typeof candidate.serializedMessage === 'string'
    && typeof candidate.signature === 'string'
}

export async function requestManagedWalrusUploaderCredentials(params: {
  walletAddress: string
  network: 'testnet' | 'mainnet'
  fileCount: number
  byteLimit: number
  authHeaders?: Record<string, string>
}): Promise<ManagedUploaderCredentials> {
  const response = await fetch('/api/walrus/upload-token', {
    method: 'POST',
    headers: {
      ...params.authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      walletAddress: params.walletAddress,
      network: params.network,
      fileCount: params.fileCount,
      byteLimit: params.byteLimit,
    }),
  })
  const payload = await response.json().catch(() => null) as {
    token?: unknown
    error?: string
  } | null
  if (!response.ok) {
    throw new Error(payload?.error || `Walrus uploader token request failed with HTTP ${response.status}`)
  }
  return {
    url: getManagedUploaderUrl(),
    token: assertString(payload?.token, 'token'),
  }
}

export async function uploadPayloadToManagedWalrusUploader(params: {
  credentials: ManagedUploaderCredentials
  walletAddress: string
  network: 'testnet' | 'mainnet'
  payload: Uint8Array
  fileName: string
}): Promise<ManagedUploaderEncodedBlob> {
  const form = new FormData()
  const payloadBuffer = new ArrayBuffer(params.payload.byteLength)
  new Uint8Array(payloadBuffer).set(params.payload)
  form.set('walletAddress', params.walletAddress)
  form.set('network', params.network)
  form.set('payload', new Blob([payloadBuffer], { type: 'application/octet-stream' }), params.fileName)

  // Tell the uploader the exact payload byte size so its server-side
  // reservation tracks payload bytes 1:1 with the token's byte budget. Without
  // this header the uploader reserves against the multipart `Content-Length`,
  // which over-counts the multipart envelope; concurrent multi-file publishes
  // sharing one token would then over-claim the budget and trigger spurious
  // 413s even when the combined payload bytes are within the issued limit.
  const response = await fetch(joinUploaderUrl(params.credentials.url, '/v1/uploads'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.credentials.token}`,
      'X-Walrus-Payload-Bytes': String(params.payload.byteLength),
    },
    body: form,
  })
  const payload = await response.json().catch(() => null) as {
    uploadId?: unknown
    blobId?: unknown
    rootHash?: unknown
    size?: unknown
    error?: string
  } | null
  if (!response.ok) {
    throw new Error(payload?.error || `Walrus uploader upload failed with HTTP ${response.status}`)
  }
  return {
    uploadId: assertString(payload?.uploadId, 'uploadId'),
    blobId: assertString(payload?.blobId, 'blobId'),
    rootHash: base64ToBytes(assertString(payload?.rootHash, 'rootHash')),
    size: assertNumber(payload?.size, 'size'),
  }
}

export async function completeManagedWalrusUpload(params: {
  credentials: ManagedUploaderCredentials
  uploadId: string
  walletAddress: string
  network: 'testnet' | 'mainnet'
  registerTxDigest: string
  blobObjectId: string
}): Promise<ManagedUploaderCertificate> {
  // Keep the HTTP request open until the uploader service finishes Walrus
  // storage-node writes and returns a certificate. Cloudflare Workers do not
  // impose a hard wall-time limit for HTTP requests while the client remains
  // connected; aborting here would cancel the backend operation in exactly the
  // long-running phase this managed transport exists to absorb.
  const response = await fetch(joinUploaderUrl(params.credentials.url, `/v1/uploads/${encodeURIComponent(params.uploadId)}/complete`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.credentials.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      walletAddress: params.walletAddress,
      network: params.network,
      registerTxDigest: params.registerTxDigest,
      blobObjectId: params.blobObjectId,
    }),
  })
  const payload = await response.json().catch(() => null) as {
    uploadId?: unknown
    blobId?: unknown
    blobObjectId?: unknown
    certificate?: unknown
    error?: string
  } | null
  if (!response.ok) {
    throw new Error(payload?.error || `Walrus uploader completion failed with HTTP ${response.status}`)
  }
  if (!isSerializedWalrusCertificate(payload?.certificate)) {
    throw new Error('Walrus uploader returned an invalid certificate')
  }
  return {
    uploadId: assertString(payload?.uploadId, 'uploadId'),
    blobId: assertString(payload?.blobId, 'blobId'),
    blobObjectId: assertString(payload?.blobObjectId, 'blobObjectId'),
    certificate: deserializeWalrusCertificate(payload.certificate),
  }
}

export async function finalizeManagedWalrusUpload(params: {
  credentials: ManagedUploaderCredentials
  uploadId: string
  walletAddress: string
  network: 'testnet' | 'mainnet'
}): Promise<void> {
  await fetch(joinUploaderUrl(params.credentials.url, `/v1/uploads/${encodeURIComponent(params.uploadId)}/finalize`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.credentials.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      walletAddress: params.walletAddress,
      network: params.network,
    }),
  }).catch(() => undefined)
}
