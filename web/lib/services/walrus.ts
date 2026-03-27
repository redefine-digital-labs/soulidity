/**
 * Walrus storage service for Soul bundles.
 * Handles network-aware blob uploads and safe blob URL materialization.
 */

const WALRUS_BLOB_PREFIX = '/v1/blobs/'
const WALRUS_BLOB_ID_MAX_LENGTH = 512
const WALRUS_UPLOAD_TIMEOUT_MS = 60_000
const WALRUS_UPLOAD_TOTAL_TIMEOUT_MS = 120_000
const WALRUS_UPLOAD_MAX_ATTEMPTS = 4
const WALRUS_RETRY_BACKOFF_MS = 500
const WALRUS_RETRY_AFTER_MAX_DELAY_MS = 10_000
const WALRUS_RETRY_AFTER_HTTP_DATE_MIN_DELAY_MS = 500
const INVALID_WALRUS_BLOB_ID_CHARS = /[\\/?#%\u0000-\u001F\u007F]/

const TESTNET_PUBLISHER_URLS = [
  'https://publisher.walrus-testnet.walrus.space',
  'https://publisher.walrus-testnet.h2o-nodes.com',
  'https://sm1-walrus-testnet-publisher.stakesquid.com',
  'https://sui-walrus-testnet-publisher.bwarelabs.com',
  'https://testnet-publisher.walrus.graphyte.dev',
  'https://walrus-testnet-publisher.stakecraft.com',
  'https://walrus-testnet-publisher.crouton.digital',
  'https://walrus-testnet-publisher.nodeinfra.com',
]

const MAINNET_PUBLISHER_URL = 'https://publisher.mainnet.walrus.space'
const TESTNET_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space'
const MAINNET_AGGREGATOR_URL = 'https://aggregator.mainnet.walrus.mirai.cloud'

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

export interface WalrusStoredBlob {
  blobId: string
  blobObjectId: string | null
}

class WalrusUploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'WalrusUploadError'
  }
}

export interface WalrusRuntimeConfig {
  network: 'testnet' | 'mainnet'
  publisherUrls: string[]
  aggregatorUrl: string
}

let walrusRuntimeConfigCache: WalrusRuntimeConfig | null = null

function shouldCacheWalrusRuntimeConfig(): boolean {
  return process.env.NODE_ENV !== 'development'
}

