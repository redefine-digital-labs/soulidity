import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGcsWalrusUploadStaging } from '../../services/walrus-uploader/src/staging-gcs'
import type { StagedWalrusUpload } from '../../services/walrus-uploader/src/staging'

const WALLET = `0x${'1'.repeat(64)}`

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

describe('walrus-uploader GCS staging', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('stores, reads, and deletes staged uploads through authenticated GCS JSON API calls', async () => {
    vi.stubEnv('GCS_ACCESS_TOKEN', 'test-access-token')
    let storedBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('Authorization')
      expect(authorization).toBe('Bearer test-access-token')

      if (url.startsWith('https://storage.googleapis.com/upload/storage/v1/b/clawnews-test/o')) {
        storedBody = String(init?.body ?? '')
        return new Response('{}', { status: 200 })
      }
      if (url.includes('/o/walrus-uploader%2Fupload-1.json?alt=media')) {
        return new Response(storedBody, { status: 200 })
      }
      if (url.includes('/o/walrus-uploader%2Fupload-1.json') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('unexpected request', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const staging = await createGcsWalrusUploadStaging('clawnews-test', 'walrus-uploader')
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

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/upload/storage/v1/b/clawnews-test/o'), expect.objectContaining({
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/o/walrus-uploader%2Fupload-1.json?alt=media'), expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/o/walrus-uploader%2Fupload-1.json'), expect.objectContaining({
      method: 'DELETE',
    }))
  })

  it('removes expired staged uploads under the configured GCS prefix', async () => {
    vi.stubEnv('GCS_ACCESS_TOKEN', 'test-access-token')
    const expiredUpload = JSON.stringify({
      ...stagedUpload({ expiresAt: 2_000 }),
      rootHash: Buffer.from([1, 2, 3]).toString('base64'),
      metadata: null,
      sliversByNode: null,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('Authorization')
      expect(authorization).toBe('Bearer test-access-token')

      if (url.includes('/o?prefix=walrus-uploader%2F')) {
        return new Response(JSON.stringify({ items: [{ name: 'walrus-uploader/upload-1.json' }] }), { status: 200 })
      }
      if (url.includes('/o/walrus-uploader%2Fupload-1.json?alt=media')) {
        return new Response(expiredUpload, { status: 200 })
      }
      if (url.includes('/o/walrus-uploader%2Fupload-1.json') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('unexpected request', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const staging = await createGcsWalrusUploadStaging('clawnews-test', 'walrus-uploader')

    await expect(staging.deleteExpired(2_001)).resolves.toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/o?prefix=walrus-uploader%2F'), expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/o/walrus-uploader%2Fupload-1.json'), expect.objectContaining({
      method: 'DELETE',
    }))
  })
})
