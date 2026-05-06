import { AwsClient } from 'aws4fetch'
import {
  deserializeWalrusTransportValue,
  serializeWalrusTransportValue,
  type WalrusCertificateLike,
} from './codec.js'
import type { StagedWalrusUpload, WalrusUploadStaging } from './staging.js'

// Cap a single `deleteExpired` run at 10 R2 list pages (default page size
// 1000 = up to 10k objects per cleanup pass). Mirrors the GCS backend so a
// staging backlog larger than the cap is drained across subsequent runs.
const R2_DELETE_EXPIRED_MAX_PAGES = 10

export interface CreateR2WalrusUploadStagingParams {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  fetchImpl?: typeof fetch
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
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const c = parsed as Record<string, unknown>
  if (
    typeof c.uploadId !== 'string'
    || typeof c.walletAddress !== 'string'
    || (c.network !== 'testnet' && c.network !== 'mainnet')
    || typeof c.blobId !== 'string'
    || typeof c.rootHash !== 'string'
    || typeof c.size !== 'number'
    || typeof c.createdAt !== 'number'
    || typeof c.expiresAt !== 'number'
    || typeof c.tokenId !== 'string'
  ) {
    return null
  }
  const cert = c.certificate as Record<string, unknown> | null
  const certificate: WalrusCertificateLike | null = cert
    ? {
        signers: Array.isArray(cert.signers) ? cert.signers.filter(Number.isInteger) as number[] : [],
        serializedMessage: new Uint8Array(Buffer.from(String(cert.serializedMessage ?? ''), 'base64')),
        signature: new Uint8Array(Buffer.from(String(cert.signature ?? ''), 'base64')),
      }
    : null
  return {
    uploadId: c.uploadId,
    walletAddress: c.walletAddress,
    network: c.network,
    blobId: c.blobId,
    rootHash: new Uint8Array(Buffer.from(c.rootHash, 'base64')),
    size: c.size,
    metadata: deserializeWalrusTransportValue(c.metadata as never),
    sliversByNode: deserializeWalrusTransportValue(c.sliversByNode as never),
    certificate,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    tokenId: c.tokenId,
  }
}

interface R2ListContents {
  Key?: string
}

interface R2ListResponse {
  Contents?: R2ListContents[]
  NextContinuationToken?: string
  IsTruncated?: boolean
}

// R2 returns ListObjectsV2 as XML by default. We pass `format=json` and
// `Accept: application/json` to opt into the JSON variant (S3 extension R2
// supports), keeping the implementation parity with the GCS backend.
function parseListXml(xml: string): R2ListResponse {
  const result: R2ListResponse = {}
  const contents: R2ListContents[] = []
  const keyRegex = /<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<\/Contents>/g
  let match: RegExpExecArray | null
  while ((match = keyRegex.exec(xml)) != null) {
    contents.push({ Key: match[1] })
  }
  result.Contents = contents
  const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)
  if (tokenMatch) result.NextContinuationToken = tokenMatch[1]
  const truncatedMatch = /<IsTruncated>([^<]+)<\/IsTruncated>/.exec(xml)
  if (truncatedMatch) result.IsTruncated = truncatedMatch[1].trim().toLowerCase() === 'true'
  return result
}

export function createR2WalrusUploadStaging(params: CreateR2WalrusUploadStagingParams): WalrusUploadStaging {
  if (!params.accountId.trim()) throw new Error('R2 accountId is required')
  if (!params.bucket.trim()) throw new Error('R2 bucket is required')
  if (!params.accessKeyId.trim()) throw new Error('R2 accessKeyId is required')
  if (!params.secretAccessKey.trim()) throw new Error('R2 secretAccessKey is required')

  const prefix = params.prefix.replace(/\/+$/, '')
  const endpoint = `https://${params.accountId}.r2.cloudflarestorage.com`
  const aws = new AwsClient({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    region: 'auto',
    service: 's3',
  })
  const fetchImpl = params.fetchImpl

  const objectName = (uploadId: string) => `${prefix}/${encodeURIComponent(uploadId)}.json`
  const objectUrl = (name: string) => `${endpoint}/${encodeURIComponent(params.bucket)}/${name}`

  async function signedFetch(url: string, init: RequestInit = {}) {
    const signed = await aws.sign(url, init)
    // Node 22 undici-fetch on a Request with a ReadableStream body uses
    // chunked transfer encoding, but R2's S3 API requires Content-Length on
    // PUT and rejects chunked uploads with 411 Length Required. Materialize
    // the signed body so fetch can length-prefix it.
    const bytes = await signed.arrayBuffer()
    const body = bytes.byteLength > 0 ? new Uint8Array(bytes) : undefined
    const requestInit: RequestInit = {
      method: signed.method,
      headers: signed.headers,
      body,
    }
    return (fetchImpl ?? fetch)(signed.url, requestInit)
  }

  return {
    async put(upload) {
      const response = await signedFetch(objectUrl(objectName(upload.uploadId)), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: serialize(upload),
      })
      if (!response.ok) {
        throw new Error(`Failed to write R2 staged upload ${upload.uploadId}: HTTP ${response.status}`)
      }
    },
    async get(uploadId) {
      const response = await signedFetch(objectUrl(objectName(uploadId)))
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`Failed to read R2 staged upload ${uploadId}: HTTP ${response.status}`)
      }
      return deserialize(await response.text())
    },
    async delete(uploadId) {
      const response = await signedFetch(objectUrl(objectName(uploadId)), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete R2 staged upload ${uploadId}: HTTP ${response.status}`)
      }
    },
    async deleteExpired(nowMs) {
      const baseListUrl = `${endpoint}/${encodeURIComponent(params.bucket)}/?list-type=2&prefix=${encodeURIComponent(`${prefix}/`)}`
      let deleted = 0
      let continuationToken: string | null = null
      for (let page = 0; page < R2_DELETE_EXPIRED_MAX_PAGES; page += 1) {
        const listUrl = continuationToken
          ? `${baseListUrl}&continuation-token=${encodeURIComponent(continuationToken)}`
          : baseListUrl
        const response = await signedFetch(listUrl)
        if (!response.ok) {
          throw new Error(`Failed to list R2 staged uploads: HTTP ${response.status}`)
        }
        const body = await response.text()
        const listed = parseListXml(body)
        for (const file of listed.Contents ?? []) {
          if (!file.Key) continue
          const objectResponse = await signedFetch(`${endpoint}/${encodeURIComponent(params.bucket)}/${file.Key}`)
          if (!objectResponse.ok) continue
          const upload = deserialize(await objectResponse.text())
          if (upload && upload.expiresAt <= nowMs) {
            await signedFetch(`${endpoint}/${encodeURIComponent(params.bucket)}/${file.Key}`, { method: 'DELETE' })
            deleted += 1
          }
        }
        const next = listed.NextContinuationToken
        continuationToken = typeof next === 'string' && next.length > 0 ? next : null
        if (!continuationToken) break
      }
      return deleted
    },
  }
}
