import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  completeBatchWalrusUploadAfterRegister,
  hasWalrusWeightedQuorum,
  type BatchWalrusRegisterIntent,
} from '@/lib/upload/client-upload'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const CLIENT_UPLOAD = 'web/lib/upload/client-upload.ts'

function buildResumeIntentWithWalrusClient(walrusClient: unknown, fileCount = 1): BatchWalrusRegisterIntent {
  return {
    mode: 'resume',
    fileCount,
    blobUrls: Array.from({ length: fileCount }, (_, i) => `http://example.test/blob-${i}`),
    contentHashes: Array.from({ length: fileCount }, (_, i) => `content-hash-${i}`),
    skillBundleMetadata: Array.from({ length: fileCount }, () => null),
    quote: { id: 'quote-1' },
    resumedRegisterTxDigest: 'register-tx',
    appendRegisterCalls: vi.fn(),
    __continuation: {
      network: 'testnet',
      walletAddress: '0xabc',
      storageEpochs: 3,
      suiClient: {},
      walrusClient,
      prepared: Array.from({ length: fileCount }, (_, i) => ({
        index: 0,
        item: { file: {} as File, uploadType: 'public', kind: 'soul-content' },
        contentType: 'text/plain',
        normalizedFile: {} as File,
        plaintext: new Uint8Array([10]),
        payload: new Uint8Array([10]),
        encrypted: null,
        contentHash: `content-hash-${i}`,
        skillBundleMetadata: null,
      })),
      encodedList: Array.from({ length: fileCount }, (_, i) => ({
        blobId: `blob-id-${i}`,
        rootHash: new Uint8Array([1]),
        metadata: {},
        sliversByNode: [],
      })),
      recoveryKey: 'recovery-key',
      resumedBlobObjectIds: Array.from({ length: fileCount }, (_, i) => `blob-object-id-${i}`),
      quote: { id: 'quote-1' },
    },
  } as unknown as BatchWalrusRegisterIntent
}

describe('walrus weighted quorum guard', () => {
  it('uses signer weight, not node count, and passes at the Move quorum threshold', () => {
    expect(hasWalrusWeightedQuorum({
      signerWeights: [1, 1, 1, 1],
      nShards: 10,
    })).toBe(false)
    expect(hasWalrusWeightedQuorum({
      signerWeights: [6],
      nShards: 10,
    })).toBe(false)
    expect(hasWalrusWeightedQuorum({
      signerWeights: [7],
      nShards: 10,
    })).toBe(true)
  })
})

