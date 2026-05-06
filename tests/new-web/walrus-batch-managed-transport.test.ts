import { describe, expect, it, vi } from 'vitest'
import {
  completeBatchWalrusUploadAfterRegister,
  type BatchWalrusRegisterIntent,
} from '@/lib/upload/client-upload'
import { getConfiguredWalrusUploadTransport } from '@/lib/upload/walrus-batch-transport'

const WALLET = `0x${'1'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'2'.repeat(64)}`

function blobObjectIdAt(index: number): string {
  const hex = (index + 2).toString(16)
  return `0x${hex.repeat(64).slice(0, 64)}`
}

function buildManagedResumeIntent(walrusClient: unknown, fileCount = 1): BatchWalrusRegisterIntent {
  const prepared = Array.from({ length: fileCount }, (_, index) => ({
    index,
    item: { file: {} as File, uploadType: 'public', kind: 'soul-content' },
    contentType: 'text/plain',
    normalizedFile: {} as File,
    plaintext: new Uint8Array([10 + index]),
    payload: new Uint8Array([10 + index]),
    encrypted: null,
    contentHash: `content-hash-${index}`,
    skillBundleMetadata: null,
  }))
  const encodedList = Array.from({ length: fileCount }, (_, index) => ({
    uploadId: `upload-${index + 1}`,
    blobId: `blob-id-${index}`,
    rootHash: new Uint8Array([index + 1]),
    size: 10 + index,
  }))
  const blobObjectIds = Array.from({ length: fileCount }, (_, index) =>
    index === 0 ? BLOB_OBJECT_ID : blobObjectIdAt(index),
  )
  return {
    mode: 'resume',
    fileCount,
    blobUrls: Array.from({ length: fileCount }, (_, index) => `http://example.test/blob-${index}`),
    contentHashes: prepared.map((item) => item.contentHash),
    skillBundleMetadata: prepared.map((item) => item.skillBundleMetadata),
    quote: { id: 'quote-1' },
    resumedRegisterTxDigest: 'register-tx',
    appendRegisterCalls: vi.fn(),
    __continuation: {
      network: 'mainnet',
      walletAddress: WALLET,
      storageEpochs: 3,
      suiClient: {},
      walrusClient,
      transport: 'managed',
      prepared,
      encodedList,
      recoveryKey: 'recovery-key',
      resumedBlobObjectIds: blobObjectIds,
      quote: { id: 'quote-1' },
      managedUploader: {
        url: 'https://uploader.example',
        token: 'token-1',
      },
    },
  } as unknown as BatchWalrusRegisterIntent
}

describe('Walrus managed upload transport', () => {
  it('defaults new uploads to the managed uploader transport', () => {
    expect(getConfiguredWalrusUploadTransport()).toBe('managed')
  })

  it('completes via the uploader service without sending slivers to Vercel batch route', async () => {
    const certificate = {
      signers: [0],
      serializedMessage: 'CA',
      signature: 'CQ',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://uploader.example/v1/uploads/upload-1/complete')
      return new Response(JSON.stringify({
        uploadId: 'upload-1',
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
        certificate,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const certifyBlob = vi.fn((args) => ({ certify: args }))
    const fakeWalrusClient = {
      writeEncodedBlobToNodes: vi.fn(),
      certifyBlob,
    }
    const intent = buildManagedResumeIntent(fakeWalrusClient)

    try {
      const result = await completeBatchWalrusUploadAfterRegister({ intent })

      expect(fakeWalrusClient.writeEncodedBlobToNodes).not.toHaveBeenCalled()
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
      expect(body).toEqual({
        walletAddress: WALLET,
        network: 'mainnet',
        registerTxDigest: 'register-tx',
        blobObjectId: BLOB_OBJECT_ID,
      })
      expect(JSON.stringify(body)).not.toContain('sliversByNode')

      await result.attachCertifyCalls({ add: vi.fn() } as never)
      expect(certifyBlob).toHaveBeenCalledWith({
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
        certificate: {
          signers: [0],
          serializedMessage: new Uint8Array([8]),
          signature: new Uint8Array([9]),
        },
        deletable: true,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('completes managed uploads sequentially to avoid concurrent uploader memory spikes', async () => {
    const certificate = {
      signers: [0],
      serializedMessage: 'CA',
      signature: 'CQ',
    }
    let activeCompletes = 0
    let peakCompletes = 0
    const callOrder: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const uploadId = String(input).match(/\/v1\/uploads\/([^/]+)\/complete$/)?.[1]
      if (!uploadId) throw new Error(`Unexpected managed uploader URL: ${String(input)}`)
      const index = Number(uploadId.replace('upload-', '')) - 1
      activeCompletes += 1
      peakCompletes = Math.max(peakCompletes, activeCompletes)
      callOrder.push(`start:${uploadId}`)
      await new Promise((resolve) => setTimeout(resolve, 0))
      callOrder.push(`finish:${uploadId}`)
      activeCompletes -= 1
      return new Response(JSON.stringify({
        uploadId,
        blobId: `blob-id-${index}`,
        blobObjectId: index === 0 ? BLOB_OBJECT_ID : blobObjectIdAt(index),
        certificate,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const fakeWalrusClient = {
      writeEncodedBlobToNodes: vi.fn(),
      certifyBlob: vi.fn((args) => ({ certify: args })),
    }
    const intent = buildManagedResumeIntent(fakeWalrusClient, 3)

    try {
      await completeBatchWalrusUploadAfterRegister({ intent })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(peakCompletes).toBe(1)
      expect(callOrder).toEqual([
        'start:upload-1',
        'finish:upload-1',
        'start:upload-2',
        'finish:upload-2',
        'start:upload-3',
        'finish:upload-3',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('lets managed completion wait for the uploader service instead of aborting in the frontend', async () => {
    vi.useFakeTimers()
    vi.stubEnv('NEXT_PUBLIC_WALRUS_MANAGED_COMPLETE_TIMEOUT_MS', '25')
    const certificate = {
      signers: [0],
      serializedMessage: 'CA',
      signature: 'CQ',
    }
    let abortCount = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((resolve) => {
        init?.signal?.addEventListener('abort', () => {
          abortCount += 1
        })
        setTimeout(() => {
          resolve(new Response(JSON.stringify({
            uploadId: 'upload-1',
            blobId: 'blob-id-0',
            blobObjectId: BLOB_OBJECT_ID,
            certificate,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        }, 50)
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const fakeWalrusClient = {
      writeEncodedBlobToNodes: vi.fn(),
      certifyBlob: vi.fn((args) => ({ certify: args })),
    }
    const intent = buildManagedResumeIntent(fakeWalrusClient)

    try {
      const pending = completeBatchWalrusUploadAfterRegister({ intent })
      await vi.advanceTimersByTimeAsync(25)
      expect(abortCount).toBe(0)
      await vi.advanceTimersByTimeAsync(25)
      const result = await pending
      await result.attachCertifyCalls({ add: vi.fn() } as never)
      expect(fakeWalrusClient.certifyBlob).toHaveBeenCalledWith({
        blobId: 'blob-id-0',
        blobObjectId: BLOB_OBJECT_ID,
        certificate: {
          signers: [0],
          serializedMessage: new Uint8Array([8]),
          signature: new Uint8Array([9]),
        },
        deletable: true,
      })
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
})
