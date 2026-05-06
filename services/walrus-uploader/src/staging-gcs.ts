import {
  deserializeWalrusTransportValue,
  serializeWalrusTransportValue,
  type WalrusCertificateLike,
} from './codec.js'
import type { StagedWalrusUpload, WalrusUploadStaging } from './staging.js'

const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
// Cap a single `deleteExpired` run at 10 GCS list pages (default page size
// 1000 = up to 10k objects per cleanup pass). The handler kicks off cleanup
// out-of-band and at a coarse interval, so a backlog larger than the cap is
// drained across subsequent runs instead of unbounded per-call work.
const GCS_DELETE_EXPIRED_MAX_PAGES = 10

interface GcsListResponse {
  items?: Array<{ name?: string }>
  nextPageToken?: string
}

function serialize(upload: StagedWalrusUpload) {
  return JSON.stringify({
    ...upload,
    rootHash: Buffer.from(upload.rootHash).toString('base64'),
    metadata: serializeWalrusTransportValue(upload.metadata),
    sliversByNode: serializeWalrusTransportValue(upload.sliversByNode),
    certificate: upload.certificate
      ? {
          signers: upload.certificate.signers,
          serializedMessage: Buffer.from(upload.certificate.serializedMessage).toString('base64'),
          signature: Buffer.from(upload.certificate.signature).toString('base64'),
        }
      : null,
  })
}

function deserialize(raw: string): StagedWalrusUpload | null {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (
    typeof parsed.uploadId !== 'string'
    || typeof parsed.walletAddress !== 'string'
    || (parsed.network !== 'testnet' && parsed.network !== 'mainnet')
    || typeof parsed.blobId !== 'string'
    || typeof parsed.rootHash !== 'string'
    || typeof parsed.size !== 'number'
    || typeof parsed.createdAt !== 'number'
    || typeof parsed.expiresAt !== 'number'
    || typeof parsed.tokenId !== 'string'
  ) {
    return null
  }
  const cert = parsed.certificate as Record<string, unknown> | null
  const certificate: WalrusCertificateLike | null = cert
    ? {
        signers: Array.isArray(cert.signers) ? cert.signers.filter(Number.isInteger) as number[] : [],
        serializedMessage: new Uint8Array(Buffer.from(String(cert.serializedMessage ?? ''), 'base64')),
        signature: new Uint8Array(Buffer.from(String(cert.signature ?? ''), 'base64')),
      }
    : null

  return {
    uploadId: parsed.uploadId,
    walletAddress: parsed.walletAddress,
    network: parsed.network,
    blobId: parsed.blobId,
    rootHash: new Uint8Array(Buffer.from(parsed.rootHash, 'base64')),
    size: parsed.size,
    metadata: deserializeWalrusTransportValue(parsed.metadata as never),
    sliversByNode: deserializeWalrusTransportValue(parsed.sliversByNode as never),
    certificate,
    createdAt: parsed.createdAt,
    expiresAt: parsed.expiresAt,
    tokenId: parsed.tokenId,
  }
}

export async function createGcsWalrusUploadStaging(bucketName: string, prefix: string): Promise<WalrusUploadStaging> {
  const objectName = (uploadId: string) => `${prefix.replace(/\/+$/, '')}/${encodeURIComponent(uploadId)}.json`
  const objectUrl = (name: string) =>
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(name)}`
  const uploadUrl = (name: string) =>
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o`
    + `?uploadType=media&name=${encodeURIComponent(name)}`

  async function accessToken() {
    const explicit = process.env.GCS_ACCESS_TOKEN?.trim() || process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim()
    if (explicit) return explicit

    const response = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(GCS_SCOPE)}`,
      { headers: { 'Metadata-Flavor': 'Google' } },
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch Cloud Run service-account token: HTTP ${response.status}`)
    }
    const payload = await response.json().catch(() => null) as { access_token?: unknown } | null
    if (typeof payload?.access_token !== 'string' || !payload.access_token) {
      throw new Error('Cloud Run service-account token response did not include access_token')
    }
    return payload.access_token
  }

  async function authedFetch(url: string, init: RequestInit = {}) {
    const token = await accessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(url, { ...init, headers })
  }

  return {
    async put(upload) {
      const response = await authedFetch(uploadUrl(objectName(upload.uploadId)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialize(upload),
      })
      if (!response.ok) {
        throw new Error(`Failed to write GCS staged upload ${upload.uploadId}: HTTP ${response.status}`)
      }
    },
    async get(uploadId) {
      const response = await authedFetch(`${objectUrl(objectName(uploadId))}?alt=media`)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Failed to read GCS staged upload ${uploadId}: HTTP ${response.status}`)
      try {
        return deserialize(await response.text())
      } catch {
        return null
      }
    },
    async delete(uploadId) {
      const response = await authedFetch(objectUrl(objectName(uploadId)), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete GCS staged upload ${uploadId}: HTTP ${response.status}`)
      }
    },
    async deleteExpired(nowMs) {
      const baseListUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o`
        + `?prefix=${encodeURIComponent(`${prefix.replace(/\/+$/, '')}/`)}`
      let deleted = 0
      let pageToken: string | null = null
      for (let page = 0; page < GCS_DELETE_EXPIRED_MAX_PAGES; page += 1) {
        const listUrl = pageToken
          ? `${baseListUrl}&pageToken=${encodeURIComponent(pageToken)}`
          : baseListUrl
        const response = await authedFetch(listUrl)
        if (!response.ok) {
          throw new Error(`Failed to list GCS staged uploads: HTTP ${response.status}`)
        }
        const listed = await response.json().catch(() => null) as GcsListResponse | null
        for (const file of listed?.items ?? []) {
          if (!file.name) continue
          const objectResponse = await authedFetch(`${objectUrl(file.name)}?alt=media`)
          if (!objectResponse.ok) continue
          const upload = deserialize(await objectResponse.text())
          if (upload && upload.expiresAt <= nowMs) {
            await authedFetch(objectUrl(file.name), { method: 'DELETE' })
            deleted += 1
          }
        }
        const next = listed?.nextPageToken
        pageToken = typeof next === 'string' && next.length > 0 ? next : null
        if (!pageToken) break
      }
      return deleted
    },
  }
}
