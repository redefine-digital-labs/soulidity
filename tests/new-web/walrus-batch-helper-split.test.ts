import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const CLIENT_UPLOAD = 'web/lib/upload/client-upload.ts'

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

    it('uploads slivers and builds certificates in parallel via writeEncodedBlobAndBuildCertificate', () => {
      const fnStart = source.indexOf('export async function completeBatchWalrusUploadAfterRegister')
      const fnEnd = source.indexOf('export async function prepareSoulBlobsForBatchPublish', fnStart)
      const block = source.slice(fnStart, fnEnd)
      expect(block).toContain('Promise.all(')
      expect(block).toContain('writeEncodedBlobAndBuildCertificate(')
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
