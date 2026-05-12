const MAX_WALRUS_ARTIFACT_BYTES = 25 * 1024 * 1024

export interface WalrusArtifactFetchResult {
  bytes: Uint8Array
  contentType: string | null
}

type FetchLike = typeof fetch

function isLikelyWalrusHost(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized.includes('walrus') || normalized.endsWith('.mirai.cloud')
}

export function validateWalrusArtifactUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Walrus artifact URL is invalid')
  }

  if (url.protocol !== 'https:') {
    throw new Error('Walrus artifact URL must use HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Walrus artifact URL must not include credentials')
  }
  if (url.search || url.hash) {
    throw new Error('Walrus artifact URL must not include query or fragment data')
  }
  if (!isLikelyWalrusHost(url.hostname)) {
    throw new Error('Walrus artifact host is not allowed')
  }
  if (!url.pathname.startsWith('/v1/blobs/')) {
    throw new Error('Walrus artifact URL must point to /v1/blobs/')
  }

  const blobId = decodeURIComponent(url.pathname.slice('/v1/blobs/'.length)).trim()
  if (!blobId) {
    throw new Error('Walrus artifact blob id is missing')
  }

  return url.toString()
}

export async function fetchWalrusArtifactBytes(
  rawUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<WalrusArtifactFetchResult> {
  const url = validateWalrusArtifactUrl(rawUrl)
  const response = await fetchImpl(url, { redirect: 'follow' })

  if (!response.ok) {
    throw new Error(`Walrus artifact fetch failed: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > MAX_WALRUS_ARTIFACT_BYTES) {
      throw new Error('Walrus artifact is too large for desktop cache')
    }
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_WALRUS_ARTIFACT_BYTES) {
    throw new Error('Walrus artifact is too large for desktop cache')
  }

  return {
    bytes: new Uint8Array(buffer),
    contentType: response.headers.get('content-type'),
  }
}
