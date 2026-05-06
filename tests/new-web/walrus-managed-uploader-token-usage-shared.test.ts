import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryTokenUsageGuard,
  createMemoryWalrusUploadStaging,
  createWalrusUploaderHandler,
} from '../../services/walrus-uploader/src/handler'
import { createGcsTokenUsageGuard } from '../../services/walrus-uploader/src/token-usage-gcs'
import { createWalrusUploaderToken } from '../../src/shared/walrus-uploader-token'

const SECRET = 'uploader-secret-with-enough-entropy'
const WALLET = `0x${'1'.repeat(64)}`

function makeToken(fileCount: number, byteLimit: number) {
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

function buildStreamingRequest(token: string, payload: Uint8Array): Request {
  const boundary = '----walrus-shared-token-test-boundary'
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

function buildWalrusClient() {
  const certificate = {
    signers: [0],
    serializedMessage: new Uint8Array([8]),
    signature: new Uint8Array([9]),
  }
  return {
    encodeBlob: vi.fn(async (payload: Uint8Array) => ({
      blobId: 'blob-id-shared',
      rootHash: new Uint8Array([7, 7, 7]),
      metadata: { V1: { unencoded_length: BigInt(payload.byteLength) } },
      sliversByNode: [{ primary: [{ sliver: new Uint8Array([4]) }], secondary: [] }],
    })),
    writeEncodedBlobToNodes: vi.fn(async () => ['confirmation']),
    getStorageConfirmations: vi.fn(async () => ['confirmation']),
    certificateFromConfirmations: vi.fn(async () => certificate),
    systemState: vi.fn(async () => ({
      committee: { n_shards: 1, members: [{ weight: 1 }] },
    })),
  }
}

describe('walrus-uploader shared token usage guard', () => {
  it('enforces the per-token byte budget across multiple handler instances using one shared guard', async () => {
    // Simulate a Cloud Run deployment with two warm instances behind the
    // load balancer: each instance constructs its own handler, but they
    // share a single TokenUsageGuard backed by atomic state. Without that
    // sharing each instance starts with an empty usages map and can each
    // accept up to the full token budget — exactly the multi-instance
    // amplification path R-001 calls out.
    const sharedGuard = createInMemoryTokenUsageGuard({ nowMs: () => Date.now() })

    function buildInstance() {
      const staging = createMemoryWalrusUploadStaging()
      const walrusClient = buildWalrusClient()
      const handler = createWalrusUploaderHandler({
        tokenSecret: SECRET,
        staging,
        createWalrusClient: async () => walrusClient as never,
        validateRegister: async () => [],
        nowMs: () => Date.now(),
        tokenUsage: sharedGuard,
      })
      return { handler, walrusClient }
    }

    const instanceA = buildInstance()
    const instanceB = buildInstance()
    const token = makeToken(/* fileCount */ 5, /* byteLimit */ 1024)
    const payload = new Uint8Array(600).fill(7)

    // Request 1: instance A — should succeed (uses 600 / 1024 bytes).
    const responseA = await instanceA.handler(buildStreamingRequest(token, payload))
    expect(responseA.status).toBe(200)

    // Request 2: instance B — must observe the shared 600 already reserved
    // and reject the second 600-byte upload before encodeBlob runs. With a
    // per-instance guard this would succeed and double the budget.
    const responseB = await instanceB.handler(buildStreamingRequest(token, payload))
    expect(responseB.status).toBe(413)
    expect(instanceB.walrusClient.encodeBlob).not.toHaveBeenCalled()
    await expect(responseB.json()).resolves.toEqual({
      error: 'Walrus uploader token byte limit exceeded',
    })
  })

  it('GCS-backed guard converges on the per-token byte budget under concurrent CAS conflict', async () => {
    // Stand up a fake GCS HTTP layer for the token-usage object: every
    // mutation goes through `?uploadType=media&...&ifGenerationMatch=N`,
    // returning 412 when the generation no longer matches. The simulator
    // serializes accepted writes so two parallel guards behave the same as
    // two Cloud Run instances racing through GCS.
    interface FakeObject { generation: number; body: string }
    const objects = new Map<string, FakeObject>()
    let seq = 0
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://storage.googleapis.com/upload/storage/v1/b/')) {
        const parsed = new URL(url)
        const name = parsed.searchParams.get('name')!
        const expected = parsed.searchParams.get('ifGenerationMatch')!
        const live = objects.get(name)
        const liveGeneration = live ? live.generation : 0
        if (Number(expected) !== liveGeneration) {
          return new Response('precondition failed', { status: 412 })
        }
        const nextGeneration = (seq += 1)
        objects.set(name, { generation: nextGeneration, body: String(init?.body ?? '') })
        return new Response('{}', {
          status: 200,
          headers: { 'x-goog-generation': String(nextGeneration) },
        })
      }
      if (url.startsWith('https://storage.googleapis.com/storage/v1/b/')) {
        const path = new URL(url).pathname
        const match = /\/o\/([^/?]+)$/.exec(path)
        const name = match ? decodeURIComponent(match[1]) : ''
        const live = objects.get(name)
        if (!live) return new Response('not found', { status: 404 })
        return new Response(live.body, {
          status: 200,
          headers: { 'x-goog-generation': String(live.generation) },
        })
      }
      return new Response('unexpected', { status: 500 })
    })

    const guardA = createGcsTokenUsageGuard({
      bucketName: 'clawnews-test',
      prefix: 'walrus-uploader/token-usage',
      nowMs: () => Date.now(),
      getAccessToken: async () => 'test-access-token',
      fetchImpl,
    })
    const guardB = createGcsTokenUsageGuard({
      bucketName: 'clawnews-test',
      prefix: 'walrus-uploader/token-usage',
      nowMs: () => Date.now(),
      getAccessToken: async () => 'test-access-token',
      fetchImpl,
    })

    const token = createWalrusUploaderToken({
      secret: SECRET,
      nowMs: Date.now(),
      ttlMs: 60_000,
      walletAddress: WALLET,
      network: 'mainnet',
      fileCount: 5,
      byteLimit: 1024,
    })
    const parts = token.split('.')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))

    const reservations = await Promise.all([
      guardA.tryReserve(payload, 600),
      guardB.tryReserve(payload, 600),
      guardA.tryReserve(payload, 600),
    ])
    const accepted = reservations.filter((r) => r.ok).length
    expect(accepted).toBe(1)
    const rejected = reservations.filter((r) => !r.ok)
    expect(rejected).toHaveLength(2)
    for (const result of rejected) {
      if (result.ok) continue
      expect(result.error).toBe('Walrus uploader token byte limit exceeded')
    }

    // The single accepted reservation should leave 1024 - 600 = 424 bytes.
    await expect(guardA.getRemainingByteBudget(payload)).resolves.toBe(424)
    await expect(guardB.getRemainingByteBudget(payload)).resolves.toBe(424)

    // Releasing the live claim restores the budget for either guard view.
    await guardB.releaseClaim(payload, 600)
    await expect(guardA.getRemainingByteBudget(payload)).resolves.toBe(1024)
  })
})
