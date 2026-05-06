import { describe, expect, it, vi } from 'vitest'
import {
  completeBatchWalrusUploadAfterRegister,
  type BatchWalrusRegisterIntent,
} from '@/lib/upload/client-upload'
import { getConfiguredWalrusUploadTransport } from '@/lib/upload/walrus-batch-transport'

const WALLET = `0x${'1'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'2'.repeat(64)}`

function buildManagedResumeIntent(walrusClient: unknown): BatchWalrusRegisterIntent {
  return {
    mode: 'resume',
    fileCount: 1,
    blobUrls: ['http://example.test/blob-0'],
    contentHashes: ['content-hash-0'],
    skillBundleMetadata: [null],
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
      prepared: [{
        index: 0,
        item: { file: {} as File, uploadType: 'public', kind: 'soul-content' },
        contentType: 'text/plain',
        normalizedFile: {} as File,
        plaintext: new Uint8Array([10]),
        payload: new Uint8Array([10]),
        encrypted: null,
        contentHash: 'content-hash-0',
        skillBundleMetadata: null,
      }],
      encodedList: [{
        uploadId: 'upload-1',
        blobId: 'blob-id-0',
        rootHash: new Uint8Array([1]),
        size: 10,
      }],
      recoveryKey: 'recovery-key',
      resumedBlobObjectIds: [BLOB_OBJECT_ID],
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
})
