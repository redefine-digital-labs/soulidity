import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regression coverage for R-001 (collection PTB1 crash recovery): the batch
 * Walrus register/upload helpers must persist enough material to reproduce
 * the prior ciphertext on resume. Without the cached AES-GCM key/IV, a fresh
 * re-encryption produces a different blobId and the resume path strands the
 * already-paid Blob objects via `WalrusUploadResumeMismatchError`.
 */

const CLIENT_SEAL = readFileSync(
  resolve(process.cwd(), 'web/lib/upload/client-seal.ts'),
  'utf8',
)
const CLIENT_UPLOAD = readFileSync(
  resolve(process.cwd(), 'web/lib/upload/client-upload.ts'),
  'utf8',
)
const WALRUS_RECOVERY = readFileSync(
  resolve(process.cwd(), 'web/lib/upload/walrus-recovery.ts'),
  'utf8',
)

describe('R-001 — batch Walrus resume reuses persisted DEK/IV', () => {
  it('exposes an optional `material` parameter on encryptClientSide for deterministic re-encryption', () => {
    const fnStart = CLIENT_SEAL.indexOf('export async function encryptClientSide')
    const fnEnd = CLIENT_SEAL.indexOf('\n}\n', fnStart)
    expect(fnStart).toBeGreaterThanOrEqual(0)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const block = CLIENT_SEAL.slice(fnStart, fnEnd)
    // Param is optional and typed.
    expect(block).toMatch(/material\?:\s*PendingSealMaterial\s*\|\s*null/)
    // DEK + IV are sourced from the override when provided, fresh otherwise.
    expect(block).toContain('params.material')
    expect(block).toContain('base64ToBytes(params.material.dek)')
    expect(block).toContain('base64ToBytes(params.material.iv)')
  })

  it('persists sealMaterial in the batch recovery schema so resume can rebuild the same blobId', () => {
    expect(WALRUS_RECOVERY).toContain('export interface WalrusBatchRecoveryBlob')
    expect(WALRUS_RECOVERY).toMatch(/sealMaterial\?:\s*PendingSealMaterial\s*\|\s*null/)
    // Type guard accepts both the new field and legacy records (undefined).
    expect(WALRUS_RECOVERY).toContain('isPendingSealMaterial')
  })

  it('threads the persisted sealMaterial back into preparePayload before encrypting on resume', () => {
    const fnStart = CLIENT_UPLOAD.indexOf('export async function prepareBatchWalrusRegisterIntent')
    const fnEnd = CLIENT_UPLOAD.indexOf(
      'export async function completeBatchWalrusUploadAfterRegister',
      fnStart,
    )
    expect(fnStart).toBeGreaterThanOrEqual(0)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const block = CLIENT_UPLOAD.slice(fnStart, fnEnd)
    // Reads recovery (and therefore any cached DEK/IV) BEFORE encrypting.
    const lookup = block.indexOf('readWalrusBatchRecovery(lookupRecoveryKey)')
    const prepareCall = block.indexOf('preparePayload(item, index, baseFiles[index]', lookup)
    expect(lookup).toBeGreaterThanOrEqual(0)
    expect(prepareCall).toBeGreaterThan(lookup)
    // Override is built per file from `priorRecovery.blobs[i].sealMaterial`.
    expect(block).toContain('rec?.sealMaterial')
    // Override is forwarded into preparePayload.
    expect(block).toContain('materialOverrides[index]')
  })

  it('writes sealMaterial into the recovery record alongside the register tx digest', () => {
    const fnStart = CLIENT_UPLOAD.indexOf('export async function completeBatchWalrusUploadAfterRegister')
    const fnEnd = CLIENT_UPLOAD.indexOf('export async function prepareSoulBlobsForBatchPublish', fnStart)
    expect(fnStart).toBeGreaterThanOrEqual(0)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const block = CLIENT_UPLOAD.slice(fnStart, fnEnd)
    // Initial blob list (persisted IMMEDIATELY after sign) carries sealMaterial
    // so a subsequent crash + reload can deterministically re-encrypt.
    expect(block).toContain('sealMaterial: p.encrypted?.material ?? null')
  })
})

describe('R-001 — encryptClientSide deterministic round-trip', () => {
  it('returns byte-identical ciphertext when re-run with the prior material', async () => {
    if (typeof globalThis.crypto?.subtle?.encrypt !== 'function') {
      // Node test runners sometimes lack WebCrypto; the structural assertions
      // above still cover the wiring and this branch acts as a guard so the
      // suite stays useful in restricted environments.
      return
    }
    const { encryptClientSide } = await import('@/lib/upload/client-seal')
    const plaintext = new TextEncoder().encode('hello soulidity v6 batch resume')
    const first = await encryptClientSide({
      plaintext,
      mimeType: 'text/markdown',
      fileName: 'character.md',
    })
    const replay = await encryptClientSide({
      plaintext,
      mimeType: 'text/markdown',
      fileName: 'character.md',
      material: first.material,
    })
    expect(replay.ciphertext.byteLength).toBe(first.ciphertext.byteLength)
    expect(Array.from(replay.ciphertext)).toEqual(Array.from(first.ciphertext))
    // The returned material must match the input — re-using the override does
    // not silently swap to a fresh DEK/IV.
    expect(replay.material.dek).toBe(first.material.dek)
    expect(replay.material.iv).toBe(first.material.iv)
  })

  it('falls back to fresh DEK/IV without an override (preserves first-attempt randomness)', async () => {
    if (typeof globalThis.crypto?.subtle?.encrypt !== 'function') return
    const { encryptClientSide } = await import('@/lib/upload/client-seal')
    const plaintext = new TextEncoder().encode('first attempt')
    const a = await encryptClientSide({
      plaintext,
      mimeType: 'text/plain',
      fileName: 'memory.txt',
    })
    const b = await encryptClientSide({
      plaintext,
      mimeType: 'text/plain',
      fileName: 'memory.txt',
    })
    expect(a.material.dek).not.toBe(b.material.dek)
    expect(a.material.iv).not.toBe(b.material.iv)
  })
})