function getWalrusNetwork(): 'testnet' | 'mainnet' {
  return process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

export function getWalrusRuntimeConfig(): WalrusRuntimeConfig {
  if (shouldCacheWalrusRuntimeConfig() && walrusRuntimeConfigCache) {
    return walrusRuntimeConfigCache
  }

  const network = getWalrusNetwork()
  const configuredPublisher = process.env.WALRUS_PUBLISHER_URL?.trim()
  const configuredAggregator = process.env.WALRUS_AGGREGATOR_URL?.trim()

  const nextConfig = {
    network,
    publisherUrls:
      configuredPublisher
        ? [configuredPublisher]
        : network === 'mainnet'
          ? [MAINNET_PUBLISHER_URL]
          : [...TESTNET_PUBLISHER_URLS],
    aggregatorUrl:
      configuredAggregator
        ? configuredAggregator
        : network === 'mainnet'
          ? MAINNET_AGGREGATOR_URL
          : TESTNET_AGGREGATOR_URL,
  }

  if (shouldCacheWalrusRuntimeConfig()) {
    walrusRuntimeConfigCache = nextConfig
  }

  return nextConfig
}

function extractBlobIdFromWalrusUrl(value: string): string | null {
  try {
    const aggregatorUrl = new URL(getWalrusRuntimeConfig().aggregatorUrl)
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

function getUploadAttemptPublisherUrls(publisherUrls: string[]): string[] {
  const attemptCount = Math.min(WALRUS_UPLOAD_MAX_ATTEMPTS, publisherUrls.length)
  if (attemptCount === 0) {
    return []
  }
  if (attemptCount === publisherUrls.length) {
    return [...publisherUrls]
  }

  const startIndex = Math.floor(Math.random() * publisherUrls.length)
  const rotatedPublisherUrls = publisherUrls
    .slice(startIndex)
    .concat(publisherUrls.slice(0, startIndex))

  return Array.from({ length: attemptCount }, (_, sampleIndex) => {
    const rotatedIndex = Math.floor((sampleIndex * rotatedPublisherUrls.length) / attemptCount)
    return rotatedPublisherUrls[rotatedIndex]!
  })
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null

  const numericSeconds = Number.parseInt(value, 10)
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return null
  }

  return Math.max(WALRUS_RETRY_AFTER_HTTP_DATE_MIN_DELAY_MS, timestamp - Date.now())
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function putWalrusBlob(buffer: Buffer): Promise<WalrusStoreResponse> {
  const { publisherUrls } = getWalrusRuntimeConfig()
  if (publisherUrls.length === 0) {
    throw new Error('Walrus publisher is not configured')
  }

  const attemptPublisherUrls = getUploadAttemptPublisherUrls(publisherUrls)
  let lastError: Error | null = null
  const startedAt = Date.now()

  for (let attempt = 0; attempt < attemptPublisherUrls.length; attempt += 1) {
    const remainingMs = WALRUS_UPLOAD_TOTAL_TIMEOUT_MS - (Date.now() - startedAt)
    if (remainingMs <= 0) {
      lastError = new Error('Walrus upload timed out')
      break
    }

    const publisherUrl = attemptPublisherUrls[attempt]!
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(WALRUS_UPLOAD_TIMEOUT_MS, remainingMs),
    )

    try {
      const res = await fetch(`${publisherUrl}/v1/blobs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer as unknown as BodyInit,
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = (await res.text()).slice(0, 500)
        throw new WalrusUploadError(
          `Walrus upload failed: ${res.status} ${text}`,
          res.status === 429 || res.status >= 500,
          res.status === 429
            ? (parseRetryAfterMs(res.headers.get('Retry-After')) ?? 1000)
            : res.status >= 500
              ? WALRUS_RETRY_BACKOFF_MS
              : null,
        )
      }

      return (await res.json()) as WalrusStoreResponse
    } catch (error) {
      if (error instanceof WalrusUploadError && !error.retryable) {
        throw error
      }
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? new Error('Walrus upload timed out')
          : error instanceof Error
            ? error
            : new Error('Walrus upload failed')
      if (
        error instanceof WalrusUploadError
        && error.retryAfterMs
        && attempt < attemptPublisherUrls.length - 1
      ) {
        const remainingRetryBudgetMs = WALRUS_UPLOAD_TOTAL_TIMEOUT_MS - (Date.now() - startedAt)
        const delayMs = Math.min(
          error.retryAfterMs,
          WALRUS_RETRY_AFTER_MAX_DELAY_MS,
          remainingRetryBudgetMs,
        )
        if (delayMs > 0) {
          await sleep(delayMs)
        }
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError ?? new Error('Walrus upload failed')
}

/**
 * Upload an encrypted bundle to Walrus (for Seal-protected access).
 * The buffer should already be encrypted client-side.
 */
export async function uploadEncrypted(buffer: Buffer): Promise<WalrusStoredBlob> {
  const data = await putWalrusBlob(buffer)
  const blobId = assertWalrusBlobId(
    data.newlyCreated?.blobObject.blobId ?? data.alreadyCertified?.blobId,
    'Walrus blob ID',
  )

  return {
    blobId,
    blobObjectId: data.newlyCreated?.blobObject.id ?? null,
  }
}

/**
 * Upload public metadata (preview images or sidecars) to Walrus.
 */
export async function uploadPublic(buffer: Buffer): Promise<WalrusStoredBlob> {
  return uploadEncrypted(buffer)
}

/**
 * Get the download URL for a Walrus blob.
 */
export function getBlobUrl(blobId: string): string {
  return `${getWalrusRuntimeConfig().aggregatorUrl}/v1/blobs/${encodeURIComponent(assertWalrusBlobId(blobId))}`
}
