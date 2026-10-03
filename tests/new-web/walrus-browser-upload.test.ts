import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Transaction } from '@mysten/sui/transactions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeBatchWalrusUploadAfterRegister,
  prepareBatchWalrusRegisterIntent,
  uploadSoulPayload,
} from '@/lib/upload/client-upload'
import { readWalrusBatchRecovery } from '@/lib/upload/walrus-recovery'
import * as durable from '@/lib/upload/walrus-single-upload'
import { walrusSingleKey, writeWalrusSingleRecord } from '@/lib/upload/walrus-single-operation'

// Real upload orchestration, validation, hashing, encryption, quotes and recovery;
// only the external Walrus/network and wallet boundaries are mocked. Retired
// proxy/JWT/serialized-certificate tests are not claimed as browser coverage.
const state = vi.hoisted(() => ({ client: {} as Record<string, unknown>, options: [] as unknown[] }))
vi.mock('../../web/node_modules/@mysten/walrus/dist/index.mjs', () => ({
  WalrusClient: class {
    constructor(options: unknown) { state.options.push(options); return state.client }
  },
  blobIdFromInt: (value: bigint) => `blob-${value}`,
}))

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}
const wallet = `0x${'1'.repeat(64)}`
const objectId = `0x${'2'.repeat(64)}`
const blobType = '0x123::blob::Blob'
const success = (digest: string) => ({ digest, effects: { status: { status: 'success' } } })
const payload = '{"name":"Public profile","description":"Browser-published metadata"}'
const file = () => new File([payload], 'profile.json', { type: 'application/json' })

function setup() {
  const encodeBlob = vi.fn(async (bytes: Uint8Array) => ({
    blobId: 'blob-1', rootHash: new Uint8Array([1]), metadata: { hash: createHash('sha256').update(bytes).digest('hex') },
    sliversByNode: [{ bytes: new Uint8Array(bytes) }],
  }))
  const client = {
    encodeBlob,
    storageCost: vi.fn(async () => ({ storageCost: 3n, writeCost: 2n, totalCost: 5n })),
    calculateUploadRelayTip: vi.fn(async () => 1n),
    registerBlob: vi.fn(() => (tx: Transaction) => tx.moveCall({ target: '0x2::test::register' })),
    certifyBlob: vi.fn(() => (tx: Transaction) => tx.moveCall({ target: '0x2::test::certify' })),
    getBlobType: vi.fn(async () => blobType),
    getBlobObject: vi.fn(async () => ({ id: objectId, blob_id: '1' })),
    writeEncodedBlobToNodes: vi.fn(async () => [{ node: 0 }]),
    getStorageConfirmations: vi.fn(async () => [{ node: 0 }]),
    certificateFromConfirmations: vi.fn(async () => ({ signers: [0], signature: 'sig', serializedMessage: 'message' })),
    systemState: vi.fn(async () => ({ committee: { n_shards: 1, members: [{ weight: 1 }] } })),
  }
  state.client = client
  const suiClient = {
    waitForTransaction: vi.fn(async () => ({})),
    getTransactionBlock: vi.fn(async () => ({ objectChanges: [{ type: 'created', objectType: blobType, objectId }] })),
  }
  return { client, suiClient }
}

