import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeWalrusCertificate, serializeWalrusEncodedBlob } from '@/lib/upload/walrus-batch-transport'

const WALLET = `0x${'1'.repeat(64)}`
const OTHER_WALLET = `0x${'9'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'2'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

const mockedRequireSoulCreateWalletIdentity = vi.hoisted(() => vi.fn())
const mockedCompleteWalrusBatchUpload = vi.hoisted(() => vi.fn())

class MockWalrusBatchCompleteError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'WalrusBatchCompleteError'
    this.status = status
  }
}

vi.mock('@/lib/soulidity/server', () => ({
  requireSoulCreateWalletIdentity: mockedRequireSoulCreateWalletIdentity,
}))

vi.mock('@/lib/upload/walrus-server-writer', () => ({
  completeWalrusBatchUpload: mockedCompleteWalrusBatchUpload,
  WalrusBatchCompleteError: MockWalrusBatchCompleteError,
}))

function makeBody(walletAddress = WALLET) {
  return {
    network: 'testnet',
    registerTxDigest: TX_DIGEST,
    walletAddress,
    blobs: [
      serializeWalrusEncodedBlob({
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
        metadata: { V1: { unencoded_length: 1n } },
        sliversByNode: [{
          primary: [{
            sliverIndex: 0,
            sliverPairIndex: 0,
            shardIndex: 0,
            sliver: new Uint8Array([1, 2]),
          }],
          secondary: [],
        }],
      }),
    ],
  }
}

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/walrus/batch/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/walrus/batch/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireSoulCreateWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1' },
      walletAddresses: [WALLET],
      primarySuiAddress: WALLET,
    })
    mockedCompleteWalrusBatchUpload.mockResolvedValue({
      files: [{
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
        certificate: {
          signers: [0],
          serializedMessage: new Uint8Array([1]),
          signature: new Uint8Array([2]),
        },
      }],
    })
  })

  async function callRoute(request: Request) {
    const { POST } = await import('../../web/app/api/walrus/batch/complete/route.ts')
    return POST(request)
  }

  it('rejects unauthenticated requests before invoking the writer', async () => {
    mockedRequireSoulCreateWalletIdentity.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: 'login required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    })

    const response = await callRoute(makeRequest(makeBody()))

    expect(response.status).toBe(401)
    expect(mockedCompleteWalrusBatchUpload).not.toHaveBeenCalled()
  })

  it('rejects walletAddress values outside the signed-in wallet bindings', async () => {
    const response = await callRoute(makeRequest(makeBody(OTHER_WALLET)))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'walletAddress does not match the signed-in wallet',
    })
    expect(mockedCompleteWalrusBatchUpload).not.toHaveBeenCalled()
  })

  it('rejects over-limit request bodies without reading Walrus storage nodes', async () => {
    const response = await callRoute(makeRequest(makeBody(), {
      'content-length': String(256 * 1024 * 1024),
    }))

    expect(response.status).toBe(413)
    expect(mockedCompleteWalrusBatchUpload).not.toHaveBeenCalled()
  })

  it('returns serialized certificates from a successful fake writer', async () => {
    const response = await callRoute(makeRequest(makeBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      files: [{
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
        certificate: serializeWalrusCertificate({
          signers: [0],
          serializedMessage: new Uint8Array([1]),
          signature: new Uint8Array([2]),
        }),
      }],
    })
    expect(mockedCompleteWalrusBatchUpload).toHaveBeenCalledWith({
      network: 'testnet',
      registerTxDigest: TX_DIGEST,
      walletAddress: WALLET,
      blobs: makeBody().blobs,
    })
  })

  it('maps register tx / blob mismatch validation failures to a recoverable 422', async () => {
    mockedCompleteWalrusBatchUpload.mockRejectedValueOnce(
      new MockWalrusBatchCompleteError('register tx blob mismatch', 422),
    )

    const response = await callRoute(makeRequest(makeBody()))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'register tx blob mismatch',
      recoverable: true,
    })
  })
})
