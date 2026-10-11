import { describe, expect, it, vi } from 'vitest'
import {
  completeBatchWalrusUploadAfterRegister,
  type BatchWalrusRegisterIntent,
} from '@/lib/upload/client-upload'
import {
  deserializeWalrusCertificate,
  deserializeWalrusTransportValue,
  serializeWalrusCertificate,
  serializeWalrusEncodedBlob,
  serializeWalrusTransportValue,
} from '@/lib/upload/walrus-batch-transport'

function buildResumeIntentWithWalrusClient(walrusClient: unknown): BatchWalrusRegisterIntent {
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
      network: 'testnet',
      walletAddress: `0x${'1'.repeat(64)}`,
      storageEpochs: 3,
      suiClient: {},
      walrusClient,
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
        blobId: 'blob-id-0',
        rootHash: new Uint8Array([1]),
        metadata: {
          V1: {
            encoding_type: 'RS2',
            unencoded_length: 1n,
            hashes: [{
              primary_hash: { Digest: new Uint8Array([1, 2, 3]) },
              secondary_hash: { Empty: true },
            }],
          },
        },
        sliversByNode: [{
          primary: [{
            sliverIndex: 0,
            sliverPairIndex: 0,
            shardIndex: 0,
            sliver: new Uint8Array([4, 5]),
          }],
          secondary: [],
        }],
      }],
      recoveryKey: 'recovery-key',
      resumedBlobObjectIds: [`0x${'2'.repeat(64)}`],
      quote: { id: 'quote-1' },
    },
  } as unknown as BatchWalrusRegisterIntent
}

describe('Walrus batch transport serialization', () => {
  it('round-trips nested metadata and slivers without losing bytes or bigint values', () => {
    const original = {
      metadata: {
        V1: {
          encoding_type: 'RS2',
          unencoded_length: 123n,
          hashes: [{
            primary_hash: { Digest: new Uint8Array([1, 2, 3]) },
            secondary_hash: { Empty: true },
          }],
        },
      },
      sliversByNode: [{
        primary: [{
          sliverIndex: 0,
          sliverPairIndex: 0,
          shardIndex: 0,
          sliver: new Uint8Array([4, 5, 6]),
        }],
        secondary: [],
      }],
    }

    const transported = serializeWalrusTransportValue(original)
    const restored = deserializeWalrusTransportValue(transported) as typeof original

    expect(restored.metadata.V1.unencoded_length).toBe(123n)
    expect(restored.metadata.V1.hashes[0].primary_hash.Digest).toBeInstanceOf(Uint8Array)
    expect(Array.from(restored.metadata.V1.hashes[0].primary_hash.Digest)).toEqual([1, 2, 3])
    expect(restored.sliversByNode[0].primary[0].sliver).toBeInstanceOf(Uint8Array)
    expect(Array.from(restored.sliversByNode[0].primary[0].sliver)).toEqual([4, 5, 6])
  })

  it('round-trips Walrus certificates for later certify_blob attachment', () => {
    const certificate = {
      signers: [0, 2],
      serializedMessage: new Uint8Array([9, 8, 7]),
      signature: new Uint8Array([6, 5, 4]),
    }

    const restored = deserializeWalrusCertificate(serializeWalrusCertificate(certificate))

    expect(restored.signers).toEqual([0, 2])
    expect(Array.from(restored.serializedMessage)).toEqual([9, 8, 7])
    expect(Array.from(restored.signature)).toEqual([6, 5, 4])
  })
})

describe('completeBatchWalrusUploadAfterRegister server transport', () => {
  it('uses /api/walrus/batch/complete when the legacy server transport is selected', async () => {
    const certificate = {
      signers: [0],
      serializedMessage: new Uint8Array([1]),
      signature: new Uint8Array([2]),
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      files: [{
        blobId: 'blob-id-0',
        blobObjectId: `0x${'2'.repeat(64)}`,
        certificate: serializeWalrusCertificate(certificate),
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const certifyBlob = vi.fn((args) => ({ certify: args }))
    const fakeWalrusClient = {
      writeEncodedBlobToNodes: vi.fn(async () => {
        throw new Error('browser storage-node write should not run')
      }),
      getStorageConfirmations: vi.fn(),
      certificateFromConfirmations: vi.fn(),
      systemState: vi.fn(),
      certifyBlob,
    }
    const intent = buildResumeIntentWithWalrusClient(fakeWalrusClient)

    try {
      const result = await completeBatchWalrusUploadAfterRegister({
        intent,
        authHeaders: { 'x-csrf-token': 'csrf' },
        transport: 'server',
      })

      expect(fakeWalrusClient.writeEncodedBlobToNodes).not.toHaveBeenCalled()
      expect(fakeWalrusClient.getStorageConfirmations).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledWith('/api/walrus/batch/complete', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf',
        }),
      }))
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
      expect(body).toMatchObject({
        network: 'testnet',
        registerTxDigest: 'register-tx',
        walletAddress: `0x${'1'.repeat(64)}`,
        blobs: [{
          blobId: 'blob-id-0',
          blobObjectId: `0x${'2'.repeat(64)}`,
        }],
      })
      expect(body.blobs[0]).toEqual(serializeWalrusEncodedBlob({
        blobId: 'blob-id-0',
        blobObjectId: `0x${'2'.repeat(64)}`,
        metadata: intent.__continuation.encodedList[0].metadata,
        sliversByNode: intent.__continuation.encodedList[0].sliversByNode,
      }))

      await result.attachCertifyCalls({ add: vi.fn() } as never)
      expect(certifyBlob).toHaveBeenCalledWith({
        blobId: 'blob-id-0',
        blobObjectId: `0x${'2'.repeat(64)}`,
        certificate,
        deletable: true,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
