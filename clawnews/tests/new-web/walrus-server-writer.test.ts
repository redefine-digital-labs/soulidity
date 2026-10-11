import { describe, expect, it, vi } from 'vitest'
import {
  WalrusBatchCompleteError,
  resolveRegisteredWalrusBlobObjects,
  walrusBlobIdFromU256Decimal,
} from '@/lib/upload/walrus-server-writer'

const WALLET = `0x${'1'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'2'.repeat(64)}`
const BLOB_TYPE = `0x${'3'.repeat(64)}::blob::Blob`
const DIGEST = '11111111111111111111111111111111'

describe('Walrus server writer register validation', () => {
  it('maps the register tx Blob object back to the expected blob id', async () => {
    const blobId = walrusBlobIdFromU256Decimal('12345678901234567890')
    const suiClient = {
      waitForTransaction: vi.fn(async () => undefined),
      getTransactionBlock: vi.fn(async () => ({
        effects: { status: { status: 'success' } },
        transaction: { data: { sender: WALLET } },
        objectChanges: [{
          type: 'created',
          objectType: BLOB_TYPE,
          objectId: BLOB_OBJECT_ID,
        }],
      })),
    }
    const walrusClient = {
      getBlobType: vi.fn(async () => BLOB_TYPE),
      getBlobObject: vi.fn(async () => ({
        id: BLOB_OBJECT_ID,
        blob_id: '12345678901234567890',
        deletable: true,
      })),
    }

    await expect(resolveRegisteredWalrusBlobObjects({
      suiClient,
      walrusClient,
      digest: DIGEST,
      walletAddress: WALLET,
      expected: [{ blobId, blobObjectId: BLOB_OBJECT_ID }],
    })).resolves.toEqual([{ blobId, blobObjectId: BLOB_OBJECT_ID }])
  })

  it('rejects a register tx whose sender does not match the authenticated wallet', async () => {
    const suiClient = {
      waitForTransaction: vi.fn(async () => undefined),
      getTransactionBlock: vi.fn(async () => ({
        effects: { status: { status: 'success' } },
        transaction: { data: { sender: `0x${'9'.repeat(64)}` } },
        objectChanges: [],
      })),
    }
    const walrusClient = {
      getBlobType: vi.fn(async () => BLOB_TYPE),
      getBlobObject: vi.fn(),
    }

    await expect(resolveRegisteredWalrusBlobObjects({
      suiClient,
      walrusClient,
      digest: DIGEST,
      walletAddress: WALLET,
      expected: [{ blobId: 'blob-id-0', blobObjectId: BLOB_OBJECT_ID }],
    })).rejects.toMatchObject({
      name: 'WalrusBatchCompleteError',
      status: 403,
    } satisfies Partial<WalrusBatchCompleteError>)
  })

  it('rejects forged blobObjectId or blobId mismatches', async () => {
    const suiClient = {
      waitForTransaction: vi.fn(async () => undefined),
      getTransactionBlock: vi.fn(async () => ({
        effects: { status: { status: 'success' } },
        transaction: { data: { sender: WALLET } },
        objectChanges: [{
          type: 'created',
          objectType: BLOB_TYPE,
          objectId: BLOB_OBJECT_ID,
        }],
      })),
    }
    const walrusClient = {
      getBlobType: vi.fn(async () => BLOB_TYPE),
      getBlobObject: vi.fn(async () => ({
        id: BLOB_OBJECT_ID,
        blob_id: '12345678901234567890',
        deletable: true,
      })),
    }

    await expect(resolveRegisteredWalrusBlobObjects({
      suiClient,
      walrusClient,
      digest: DIGEST,
      walletAddress: WALLET,
      expected: [{ blobId: 'different-blob-id', blobObjectId: BLOB_OBJECT_ID }],
    })).rejects.toThrow(/does not match expected blobId/)

    await expect(resolveRegisteredWalrusBlobObjects({
      suiClient,
      walrusClient,
      digest: DIGEST,
      walletAddress: WALLET,
      expected: [{ blobId: 'different-blob-id', blobObjectId: `0x${'4'.repeat(64)}` }],
    })).rejects.toThrow(/did not create Blob object/)
  })
})
