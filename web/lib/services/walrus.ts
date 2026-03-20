/**
 * Walrus storage service for Soul bundles.
 * Handles encrypted (Seal-protected) and public blob uploads.
 */

const WALRUS_PUBLISHER_URL =
  process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space'
const WALRUS_AGGREGATOR_URL =
  process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space'
const WALRUS_BLOB_PREFIX = '/v1/blobs/'
const WALRUS_BLOB_ID_MAX_LENGTH = 512
const WALRUS_UPLOAD_TIMEOUT_MS = 60_000
const INVALID_WALRUS_BLOB_ID_CHARS = /[\\/?#%\u0000-\u001F\u007F]/

interface WalrusStoreResponse {
  newlyCreated?: {
    blobObject: {
      blobId: string
      id: string
    }
  }
  alreadyCertified?: {
    blobId: string
  }
}

function extractBlobIdFromWalrusUrl(value: string): string | null {
  try {
    const aggregatorUrl = new URL(WALRUS_AGGREGATOR_URL)
    const candidateUrl = new URL(value)
    if (candidateUrl.origin !== aggregatorUrl.origin || candidateUrl.search || candidateUrl.hash) {
      return null
    }
    if (!candidateUrl.pathname.startsWith(WALRUS_BLOB_PREFIX)) {
      return null
    }

    const blobId = decodeURIComponent(candidateUrl.pathname.slice(WALRUS_BLOB_PREFIX.length))
    return blobId || null
  } catch {
    return null
  }
}

export function normalizeWalrusBlobId(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const blobId = extractBlobIdFromWalrusUrl(trimmed) ?? trimmed
  if (
    blobId.length === 0 ||
    blobId.length > WALRUS_BLOB_ID_MAX_LENGTH ||
    blobId.includes('..') ||
    INVALID_WALRUS_BLOB_ID_CHARS.test(blobId)
  ) {
    return null
  }

  return blobId
}

export function assertWalrusBlobId(value: unknown, fieldName = 'blobId'): string {
  const blobId = normalizeWalrusBlobId(value)
  if (!blobId) {
    throw new Error(`Invalid ${fieldName}`)
  }
  return blobId
}

export function materializeWalrusBlobUrls(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  return values.flatMap((value) => {
    const blobId = normalizeWalrusBlobId(value)
    return blobId ? [getBlobUrl(blobId)] : []
  })
}

async function putWalrusBlob(buffer: Buffer): Promise<WalrusStoreResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WALRUS_UPLOAD_TIMEOUT_MS)

  try {
    const res = await fetch(`${WALRUS_PUBLISHER_URL}/v1/blobs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer as unknown as BodyInit,
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = (await res.text()).slice(0, 500)
      throw new Error(`Walrus upload failed: ${res.status} ${text}`)
    }

    return (await res.json()) as WalrusStoreResponse
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Walrus upload timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Upload an encrypted bundle to Walrus (for Seal-protected access).
 * The buffer should already be encrypted client-side using Seal.
 */
export async function uploadEncrypted(buffer: Buffer): Promise<string> {
  const data = await putWalrusBlob(buffer)
  const blobId = assertWalrusBlobId(
    data.newlyCreated?.blobObject.blobId ?? data.alreadyCertified?.blobId,
    'Walrus blob ID',
  )

  return blobId
}

/**
 * Upload public metadata (readme, previews) to Walrus.
 */
export async function uploadPublic(buffer: Buffer): Promise<string> {
  // Same API — public blobs are just unencrypted
  return uploadEncrypted(buffer)
}

/**
 * Get the download URL for a Walrus blob.
 */
export function getBlobUrl(blobId: string): string {
  return `${WALRUS_AGGREGATOR_URL}/v1/blobs/${encodeURIComponent(assertWalrusBlobId(blobId))}`
}
