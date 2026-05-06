import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWalrusUploaderHandler,
  createMemoryWalrusUploadStaging,
} from '../../services/walrus-uploader/src/handler'
import { createWalrusUploaderToken } from '../../src/shared/walrus-uploader-token'

const SECRET = 'uploader-secret-with-enough-entropy'
const WALLET = `0x${'1'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'2'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

function makeToken(fileCount = 1, byteLimit = 1024) {
  return createWalrusUploaderToken({
    secret: SECRET,
    nowMs: Date.now(),
    ttlMs: 60_000,
    walletAddress: WALLET,
    network: 'mainnet',
    fileCount,
    byteLimit,
  })
}

function multipartUploadRequest(token: string, bytes: Uint8Array) {
  const form = new FormData()
  form.set('walletAddress', WALLET)
  form.set('network', 'mainnet')
  form.set('payload', new Blob([bytes], { type: 'application/octet-stream' }), 'payload.bin')
  return new Request('http://uploader.test/v1/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
}

describe('walrus-uploader HTTP handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stages encrypted payload bytes server-side and completes without client slivers', async () => {
    const staging = createMemoryWalrusUploadStaging()
    const certificate = {
      signers: [0],
      serializedMessage: new Uint8Array([8]),
      signature: new Uint8Array([9]),
    }
    const walrusClient = {
      encodeBlob: vi.fn(async (payload: Uint8Array) => ({
        blobId: 'blob-id-0',
        rootHash: new Uint8Array([1, 2, 3]),
        metadata: { V1: { unencoded_length: BigInt(payload.byteLength) } },
        sliversByNode: [{ primary: [{ sliver: new Uint8Array([4]) }], secondary: [] }],
      })),
      writeEncodedBlobToNodes: vi.fn(async () => ['confirmation']),
      getStorageConfirmations: vi.fn(async () => ['confirmation']),
      certificateFromConfirmations: vi.fn(async () => certificate),
      systemState: vi.fn(async () => ({
        committee: { n_shards: 1, members: [{ weight: 1 }] },
      })),
      getBlobObject: vi.fn(async () => ({
        id: BLOB_OBJECT_ID,
        blob_id: '0',
        deletable: true,
      })),
      getBlobType: vi.fn(async () => '0xwalrus::blob::Blob'),
    }
    const validateRegister = vi.fn(async () => [{
      blobId: 'blob-id-0',
      blobObjectId: BLOB_OBJECT_ID,
    }])
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging,
      createWalrusClient: async () => walrusClient,
      validateRegister,
      nowMs: () => Date.now(),
    })

    const uploadResponse = await handler(multipartUploadRequest(makeToken(), new Uint8Array([1, 2, 3])))

    expect(uploadResponse.status).toBe(200)
    const upload = await uploadResponse.json()
    expect(upload).toMatchObject({
      uploadId: expect.any(String),
      blobId: 'blob-id-0',
      rootHash: 'AQID',
      size: 3,
    })
    expect(walrusClient.encodeBlob).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))

    const completeResponse = await handler(new Request(`http://uploader.test/v1/uploads/${upload.uploadId}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${makeToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: WALLET,
        network: 'mainnet',
        registerTxDigest: TX_DIGEST,
        blobObjectId: BLOB_OBJECT_ID,
      }),
    }))

    expect(completeResponse.status).toBe(200)
    await expect(completeResponse.json()).resolves.toMatchObject({
      uploadId: upload.uploadId,
      blobId: 'blob-id-0',
      blobObjectId: BLOB_OBJECT_ID,
      certificate: {
        signers: [0],
        serializedMessage: 'CA==',
        signature: 'CQ==',
      },
    })
    expect(validateRegister).toHaveBeenCalledWith(expect.objectContaining({
      digest: TX_DIGEST,
      walletAddress: WALLET,
      expected: [{ blobId: 'blob-id-0', blobObjectId: BLOB_OBJECT_ID }],
    }))
    expect(walrusClient.writeEncodedBlobToNodes).toHaveBeenCalledWith(expect.objectContaining({
      blobId: 'blob-id-0',
      objectId: BLOB_OBJECT_ID,
      deletable: true,
    }))
  })

  it('rejects an oversized multipart upload via Content-Length before parsing the body', async () => {
    const staging = createMemoryWalrusUploadStaging()
    const walrusClient = {
      encodeBlob: vi.fn(async () => {
        throw new Error('encodeBlob must not be called when the byte budget is exceeded')
      }),
      writeEncodedBlobToNodes: vi.fn(),
      getStorageConfirmations: vi.fn(),
      certificateFromConfirmations: vi.fn(),
      systemState: vi.fn(),
    }
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging,
      createWalrusClient: async () => walrusClient as never,
      validateRegister: async () => [],
      nowMs: () => Date.now(),
    })

    const tinyToken = makeToken(1, 16)
    const oversizedPayload = new Uint8Array(1024 * 1024)
    const response = await handler(multipartUploadRequest(tinyToken, oversizedPayload))

    expect(response.status).toBe(413)
    expect(walrusClient.encodeBlob).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Walrus uploader token byte limit exceeded',
    })
  })

  it('aborts a chunked multipart upload mid-stream when bytes exceed the token budget', async () => {
    const staging = createMemoryWalrusUploadStaging()
    const walrusClient = {
      encodeBlob: vi.fn(async () => {
        throw new Error('encodeBlob must not be called when the byte budget is exceeded')
      }),
      writeEncodedBlobToNodes: vi.fn(),
      getStorageConfirmations: vi.fn(),
      certificateFromConfirmations: vi.fn(),
      systemState: vi.fn(),
    }
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging,
      createWalrusClient: async () => walrusClient as never,
      validateRegister: async () => [],
      nowMs: () => Date.now(),
    })

    const tinyToken = makeToken(1, 16)
    // Build a multipart body with no Content-Length by streaming chunks. The
    // first chunk on its own already exceeds the budget + multipart overhead.
    const boundary = '----walrus-test-boundary'
    const head = `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="walletAddress"\r\n\r\n'
      + `${WALLET}\r\n`
      + `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="network"\r\n\r\n'
      + 'mainnet\r\n'
      + `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="payload"; filename="payload.bin"\r\n'
      + 'Content-Type: application/octet-stream\r\n\r\n'
    const giant = new Uint8Array(2 * 1024 * 1024)
    const tail = `\r\n--${boundary}--\r\n`
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(head))
        controller.enqueue(giant)
        controller.enqueue(new TextEncoder().encode(tail))
        controller.close()
      },
    })
    const request = new Request('http://uploader.test/v1/uploads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tinyToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const response = await handler(request)
    expect(response.status).toBe(413)
    expect(walrusClient.encodeBlob).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: 'Walrus uploader token byte limit exceeded',
    })
  })

  it('rejects concurrent uploads sharing one token before they can each buffer the full byte budget', async () => {
    // Three concurrent /v1/uploads requests share one bearer token whose
    // 1024-byte budget can fit at most one 600-byte payload. Without the
    // in-flight reservation, every request would observe the same
    // remainingByteBudget=1024, stream up to ~1024+overhead bytes, parse
    // formData, then fail at the post-parse reserve() (which throws and
    // surfaces through the default catch with status 400 — NOT 413). With
    // the reservation, only the first request's claim succeeds and the
    // other two are rejected via the early-return 413 path before any
    // multipart parsing happens.
    function buildStreamingRequest(token: string, payload: Uint8Array): Request {
      const boundary = '----walrus-concurrent-test-boundary'
      const head = `--${boundary}\r\n`
        + 'Content-Disposition: form-data; name="walletAddress"\r\n\r\n'
        + `${WALLET}\r\n`
        + `--${boundary}\r\n`
        + 'Content-Disposition: form-data; name="network"\r\n\r\n'
        + 'mainnet\r\n'
        + `--${boundary}\r\n`
        + 'Content-Disposition: form-data; name="payload"; filename="payload.bin"\r\n'
        + 'Content-Type: application/octet-stream\r\n\r\n'
      const tail = `\r\n--${boundary}--\r\n`
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(head))
          controller.enqueue(payload)
          controller.enqueue(new TextEncoder().encode(tail))
          controller.close()
        },
      })
      return new Request('http://uploader.test/v1/uploads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })
    }

    const staging = createMemoryWalrusUploadStaging()
    let releaseEncodeBlob: (() => void) | null = null
    const encodeBlobGate = new Promise<void>((resolve) => { releaseEncodeBlob = resolve })
    let activeEncodeCount = 0
    let peakEncodeCount = 0
    const certificate = {
      signers: [0],
      serializedMessage: new Uint8Array([8]),
      signature: new Uint8Array([9]),
    }
    const walrusClient = {
      encodeBlob: vi.fn(async (payload: Uint8Array) => {
        activeEncodeCount += 1
        peakEncodeCount = Math.max(peakEncodeCount, activeEncodeCount)
        try {
          await encodeBlobGate
        } finally {
          activeEncodeCount -= 1
        }
        return {
          blobId: 'blob-id-concurrent',
          rootHash: new Uint8Array([7, 7, 7]),
          metadata: { V1: { unencoded_length: BigInt(payload.byteLength) } },
          sliversByNode: [{ primary: [{ sliver: new Uint8Array([4]) }], secondary: [] }],
        }
      }),
      writeEncodedBlobToNodes: vi.fn(async () => ['confirmation']),
      getStorageConfirmations: vi.fn(async () => ['confirmation']),
      certificateFromConfirmations: vi.fn(async () => certificate),
      systemState: vi.fn(async () => ({
        committee: { n_shards: 1, members: [{ weight: 1 }] },
      })),
    }
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging,
      createWalrusClient: async () => walrusClient as never,
      validateRegister: async () => [],
      nowMs: () => Date.now(),
    })

    const sharedToken = makeToken(/* fileCount */ 5, /* byteLimit */ 1024)
    const payloadBytes = new Uint8Array(600).fill(7)

    const requests = [
      buildStreamingRequest(sharedToken, payloadBytes),
      buildStreamingRequest(sharedToken, payloadBytes),
      buildStreamingRequest(sharedToken, payloadBytes),
    ]
    const responsesPromise = Promise.all(requests.map((req) => handler(req)))

    // Yield long enough for each handler to authenticate and either reserve
    // or reject. Then release the encodeBlob gate so the winning upload can
    // complete.
    await new Promise((resolve) => setTimeout(resolve, 10))
    releaseEncodeBlob!()
    const responses = await responsesPromise
    const statuses = responses.map((r) => r.status).sort((a, b) => a - b)

    expect(statuses).toEqual([200, 413, 413])
    expect(peakEncodeCount).toBe(1)
    expect(walrusClient.encodeBlob).toHaveBeenCalledTimes(1)

    // The 413 carries the byte-limit guard message produced by the early
    // reservation check, distinguishing this regression from the previous
    // post-parse path which surfaced a 400 with the same message.
    const rejectedBodies = await Promise.all(
      responses.filter((r) => r.status === 413).map((r) => r.json()),
    )
    for (const body of rejectedBodies) {
      expect(body).toEqual({ error: 'Walrus uploader token byte limit exceeded' })
    }
  })

  it('finalizes a completed upload by deleting staged payload state', async () => {
    const staging = createMemoryWalrusUploadStaging()
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging,
      createWalrusClient: async () => {
        throw new Error('not used')
      },
      validateRegister: async () => [],
      nowMs: () => Date.now(),
    })
    await staging.put({
      uploadId: 'upload-1',
      walletAddress: WALLET,
      network: 'mainnet',
      blobId: 'blob-id-0',
      rootHash: new Uint8Array([1]),
      size: 1,
      metadata: null,
      sliversByNode: null,
      certificate: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      tokenId: 'token-1',
    })

    const response = await handler(new Request('http://uploader.test/v1/uploads/upload-1/finalize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${makeToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: WALLET, network: 'mainnet' }),
    }))

    expect(response.status).toBe(200)
    await expect(staging.get('upload-1')).resolves.toBeNull()
  })
})
