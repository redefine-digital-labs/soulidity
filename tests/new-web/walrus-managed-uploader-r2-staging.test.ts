import { afterEach, describe, expect, it, vi } from 'vitest'

import { createR2WalrusUploadStaging } from '../../services/walrus-uploader/src/staging-r2'
import type { StagedWalrusUpload } from '../../services/walrus-uploader/src/staging'

const WALLET = `0x${'1'.repeat(64)}`
const ACCOUNT_ID = 'a46a11e68237ae993416885d2133403a'
const BUCKET = 'walrus-uploader-staging'

function stagedUpload(overrides: Partial<StagedWalrusUpload> = {}): StagedWalrusUpload {
  return {
    uploadId: 'upload-1',
    walletAddress: WALLET,
    network: 'mainnet',
    blobId: 'blob-id-0',
    rootHash: new Uint8Array([1, 2, 3]),
    size: 3,
    metadata: { encoded: new Uint8Array([4]) },
    sliversByNode: { node: [BigInt(5)] },
    certificate: null,
    createdAt: 1_000,
    expiresAt: 2_000,
    tokenId: 'token-1',
    ...overrides,
  }
}

const STAGING_PARAMS = {
  accountId: ACCOUNT_ID,
  bucket: BUCKET,
  accessKeyId: 'test-key-id',
  secretAccessKey: 'test-secret-key',
  prefix: 'walrus-uploader',
}

// Production code spells `${endpoint}/${bucket}/${prefix}/${encodedId}.json`
// with literal slashes between prefix and key — so the URL path mirrors that
// shape verbatim. Used to gate which mock branch handles each call.
const OBJECT_URL_PATH = `/${BUCKET}/walrus-uploader/upload-1.json`

async function readSignedBody(init: RequestInit | undefined): Promise<string> {
  // The uploader's signedFetch materializes the signed body as Uint8Array so
  // fetch can length-prefix it (R2 rejects chunked PUT with 411). Decode it
  // back to text for the simulator to parse. Older path (Request with stream
  // body) kept as a defensive fallback.
  if (!init) return ''
  if (init instanceof Request) return await init.clone().text()
  if (init.body instanceof Uint8Array) {
    return new TextDecoder().decode(init.body)
  }
  if (init.body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(init.body))
  }
  if (init.body instanceof ReadableStream) {
    return await new Response(init.body).text()
  }
  if (typeof init.body === 'string') return init.body
  return ''
}