describe('browser-only wallet-paid Walrus upload', () => {
  beforeEach(() => {
    state.options = []
    vi.stubGlobal('window', { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage() })
    vi.stubGlobal('navigator', { locks: { request: async (_key: string, _opts: unknown, fn: (lock: object) => unknown) => fn({}) } })
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected application HTTP request') }))
    vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
    vi.stubEnv('NEXT_PUBLIC_WALRUS_WASM_VERSION', 'test')
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it.each(['managed', 'server', 'browser'])('cannot select an owned backend through retired transport=%s', async (transport) => {
    vi.stubEnv('NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT', transport)
    const { client, suiClient } = setup()
    const confirmQuote = vi.fn(async () => true)
    const intent = await prepareBatchWalrusRegisterIntent({
      files: [{ file: file(), kind: 'soul-content', uploadType: 'public' }],
      walletAddress: wallet, suiClient, confirmQuote,
    })
    expect(intent.mode).toBe('fresh')
    expect(client.encodeBlob).toHaveBeenCalledOnce()
    expect(client.writeEncodedBlobToNodes).not.toHaveBeenCalled()
    expect(client.registerBlob).not.toHaveBeenCalled()
    expect(confirmQuote).toHaveBeenCalledOnce()
    expect(intent.quote.relayTipMist).toBe(0n)
    expect(intent.quote.walletSignatureCount).toBe(2)
    const tx = new Transaction()
    intent.appendRegisterCalls(tx)
    expect(tx.getData().commands).toHaveLength(2)
    const result = await completeBatchWalrusUploadAfterRegister({ intent, registerTxDigest: 'paid-register' })
    expect(client.writeEncodedBlobToNodes).toHaveBeenCalledWith(expect.objectContaining({ blobId: 'blob-1', objectId }))
    expect(result.files[0].contentHash).toBe(createHash('sha256').update(payload).digest('hex'))
    const certify = new Transaction()
    await result.attachCertifyCalls(certify)
    expect(certify.getData().commands).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(state.options.every((option) => !('uploadRelay' in (option as object)))).toBe(true)
    expect(readWalrusBatchRecovery(intent.__continuation.recoveryKey)).not.toBeNull()
    result.clearBatchRecovery()
    expect(readWalrusBatchRecovery(intent.__continuation.recoveryKey)).toBeNull()
  })

  it('declined or expired cost approval cannot expose a register intent or write bytes', async () => {
    const { client, suiClient } = setup()
    const params = { files: [{ file: file(), kind: 'soul-content' as const, uploadType: 'public' as const }], walletAddress: wallet, suiClient }
    await expect(prepareBatchWalrusRegisterIntent({ ...params, confirmQuote: async () => false })).rejects.toThrow('cancelled')
    await expect(prepareBatchWalrusRegisterIntent({ ...params, confirmQuote: async (quote) => { quote.expiresAt = 0; return true } })).rejects.toThrow('quote expired')
    expect(client.registerBlob).not.toHaveBeenCalled()
    expect(client.writeEncodedBlobToNodes).not.toHaveBeenCalled()
  })

  it('resumes already-paid encrypted bytes after a storage failure without another register or cost approval', async () => {
    const { client, suiClient } = setup()
    const params = {
      files: [{ file: file(), kind: 'soul-content' as const, uploadType: 'encrypted' as const }],
      walletAddress: wallet, suiClient, confirmQuote: vi.fn(async () => true),
    }
    const first = await prepareBatchWalrusRegisterIntent(params)
    const firstBytes = new Uint8Array(client.encodeBlob.mock.calls[0][0])
    expect(Buffer.from(firstBytes).toString()).not.toBe(payload)
    client.writeEncodedBlobToNodes.mockRejectedValueOnce(new Error('storage unavailable'))
    client.getStorageConfirmations.mockRejectedValueOnce(new Error('confirmations unavailable'))
    await expect(completeBatchWalrusUploadAfterRegister({ intent: first, registerTxDigest: 'paid-register' })).rejects.toThrow('confirmations unavailable')
    expect(readWalrusBatchRecovery(first.__continuation.recoveryKey)?.registerTxDigest).toBe('paid-register')
    const second = await prepareBatchWalrusRegisterIntent(params)
    expect(second.mode).toBe('resume')
    expect(client.encodeBlob.mock.calls[1][0]).toEqual(firstBytes)
    expect(params.confirmQuote).toHaveBeenCalledOnce()
    const tx = new Transaction()
    second.appendRegisterCalls(tx)
    expect(tx.getData().commands).toHaveLength(0)
    const completed = await completeBatchWalrusUploadAfterRegister({ intent: second })
    expect(completed.registerTxDigest).toBe('paid-register')
    expect(completed.files[0].sealMaterial).toEqual(first.__continuation.prepared[0].encrypted?.material)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves the paid digest when register object lookup fails, and re-resolves before resuming', async () => {
    const { suiClient } = setup()
    const params = { files: [{ file: file(), kind: 'soul-content' as const, uploadType: 'public' as const }], walletAddress: wallet, suiClient, confirmQuote: vi.fn(async () => true) }
    const first = await prepareBatchWalrusRegisterIntent(params)
    suiClient.getTransactionBlock.mockRejectedValueOnce(new Error('lookup unavailable'))
    await expect(completeBatchWalrusUploadAfterRegister({ intent: first, registerTxDigest: 'paid-register' })).rejects.toThrow('lookup unavailable')
    expect(readWalrusBatchRecovery(first.__continuation.recoveryKey)?.blobs[0].blobObjectId).toBeNull()
    const resumed = await prepareBatchWalrusRegisterIntent(params)
    expect(resumed.mode).toBe('resume')
    expect(resumed.resumedRegisterTxDigest).toBe('paid-register')
    expect(params.confirmQuote).toHaveBeenCalledOnce()
    expect(readWalrusBatchRecovery(first.__continuation.recoveryKey)?.blobs[0].blobObjectId).toBe(objectId)
  })

  it('passes validated public JSON, real execution and scoped attachment into the durable SDK flow', async () => {
    setup()
    const attachment = { scope: 'profile:original-intent', append: vi.fn() }
    const execution = { client: {} as any, getAddress: () => wallet, sign: vi.fn() }
    const stored = { blobId: 'blob-1', blobObjectId: objectId, storageTxDigest: 'register',
      certifyTxDigest: 'certify', certifyTxResult: success('certify'), quoteId: 'quote', recoveryKey: 'recovery' }
    const run = vi.spyOn(durable, 'uploadDurableWalrusBlob').mockImplementationOnce(async params => {
      expect(params.execution).toEqual(execution); expect(params.attachment).toEqual(attachment)
      expect(new TextDecoder().decode(params.payload)).toBe(payload)
      expect(params.intent.operationScope).toBe('profile:original-intent')
      expect(params.intent.attachmentScope).toBe(attachment.scope)
      await params.approve()
      await params.createClient(1n)
      return stored as any
    })
    const result = await uploadSoulPayload({ file: file(), kind: 'soul-content', uploadType: 'public',
      walletAddress: wallet, execution, operationScope: 'profile:original-intent', attachment, confirmQuote: async () => true })
    expect(result.contentHash).toBe(createHash('sha256').update(payload).digest('hex'))
    expect(result.certifyTxResult).toEqual(success('certify')); expect(result.recoveryKey).toBe('recovery')
    expect(state.options).toContainEqual(expect.objectContaining({ uploadRelay: expect.objectContaining({ host: 'https://upload-relay.mainnet.walrus.space' }) }))
    expect(fetch).not.toHaveBeenCalled(); run.mockRestore()
  })

  it('has no owned upload endpoint, transport module or application auth dependency', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    expect(source).not.toMatch(/fetch\(|\/api\/walrus\/|getConfiguredWalrusUploadTransport|managedUploader|completeEncodedBlobsViaServer/)
    for (const path of ['web/lib/upload/walrus-managed-transport.ts', 'web/lib/upload/walrus-batch-transport.ts', 'web/lib/upload/walrus-server-writer.ts', 'web/app/api/walrus/upload-token/route.ts', 'web/app/api/walrus/batch/complete/route.ts']) {
      expect(existsSync(path), path).toBe(false)
    }
  })

  it('retires the now-unused owned uploader source and its dedicated deployment dependencies', () => {
    for (const path of ['services/walrus-uploader/package.json', 'services/walrus-uploader/package-lock.json',
      'services/walrus-uploader/Dockerfile', 'services/walrus-uploader/src/server.ts',
      'services/walrus-uploader/src/handler.ts', 'services/walrus-uploader/src/codec.ts',
      'services/walrus-uploader/src/staging.ts', 'src/shared/walrus-uploader-token.ts']) {
      expect(existsSync(path), path).toBe(false)
    }
    expect(readFileSync('.github/workflows/soulidity-fast-path-smoke.yml', 'utf8')).not.toContain('services/walrus-uploader')
    expect(readFileSync('.env.example', 'utf8')).not.toMatch(/WALRUS_UPLOADER|NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT|STAGING_BACKEND|GCS_PREFIX=walrus-uploader/)
  })

  // Paid register/relay failure replay now exercises actual Walrus SDK graphs,
  // durable BCS packets and real Ed25519 in walrus-single-upload.test.ts.
  it('preserves public recovery scope and content identity across a failed durable attempt', async () => {
    setup()
    const execution = { client: {} as any, getAddress: () => wallet, sign: vi.fn() }
    const run = vi.spyOn(durable, 'uploadDurableWalrusBlob')
      .mockRejectedValueOnce(new Error('WALRUS_TRANSACTION_UNKNOWN_QUERY_SAME_DIGEST'))
      .mockResolvedValueOnce({ blobId: 'blob-1', blobObjectId: objectId, storageTxDigest: 'original-register',
        certifyTxDigest: 'certify', certifyTxResult: success('certify'), quoteId: 'quote', recoveryKey: 'recovery' } as any)
    const params = { file: file(), kind: 'soul-content' as const, uploadType: 'public' as const,
      walletAddress: wallet, execution, operationScope: 'profile:original-intent', attachment: null,
      confirmQuote: vi.fn(async () => true) }
    await expect(uploadSoulPayload(params)).rejects.toThrow('UNKNOWN_QUERY_SAME_DIGEST')
    const result = await uploadSoulPayload(params)
    expect(run.mock.calls[0][0].intent).toEqual(run.mock.calls[1][0].intent)
    expect(result.storageTxDigest).toBe('original-register'); expect(result.recoveryKey).toBe('recovery')
    expect(execution.sign).not.toHaveBeenCalled(); expect(params.confirmQuote).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled(); run.mockRestore()
  })

  it('rejects malformed public JSON before encoding, approval, payment or upload', async () => {
    const { client, suiClient } = setup()
    const confirmQuote = vi.fn(async () => true)
    await expect(prepareBatchWalrusRegisterIntent({
      files: [{ file: new File(['not json'], 'profile.json', { type: 'application/json' }), kind: 'soul-content', uploadType: 'public' }],
      walletAddress: wallet, suiClient, confirmQuote,
    })).rejects.toThrow()
    expect(client.encodeBlob).not.toHaveBeenCalled()
    expect(confirmQuote).not.toHaveBeenCalled()
    expect(client.writeEncodedBlobToNodes).not.toHaveBeenCalled()
  })

  it('same-session private retry preserves exact ciphertext without durable plaintext keys', async () => {
    setup()
    const payloads: Uint8Array[] = []
    const run = vi.spyOn(durable, 'uploadDurableWalrusBlob').mockImplementation(async params => {
      payloads.push(new Uint8Array(params.payload))
      throw new Error('unknown paid packet')
    })
    const params = { file: file(), kind: 'soul-content' as const, uploadType: 'encrypted' as const,
      walletAddress: wallet, execution: { client: {} as any, getAddress: () => wallet, sign: vi.fn() },
      operationScope: 'private-session-retry', attachment: null, confirmQuote: async () => true }
    await expect(uploadSoulPayload(params)).rejects.toThrow('unknown paid packet')
    await expect(uploadSoulPayload(params)).rejects.toThrow('unknown paid packet')
    expect(payloads[0]).toEqual(payloads[1]); expect(new TextDecoder().decode(payloads[0])).not.toBe(payload)
    expect(window.localStorage.length).toBe(0)
    await expect(uploadSoulPayload({ ...params, file: new File(['{"other":"a different complete public profile"}'], 'profile.json', { type: 'application/json' }) }))
      .rejects.toThrow('PRIVATE_SOURCE_CHANGED_QUERY_EXISTING')
    expect(run).toHaveBeenCalledTimes(2); run.mockRestore()
  })

  it('private reload with a persisted prior scope but no DEK blocks fresh encryption and payment', async () => {
    setup()
    const intent = { network: 'mainnet' as const, owner: wallet, recipient: wallet, operationScope: 'private-refreshed-scope',
      attachmentScope: null, contentHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), payloadByteLength: 100,
      storageEpochs: 3, relayUrl: 'https://upload-relay.mainnet.walrus.space' }
    writeWalrusSingleRecord(walrusSingleKey(intent), { schema: 'soulidity.walrus-single.v1', intent,
      encoding: null, uploaded: null, approved: null, register: null, certify: null, acknowledged: false })
    const run = vi.spyOn(durable, 'uploadDurableWalrusBlob')
    const sign = vi.fn(), approve = vi.fn(async () => true)
    await expect(uploadSoulPayload({ file: file(), kind: 'soul-content', uploadType: 'encrypted', walletAddress: wallet,
      operationScope: intent.operationScope, attachment: null, execution: { client: {} as any, getAddress: () => wallet, sign }, confirmQuote: approve }))
      .rejects.toThrow('PRIVATE_RECOVERY_MATERIAL_REQUIRED_QUERY_ONLY')
    expect(run).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(1); run.mockRestore()
  })
})
