import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryTokenUsageGuard,
  createMemoryWalrusUploadStaging,
  createWalrusUploaderHandler,
} from '../../services/walrus-uploader/src/handler'
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
    // Simulate two in-process handlers sharing the same token guard. Without
    // that sharing each handler starts with an empty usages map and can each
    // accept up to the full token budget.
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
})
