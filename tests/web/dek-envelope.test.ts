import { describe, expect, it, vi, beforeEach } from 'vitest'

const TEST_SECRET = 'a'.repeat(64)

describe('dek-envelope', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.SOUL_UPLOAD_SECRET = TEST_SECRET
  })

  it('roundtrips seal → unseal correctly', async () => {
    const { sealDekEnvelope, unsealDekEnvelope } = await import('../../web/lib/services/dek-envelope.ts')

    const dek = new Uint8Array(32).fill(0x42)
    const iv = new Uint8Array(12).fill(0x13)
    const contentHash = 'ab'.repeat(32)
    const mimeType = 'application/zip'
    const fileName = 'bundle.zip'

    const envelope = sealDekEnvelope({ dek, iv, contentHash, mimeType, fileName })
    expect(typeof envelope).toBe('string')
    expect(envelope.length).toBeGreaterThan(0)

    const result = unsealDekEnvelope(envelope)
    expect(result.dek).toEqual(dek)
    expect(result.iv).toEqual(iv)
    expect(result.contentHash).toBe(contentHash)
    expect(result.mimeType).toBe(mimeType)
    expect(result.fileName).toBe(fileName)
  })

  it('rejects tampered envelopes', async () => {
    const { sealDekEnvelope, unsealDekEnvelope } = await import('../../web/lib/services/dek-envelope.ts')

    const envelope = sealDekEnvelope({
      dek: new Uint8Array(32).fill(0x42),
      iv: new Uint8Array(12).fill(0x13),
      contentHash: 'cd'.repeat(32),
      mimeType: 'application/octet-stream',
      fileName: 'test.bin',
    })

    // Tamper with the base64 string
    const raw = Buffer.from(envelope, 'base64')
    raw[raw.length - 1] ^= 0xff
    const tampered = raw.toString('base64')

    expect(() => unsealDekEnvelope(tampered)).toThrow(/invalid|tampered/i)
  })

  it('rejects envelopes encrypted with a different secret', async () => {
    const { sealDekEnvelope } = await import('../../web/lib/services/dek-envelope.ts')

    const envelope = sealDekEnvelope({
      dek: new Uint8Array(32).fill(0x42),
      iv: new Uint8Array(12).fill(0x13),
      contentHash: 'ef'.repeat(32),
      mimeType: 'text/plain',
      fileName: 'readme.txt',
    })

    // Change secret and re-import
    vi.resetModules()
    process.env.SOUL_UPLOAD_SECRET = 'b'.repeat(64)
    const { unsealDekEnvelope } = await import('../../web/lib/services/dek-envelope.ts')

    expect(() => unsealDekEnvelope(envelope)).toThrow(/invalid|tampered/i)
  })

  it('rejects invalid DEK length', async () => {
    const { sealDekEnvelope } = await import('../../web/lib/services/dek-envelope.ts')

    expect(() => sealDekEnvelope({
      dek: new Uint8Array(16),
      iv: new Uint8Array(12),
      contentHash: 'aa'.repeat(32),
      mimeType: 'application/octet-stream',
      fileName: 'test',
    })).toThrow('DEK must be 32 bytes')
  })

  it('rejects missing SOUL_UPLOAD_SECRET', async () => {
    delete process.env.SOUL_UPLOAD_SECRET
    const { sealDekEnvelope } = await import('../../web/lib/services/dek-envelope.ts')

    expect(() => sealDekEnvelope({
      dek: new Uint8Array(32),
      iv: new Uint8Array(12),
      contentHash: 'aa'.repeat(32),
      mimeType: 'application/octet-stream',
      fileName: 'test',
    })).toThrow('SOUL_UPLOAD_SECRET')
  })
})