describe('walrus batch helper 3-phase split', () => {
  describe('prepareBatchWalrusRegisterIntent', () => {
    const source = readSource(CLIENT_UPLOAD)

    it('exports the register-intent function with the documented shape', () => {
      expect(source).toContain('export async function prepareBatchWalrusRegisterIntent')
      expect(source).toContain('export interface BatchWalrusRegisterIntent')
      // Must expose the 4 fields callers consume pre-signature.
      expect(source).toMatch(/blobUrls:\s*string\[\]/)
      expect(source).toMatch(/contentHashes:\s*string\[\]/)
      expect(source).toMatch(/appendRegisterCalls:\s*\(tx:\s*Transaction\)\s*=>\s*void/)
      expect(source).toMatch(/quote:\s*WalrusUploadQuote/)
    })

    it('decides resume vs fresh BEFORE any wallet signature', () => {
      const fnStart = source.indexOf('export async function prepareBatchWalrusRegisterIntent')
      const fnEnd = source.indexOf('export async function completeBatchWalrusUploadAfterRegister', fnStart)
      expect(fnStart).toBeGreaterThanOrEqual(0)
      expect(fnEnd).toBeGreaterThan(fnStart)
      const block = source.slice(fnStart, fnEnd)
      // No signAndExecute / wallet sign in this phase.
      expect(block).not.toMatch(/signAndExecute\s*\(/)
      // Resume vs fresh decision.
      expect(block).toContain("mode = 'resume'")
      expect(block).toContain("mode = 'fresh'")
      // Orphan-mismatch path throws WalrusUploadResumeMismatchError before
      // any signature would happen.
      expect(block).toContain('throw new WalrusUploadResumeMismatchError')
    })

    it('only asks for UploadCostReview on fresh register attempts, not resume', () => {
      const fnStart = source.indexOf('export async function prepareBatchWalrusRegisterIntent')
      const fnEnd = source.indexOf('export async function completeBatchWalrusUploadAfterRegister', fnStart)
      expect(fnStart).toBeGreaterThanOrEqual(0)
      expect(fnEnd).toBeGreaterThan(fnStart)
      const block = source.slice(fnStart, fnEnd)
      const recoveryDecision = block.indexOf("mode = 'resume'")
      const freshGuard = block.indexOf("if (mode === 'fresh')")
      const confirmCall = block.indexOf('params.confirmQuote(quote)')
      expect(recoveryDecision).toBeGreaterThanOrEqual(0)
      expect(freshGuard).toBeGreaterThan(recoveryDecision)
      expect(confirmCall).toBeGreaterThan(freshGuard)
      expect(block.slice(freshGuard, confirmCall)).not.toContain("mode = 'resume'")
    })

    it('appendRegisterCalls is a no-op in resume mode', () => {
      // Resume reuses the prior register Blob objects — calling
      // appendRegisterCalls(tx) on a fresh Transaction must add 0 commands.
      const fnStart = source.indexOf('export async function prepareBatchWalrusRegisterIntent')
      const blockEnd = source.indexOf('export async function completeBatchWalrusUploadAfterRegister', fnStart)
      const block = source.slice(fnStart, blockEnd)
      const appendStart = block.indexOf('const appendRegisterCalls = (tx: Transaction)')
      expect(appendStart).toBeGreaterThanOrEqual(0)
      // First branch in the appendRegisterCalls body checks resume mode.
      expect(block.slice(appendStart)).toMatch(/if\s*\(\s*mode\s*===\s*'resume'\s*\)\s*return/)
    })

    it('emits N register_blob calls plus one transferObjects per blob in fresh mode', () => {
      const fnStart = source.indexOf('export async function prepareBatchWalrusRegisterIntent')
      const blockEnd = source.indexOf('export async function completeBatchWalrusUploadAfterRegister', fnStart)
      const block = source.slice(fnStart, blockEnd)
      // The fresh-mode loop body builds a registerBlob args list and then a
      // matching transferObjects loop — both must remain in the helper so
      // the caller's PTB1 includes register + transfer per file.
      expect(block).toContain('client.registerBlob({')
      expect(block).toContain('tx.transferObjects([blobArgs[i]], recipient)')
    })
  })

  describe('completeBatchWalrusUploadAfterRegister', () => {
    const source = readSource(CLIENT_UPLOAD)

    it('exports the completion function with the documented shape', () => {
      expect(source).toContain('export async function completeBatchWalrusUploadAfterRegister')
      expect(source).toContain('export interface CompleteBatchWalrusUploadResult')
      expect(source).toMatch(/files:\s*SoulUploadResult\[\]/)
      expect(source).toMatch(/registerTxDigest:\s*string/)
      expect(source).toMatch(/attachCertifyCalls:\s*\(tx:\s*Transaction,\s*indices\?/)
      expect(source).toMatch(/clearBatchRecovery:\s*\(\)\s*=>\s*void/)
    })

    it('rejects when objectChanges is missing the expected created Blob objects', () => {
      // The resolveCreatedBlobObjectIds helper is the gatekeeper. It throws
      // when the register tx produced fewer Blob objects than expectedBlobIds
      // length, which is what completeBatchWalrusUploadAfterRegister's
      // fresh-path calls into.
      const helperStart = source.indexOf('async function resolveCreatedBlobObjectIds')
      expect(helperStart).toBeGreaterThanOrEqual(0)
      const helperEnd = source.indexOf('\n}\n', helperStart)
      const helper = source.slice(helperStart, helperEnd)
      expect(helper).toMatch(/createdBlobObjectIds\.length\s*<\s*params\.expectedBlobIds\.length/)
      expect(helper).toContain('throw new Error')
    })

    it('persists batch recovery before resolving Blob object ids in the fresh path', () => {
      const fnStart = source.indexOf('export async function completeBatchWalrusUploadAfterRegister')
      const fnEnd = source.indexOf('export async function prepareSoulBlobsForBatchPublish', fnStart)
      expect(fnStart).toBeGreaterThanOrEqual(0)
      expect(fnEnd).toBeGreaterThan(fnStart)
      const block = source.slice(fnStart, fnEnd)
      const persistFirst = block.indexOf('persistWalrusBatchRecovery(recoveryKey, {')
      const resolveCall = block.indexOf('resolveCreatedBlobObjectIds(', persistFirst)
      const persistSecond = block.indexOf('persistWalrusBatchRecovery(recoveryKey, {', resolveCall)
      expect(persistFirst).toBeGreaterThanOrEqual(0)
      expect(resolveCall).toBeGreaterThan(persistFirst)
      expect(persistSecond).toBeGreaterThan(resolveCall)
    })

    it('keeps the browser rollback path sequential when writeEncodedBlobAndBuildCertificate is selected', () => {
      const fnStart = source.indexOf('export async function completeBatchWalrusUploadAfterRegister')
      const fnEnd = source.indexOf('export async function prepareSoulBlobsForBatchPublish', fnStart)
      const block = source.slice(fnStart, fnEnd)
      expect(block).toContain("transport === 'server'")
      expect(block).toContain('completeEncodedBlobsViaServer({')
      expect(block).toContain('const browserUploaded: Awaited<ReturnType<typeof writeEncodedBlobAndBuildCertificate>>[] = []')
      expect(block).toMatch(/for\s*\(\s*let i = 0;\s*i < prepared\.length;\s*i\+\+\s*\)/)
      expect(block).toContain('browserUploaded.push(await writeEncodedBlobAndBuildCertificate({')
      expect(block).toContain('writeEncodedBlobAndBuildCertificate(')
    })

    it('does not run multiple storage-node writes at the same time', async () => {
      let inFlight = 0
      let maxInFlight = 0
      const writeOrder: string[] = []
      const fakeWalrusClient = {
        writeEncodedBlobToNodes: vi.fn(async (params: { blobId: string }) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          writeOrder.push(`start:${params.blobId}`)
          await new Promise((resolve) => setTimeout(resolve, 0))
          writeOrder.push(`end:${params.blobId}`)
          inFlight -= 1
          return [`confirmation:${params.blobId}`]
        }),
        getStorageConfirmations: vi.fn(),
        certificateFromConfirmations: vi.fn(async (params: { blobId: string }) => ({
          signers: [0],
          serializedMessage: new Uint8Array([1]),
          signature: new Uint8Array([2]),
          blobId: params.blobId,
        })),
        systemState: vi.fn(async () => ({
          committee: {
            n_shards: 1,
            members: [{ weight: 1 }],
          },
        })),
        certifyBlob: vi.fn((args) => ({ certify: args })),
      }
      const intent = buildResumeIntentWithWalrusClient(fakeWalrusClient, 2)

      await completeBatchWalrusUploadAfterRegister({ intent, transport: 'browser' })

      expect(maxInFlight).toBe(1)
      expect(writeOrder).toEqual([
        'start:blob-id-0',
        'end:blob-id-0',
        'start:blob-id-1',
        'end:blob-id-1',
      ])
    })

    it('returns clearBatchRecovery wired to the recoveryKey, not auto-cleared', () => {
      // The result.clearBatchRecovery must be invoked by the CALLER after
      // PTB2 settles — auto-clearing inside complete() would lose the
      // resume hook on a downstream PTB2 failure.
      const fnStart = source.indexOf('export async function completeBatchWalrusUploadAfterRegister')
      const fnEnd = source.indexOf('export async function prepareSoulBlobsForBatchPublish', fnStart)
      const block = source.slice(fnStart, fnEnd)
      expect(block).toContain('clearBatchRecovery: () => clearWalrusBatchRecovery(recoveryKey)')
    })

    it('certify-attach helper supports the indices argument for chunked downstream PTBs', () => {
      const fnStart = source.indexOf('export async function completeBatchWalrusUploadAfterRegister')
      const fnEnd = source.indexOf('export async function prepareSoulBlobsForBatchPublish', fnStart)
      const block = source.slice(fnStart, fnEnd)
      expect(block).toContain('attachCertifyCalls = async (mintTx: Transaction, indices?: ReadonlyArray<number>)')
      expect(block).toContain('targetIndices = indices ?? uploaded.map((_, i) => i)')
      expect(block).toContain('out of range')
    })

    it('refreshes confirmations before exposing a low-weight certificate to certify calls', async () => {
      const lowWeightCertificate = {
        signers: [0, 1],
        serializedMessage: new Uint8Array([1]),
        signature: new Uint8Array([2]),
      }
      const quorumCertificate = {
        signers: [2],
        serializedMessage: new Uint8Array([3]),
        signature: new Uint8Array([4]),
      }
      const firstConfirmations = ['first']
      const refreshedConfirmations = ['refreshed']
      const certifyBlob = vi.fn((args) => ({ certify: args }))
      const fakeWalrusClient = {
        writeEncodedBlobToNodes: vi.fn(async () => firstConfirmations),
        getStorageConfirmations: vi.fn(async () => refreshedConfirmations),
        certificateFromConfirmations: vi
          .fn()
          .mockResolvedValueOnce(lowWeightCertificate)
          .mockResolvedValueOnce(quorumCertificate),
        systemState: vi.fn(async () => ({
          committee: {
            n_shards: 10,
            members: [
              { weight: 1 },
              { weight: 1 },
              { weight: 8 },
            ],
          },
        })),
        certifyBlob,
      }
      const intent = buildResumeIntentWithWalrusClient(fakeWalrusClient)

      const result = await completeBatchWalrusUploadAfterRegister({ intent, transport: 'browser' })

      expect(fakeWalrusClient.certificateFromConfirmations).toHaveBeenCalledTimes(2)
      expect(fakeWalrusClient.certificateFromConfirmations).toHaveBeenNthCalledWith(1, {
        confirmations: firstConfirmations,
        blobId: 'blob-id-0',
        blobObjectId: 'blob-object-id-0',
        deletable: true,
      })
      expect(fakeWalrusClient.getStorageConfirmations).toHaveBeenCalledTimes(1)
      expect(fakeWalrusClient.getStorageConfirmations).toHaveBeenCalledWith({
        blobId: 'blob-id-0',
        objectId: 'blob-object-id-0',
        deletable: true,
      })
      expect(fakeWalrusClient.certificateFromConfirmations).toHaveBeenNthCalledWith(2, {
        confirmations: refreshedConfirmations,
        blobId: 'blob-id-0',
        blobObjectId: 'blob-object-id-0',
        deletable: true,
      })

      const tx = { add: vi.fn() }
      await result.attachCertifyCalls(tx as never)
      expect(certifyBlob).toHaveBeenCalledWith({
        blobId: 'blob-id-0',
        blobObjectId: 'blob-object-id-0',
        certificate: quorumCertificate,
        deletable: true,
      })
      expect(tx.add).toHaveBeenCalledWith({ certify: expect.objectContaining({ certificate: quorumCertificate }) })
    })

    it('falls back to storage confirmations when a direct storage-node write stalls', async () => {
      vi.useFakeTimers()
      const quorumCertificate = {
        signers: [0],
        serializedMessage: new Uint8Array([1]),
        signature: new Uint8Array([2]),
      }
      const fakeWalrusClient = {
        writeEncodedBlobToNodes: vi.fn(() => new Promise<never>(() => {})),
        getStorageConfirmations: vi.fn(async () => ['confirmed-after-timeout']),
        certificateFromConfirmations: vi.fn(async () => quorumCertificate),
        systemState: vi.fn(async () => ({
          committee: {
            n_shards: 1,
            members: [{ weight: 1 }],
          },
        })),
        certifyBlob: vi.fn((args) => ({ certify: args })),
      }
      const intent = buildResumeIntentWithWalrusClient(fakeWalrusClient)

      try {
        const pending = completeBatchWalrusUploadAfterRegister({ intent, transport: 'browser' })
        await vi.advanceTimersByTimeAsync(20_000)
        const result = await pending

        expect(fakeWalrusClient.getStorageConfirmations).toHaveBeenCalledWith({
          blobId: 'blob-id-0',
          objectId: 'blob-object-id-0',
          deletable: true,
        })
        expect(fakeWalrusClient.certificateFromConfirmations).toHaveBeenCalledWith({
          confirmations: ['confirmed-after-timeout'],
          blobId: 'blob-id-0',
          blobObjectId: 'blob-object-id-0',
          deletable: true,
        })
        await result.attachCertifyCalls({ add: vi.fn() } as never)
      } finally {
        vi.useRealTimers()
      }
    })

    it('fails instead of hanging when storage confirmation lookup also stalls', async () => {
      vi.useFakeTimers()
      const fakeWalrusClient = {
        writeEncodedBlobToNodes: vi.fn(() => new Promise<never>(() => {})),
        getStorageConfirmations: vi.fn(() => new Promise<never>(() => {})),
        certificateFromConfirmations: vi.fn(),
        systemState: vi.fn(),
        certifyBlob: vi.fn(),
      }
      const intent = buildResumeIntentWithWalrusClient(fakeWalrusClient)

      try {
        const pending = expect(completeBatchWalrusUploadAfterRegister({ intent, transport: 'browser' })).rejects.toThrow(
          /Timed out fetching Walrus storage confirmations/,
        )
        await vi.advanceTimersByTimeAsync(40_000)
        await pending
        expect(fakeWalrusClient.certificateFromConfirmations).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('fails before certify attachment when refreshed certificates never reach weighted quorum', async () => {
      const lowWeightCertificate = {
        signers: [0, 1],
        serializedMessage: new Uint8Array([1]),
        signature: new Uint8Array([2]),
      }
      const fakeWalrusClient = {
        writeEncodedBlobToNodes: vi.fn(async () => ['first']),
        getStorageConfirmations: vi.fn(async () => ['refreshed']),
        certificateFromConfirmations: vi.fn(async () => lowWeightCertificate),
        systemState: vi.fn(async () => ({
          committee: {
            n_shards: 10,
            members: [
              { weight: 1 },
              { weight: 1 },
              { weight: 8 },
            ],
          },
        })),
        certifyBlob: vi.fn(),
      }
      const intent = buildResumeIntentWithWalrusClient(fakeWalrusClient)

      await expect(completeBatchWalrusUploadAfterRegister({ intent, transport: 'browser' })).rejects.toThrow(
        /blob-id-0.*blob-object-id-0.*signing weight 2.*n_shards 10/s,
      )
      expect(fakeWalrusClient.getStorageConfirmations).toHaveBeenCalledTimes(2)
      expect(fakeWalrusClient.certifyBlob).not.toHaveBeenCalled()
    })
  })

  describe('prepareSoulBlobsForBatchPublish (legacy wrapper)', () => {
    const source = readSource(CLIENT_UPLOAD)

    it('is a thin wrapper over the two phase functions', () => {
      const fnStart = source.indexOf('export async function prepareSoulBlobsForBatchPublish')
      // Find the next top-level export after the wrapper to bound the slice.
      const fnEnd = source.indexOf('\nexport async function ', fnStart + 1)
      expect(fnStart).toBeGreaterThanOrEqual(0)
      expect(fnEnd).toBeGreaterThan(fnStart)
      const block = source.slice(fnStart, fnEnd)
      expect(block).toContain('prepareBatchWalrusRegisterIntent({')
      expect(block).toContain('completeBatchWalrusUploadAfterRegister({')
      expect(block).toContain('intent.appendRegisterCalls(tx)')
    })

    it('asserts the register PTB succeeded BEFORE invoking the completion phase', () => {
      const fnStart = source.indexOf('export async function prepareSoulBlobsForBatchPublish')
      const fnEnd = source.indexOf('\nexport async function ', fnStart + 1)
      const block = source.slice(fnStart, fnEnd)
      const signCall = block.indexOf('await params.signAndExecute(tx)')
      const assertCall = block.indexOf("assertSuiTxSucceeded(registerResult, 'Walrus batch register transaction')", signCall)
      const completionCall = block.indexOf('completeBatchWalrusUploadAfterRegister(', signCall)
      expect(signCall).toBeGreaterThanOrEqual(0)
      expect(assertCall).toBeGreaterThan(signCall)
      expect(completionCall).toBeGreaterThan(assertCall)
    })
  })
})