describe('walrus-uploader R2 staging', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('signs requests with SigV4 and round-trips a staged upload', async () => {
    let storedBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String((input as Request).url ?? input)
      const authorization = new Headers(init?.headers).get('Authorization')
      // aws4fetch signs requests with `AWS4-HMAC-SHA256`. We don't validate
      // the signature itself (out of scope) but we assert it was computed.
      expect(authorization).toMatch(/^AWS4-HMAC-SHA256 /)
      expect(url).toContain(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com`)

      if (init?.method === 'PUT' && url.includes(OBJECT_URL_PATH)) {
        // Real R2 returns 411 when the PUT body is sent chunked. Guard
        // against regression: the uploader must hand fetch a
        // length-prefixable body (Uint8Array | string | undefined), never
        // a ReadableStream or a Request with a stream body.
        expect(init).not.toBeInstanceOf(Request)
        expect(init.body instanceof ReadableStream).toBe(false)
        expect(
          init.body == null
          || typeof init.body === 'string'
          || init.body instanceof Uint8Array,
        ).toBe(true)
        storedBody = await readSignedBody(init)
        return new Response('', { status: 200, headers: { ETag: '"etag-1"' } })
      }
      if ((!init?.method || init.method === 'GET') && url.includes(OBJECT_URL_PATH)) {
        return new Response(storedBody, { status: 200, headers: { ETag: '"etag-1"' } })
      }
      if (init?.method === 'DELETE' && url.includes(OBJECT_URL_PATH)) {
        return new Response(null, { status: 204 })
      }
      return new Response(`unexpected request: ${init?.method ?? 'GET'} ${url}`, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const staging = createR2WalrusUploadStaging(STAGING_PARAMS)
    const upload = stagedUpload()

    await staging.put(upload)
    await expect(staging.get('upload-1')).resolves.toMatchObject({
      uploadId: 'upload-1',
      walletAddress: WALLET,
      network: 'mainnet',
      blobId: 'blob-id-0',
      size: 3,
      tokenId: 'token-1',
    })
    await expect(staging.delete('upload-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(OBJECT_URL_PATH),
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(OBJECT_URL_PATH),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('returns null when R2 reports the staged upload is missing', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const staging = createR2WalrusUploadStaging(STAGING_PARAMS)
    await expect(staging.get('missing')).resolves.toBeNull()
  })

  it('paginates through deleteExpired results when R2 returns a NextContinuationToken', async () => {
    const expiredOne = JSON.stringify({
      ...stagedUpload({ uploadId: 'upload-page-1', expiresAt: 2_000 }),
      rootHash: Buffer.from([1, 2, 3]).toString('base64'),
      metadata: null,
      sliversByNode: null,
    })
    const expiredTwo = JSON.stringify({
      ...stagedUpload({ uploadId: 'upload-page-2', expiresAt: 1_500 }),
      rootHash: Buffer.from([1, 2, 3]).toString('base64'),
      metadata: null,
      sliversByNode: null,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String((input as Request).url ?? input)
      const isList = url.includes('list-type=2')
      if (isList && !url.includes('continuation-token=')) {
        return new Response(
          `<ListBucketResult>
            <Contents><Key>walrus-uploader/upload-page-1.json</Key></Contents>
            <NextContinuationToken>page-2</NextContinuationToken>
            <IsTruncated>true</IsTruncated>
          </ListBucketResult>`,
          { status: 200 },
        )
      }
      if (isList && url.includes('continuation-token=page-2')) {
        return new Response(
          `<ListBucketResult>
            <Contents><Key>walrus-uploader/upload-page-2.json</Key></Contents>
            <IsTruncated>false</IsTruncated>
          </ListBucketResult>`,
          { status: 200 },
        )
      }
      if ((!init?.method || init.method === 'GET') && url.includes('walrus-uploader/upload-page-1.json')) {
        return new Response(expiredOne, { status: 200 })
      }
      if ((!init?.method || init.method === 'GET') && url.includes('walrus-uploader/upload-page-2.json')) {
        return new Response(expiredTwo, { status: 200 })
      }
      if (init?.method === 'DELETE' && url.includes('walrus-uploader/upload-page-1.json')) {
        return new Response(null, { status: 204 })
      }
      if (init?.method === 'DELETE' && url.includes('walrus-uploader/upload-page-2.json')) {
        return new Response(null, { status: 204 })
      }
      return new Response('unexpected request', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const staging = createR2WalrusUploadStaging(STAGING_PARAMS)

    await expect(staging.deleteExpired(2_001)).resolves.toBe(2)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('continuation-token=page-2'),
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('walrus-uploader/upload-page-1.json'),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('walrus-uploader/upload-page-2.json'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('skips non-expired staged uploads during cleanup', async () => {
    const liveUpload = JSON.stringify({
      ...stagedUpload({ expiresAt: 5_000 }),
      rootHash: Buffer.from([1, 2, 3]).toString('base64'),
      metadata: null,
      sliversByNode: null,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String((input as Request).url ?? input)
      if (url.includes('list-type=2')) {
        return new Response(
          `<ListBucketResult>
            <Contents><Key>walrus-uploader/upload-live.json</Key></Contents>
          </ListBucketResult>`,
          { status: 200 },
        )
      }
      if ((!init?.method || init.method === 'GET') && url.includes('upload-live.json')) {
        return new Response(liveUpload, { status: 200 })
      }
      if (init?.method === 'DELETE') {
        throw new Error('should not delete live upload')
      }
      return new Response('unexpected request', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const staging = createR2WalrusUploadStaging(STAGING_PARAMS)
    await expect(staging.deleteExpired(2_001)).resolves.toBe(0)
  })
})
