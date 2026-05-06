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

  it('preflight allows the X-Walrus-Payload-Bytes request header so cross-origin browser uploads are not blocked', async () => {
    // The browser managed transport sends `X-Walrus-Payload-Bytes` on every
    // /v1/uploads request so the uploader can reserve the exact payload byte
    // count (matches the token's payload-byte budget 1:1 instead of the
    // multipart-envelope-inflated `Content-Length`). Because the uploader is
    // a separate Cloud Run origin, that custom header triggers a CORS
    // preflight; if the handler's allow-headers list omits it the browser
    // blocks the upload before it ever reaches the handler. This regression
    // verifies the preflight response advertises the header.
    const staging = createMemoryWalrusUploadStaging()
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging,
      createWalrusClient: async () => {
        throw new Error('createWalrusClient must not be called for OPTIONS')
      },
      validateRegister: async () => [],
      nowMs: () => Date.now(),
    })

    const response = await handler(new Request('http://uploader.test/v1/uploads', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,x-walrus-payload-bytes',
      },
    }))

    expect(response.status).toBe(204)
    const allowedHeaders = (response.headers.get('Access-Control-Allow-Headers') ?? '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
    expect(allowedHeaders).toContain('authorization')
    expect(allowedHeaders).toContain('content-type')
    expect(allowedHeaders).toContain('x-walrus-payload-bytes')
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

  it('retries retryable storage-node write failures before giving up on completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T00:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
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
        writeEncodedBlobToNodes: vi.fn()
          .mockRejectedValueOnce(new Error('Too many failures while writing blob blob-id-0 to nodes'))
          .mockResolvedValueOnce(['confirmation']),
        getStorageConfirmations: vi.fn(async () => []),
        certificateFromConfirmations: vi.fn(async (args: { confirmations: unknown[] }) => {
          if (args.confirmations.length === 0) {
            throw new Error('Too many invalid confirmations received for blob (0 of 1)')
          }
          return certificate
        }),
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
      const handler = createWalrusUploaderHandler({
        tokenSecret: SECRET,
        staging,
        createWalrusClient: async () => walrusClient,
        validateRegister: async () => [{
          blobId: 'blob-id-0',
          blobObjectId: BLOB_OBJECT_ID,
        }],
        nowMs: () => Date.now(),
      })

      const uploadResponse = await handler(multipartUploadRequest(makeToken(), new Uint8Array([1, 2, 3])))
      const upload = await uploadResponse.json()
      const completePromise = handler(new Request(`http://uploader.test/v1/uploads/${upload.uploadId}/complete`, {
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

      await vi.advanceTimersByTimeAsync(1_500)

      const completeResponse = await completePromise
      expect(completeResponse.status).toBe(200)
      await expect(completeResponse.json()).resolves.toMatchObject({
        uploadId: upload.uploadId,
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
      })
      expect(walrusClient.writeEncodedBlobToNodes).toHaveBeenCalledTimes(2)
      expect(walrusClient.getStorageConfirmations).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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

  it('admits concurrent payload-bytes-declared uploads whose combined payload exactly fits the token byteLimit', async () => {
    // R-001 regression. Before the payload-aware reservation, four concurrent
    // multi-file uploads sharing one token would each reserve `Content-Length`
    // (payload + multipart envelope) and the last reservation would overflow
    // `byteLimit` even though the token's payload-byte budget is exactly
    // `4 × payload`. With `X-Walrus-Payload-Bytes` the server reserves
    // payload bytes 1:1 and all four siblings succeed.
    const staging = createMemoryWalrusUploadStaging()
    let releaseEncodeBlob: (() => void) | null = null
    const encodeBlobGate = new Promise<void>((resolve) => { releaseEncodeBlob = resolve })
    let encodeCallIndex = 0
    const certificate = {
      signers: [0],
      serializedMessage: new Uint8Array([8]),
      signature: new Uint8Array([9]),
    }
    const walrusClient = {
      encodeBlob: vi.fn(async (payload: Uint8Array) => {
        const ix = encodeCallIndex++
        await encodeBlobGate
        return {
          blobId: `blob-id-${ix}`,
          rootHash: new Uint8Array([7, ix & 0xff, 0]),
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

    const PAYLOAD_BYTES = 600
    const FILE_COUNT = 4
    const sharedToken = makeToken(FILE_COUNT, PAYLOAD_BYTES * FILE_COUNT)

    function buildRequest(token: string, payload: Uint8Array): Request {
      const form = new FormData()
      form.set('walletAddress', WALLET)
      form.set('network', 'mainnet')
      form.set('payload', new Blob([payload], { type: 'application/octet-stream' }), 'payload.bin')
      return new Request('http://uploader.test/v1/uploads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Walrus-Payload-Bytes': String(payload.byteLength),
        },
        body: form,
      })
    }

    const requests = Array.from({ length: FILE_COUNT }, () =>
      buildRequest(sharedToken, new Uint8Array(PAYLOAD_BYTES).fill(1)),
    )
    const responsesPromise = Promise.all(requests.map((req) => handler(req)))

    await new Promise((resolve) => setTimeout(resolve, 10))
    releaseEncodeBlob!()
    const responses = await responsesPromise

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200])
    expect(walrusClient.encodeBlob).toHaveBeenCalledTimes(FILE_COUNT)
  })

  it('rejects a payload-bytes-declared upload that exceeds the declared size', async () => {
    // Defence-in-depth: a client that declares a small payload but streams a
    // larger one must be bounded by both the multipart-body cap and the
    // post-parse payload-bytes assertion. The bounded body errors mid-stream
    // once total bytes exceed `claim + multipart overhead`, surfacing as 413.
    const staging = createMemoryWalrusUploadStaging()
    const walrusClient = {
      encodeBlob: vi.fn(async () => {
        throw new Error('encodeBlob must not be called when the budget is exceeded')
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

    const token = makeToken(1, 4 * 1024 * 1024)
    // Declared 16 bytes but actually streams ~2MB. The 64KB multipart
    // envelope cap is much smaller than the body, so the bounded-body cap
    // fires before the payload reaches the post-parse byte check.
    const boundary = '----walrus-lying-payload-bytes'
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
    const giant = new Uint8Array(2 * 1024 * 1024)
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
        Authorization: `Bearer ${token}`,
        'X-Walrus-Payload-Bytes': '16',
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

  it('does not block /health on staging.deleteExpired and throttles cleanup across requests', async () => {
    // R-001 regression. Previously the handler awaited
    // `deps.staging.deleteExpired(nowMs())` before serving every non-OPTIONS
    // request, including `/health`. The GCS staging backend amplifies
    // `deleteExpired` into a full prefix list + per-object body fetch, so a
    // single legitimate request paid the cost of every abandoned staged
    // upload sitting under the prefix. The handler now kicks cleanup off
    // fire-and-forget at a throttled interval; this regression locks both
    // properties in place.

    const staging = createMemoryWalrusUploadStaging()
    let pendingResolve: (() => void) | null = null
    const pending = new Promise<void>((resolve) => { pendingResolve = resolve })
    const deleteExpiredCalls: number[] = []
    const stubbedStaging = {
      ...staging,
      deleteExpired: vi.fn(async (nowMs: number) => {
        deleteExpiredCalls.push(nowMs)
        await pending
        return 0
      }),
    }

    let now = 1_000_000
    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging: stubbedStaging,
      createWalrusClient: async () => {
        throw new Error('not used')
      },
      validateRegister: async () => [],
      nowMs: () => now,
      stagingCleanupIntervalMs: 60_000,
    })

    // First /health: cleanup is kicked off, but the response must NOT wait
    // for `deleteExpired` to settle. The deferred is still pending here, so
    // a synchronous-await implementation would hang; this resolves quickly
    // because the cleanup is detached.
    const firstResponse = await handler(new Request('http://uploader.test/health', {
      method: 'GET',
    }))
    expect(firstResponse.status).toBe(200)
    expect(stubbedStaging.deleteExpired).toHaveBeenCalledTimes(1)

    // A second request inside the throttle window does NOT trigger another
    // cleanup. This guarantees abandoned staged uploads cannot be turned
    // into a request-rate amplification vector even with the kick-off
    // detached from the response.
    now += 1_000
    const secondResponse = await handler(new Request('http://uploader.test/health', {
      method: 'GET',
    }))
    expect(secondResponse.status).toBe(200)
    expect(stubbedStaging.deleteExpired).toHaveBeenCalledTimes(1)

    // Resolve the in-flight cleanup so a request after the throttle window
    // can kick off a fresh run. (If the previous run is still in flight,
    // the handler also skips the kick-off — protecting against cleanup
    // pile-up under sustained traffic.)
    pendingResolve!()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    now += 60_001
    const thirdResponse = await handler(new Request('http://uploader.test/health', {
      method: 'GET',
    }))
    expect(thirdResponse.status).toBe(200)
    expect(stubbedStaging.deleteExpired).toHaveBeenCalledTimes(2)
    expect(deleteExpiredCalls).toEqual([1_000_000, 1_000_000 + 1_000 + 60_001])
  })

  it('does not surface staging cleanup failures to the request response', async () => {
    // Failure isolation: a transient GCS list/delete failure during
    // background cleanup must not crash request handling. The previous
    // synchronous-await path turned cleanup errors into 4xx/5xx responses
    // for every legitimate request until the failure cleared.
    const staging = createMemoryWalrusUploadStaging()
    const stubbedStaging = {
      ...staging,
      deleteExpired: vi.fn(async () => {
        throw new Error('GCS list HTTP 503')
      }),
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const handler = createWalrusUploaderHandler({
      tokenSecret: SECRET,
      staging: stubbedStaging,
      createWalrusClient: async () => {
        throw new Error('not used')
      },
      validateRegister: async () => [],
      nowMs: () => Date.now(),
    })

    const response = await handler(new Request('http://uploader.test/health', {
      method: 'GET',
    }))
    expect(response.status).toBe(200)

    // Drain the detached cleanup microtask so the warn assertion is stable.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(stubbedStaging.deleteExpired).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('staging cleanup failed'),
      expect.stringContaining('GCS list HTTP 503'),
    )
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
