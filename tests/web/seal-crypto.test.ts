import { describe, expect, it, vi } from 'vitest'

const SERIES_OBJECT_ID = `0x${'11'.repeat(32)}`
const RELEASE_OBJECT_ID = `0x${'22'.repeat(32)}`
const FIXED_NONCE = Uint8Array.from({ length: 16 }, (_, index) => index)
const VALID_IV_BASE64 = 'AAAAAAAAAAAAAAAA'

describe('Seal envelope crypto', () => {
  it('prefixes the document id with the series object id bytes', async () => {
    const { generateSealDocumentId } = await import('../../web/lib/services/seal-crypto.ts')

    expect(generateSealDocumentId(SERIES_OBJECT_ID, FIXED_NONCE)).toBe(
      `0x${'11'.repeat(32)}000102030405060708090a0b0c0d0e0f`,
    )
  })

  it('binds perpetual document ids to the concrete locked release before the nonce suffix', async () => {
    const { generateSealDocumentId } = await import('../../web/lib/services/seal-crypto.ts')

    expect(generateSealDocumentId(SERIES_OBJECT_ID, FIXED_NONCE, RELEASE_OBJECT_ID)).toBe(
      `0x${'11'.repeat(32)}${'22'.repeat(32)}000102030405060708090a0b0c0d0e0f`,
    )
  })

  it('rejects malformed hex before building a document id', async () => {
    const { generateSealDocumentId } = await import('../../web/lib/services/seal-crypto.ts')

    expect(() => generateSealDocumentId('0xzz', FIXED_NONCE)).toThrow('Invalid hex string')
  })

  it('rejects sidecars whose document id is not valid hex with a nonce suffix', async () => {
    const { parseSealEnvelopeSidecar } = await import('../../web/lib/services/seal-crypto.ts')

    expect(() =>
      parseSealEnvelopeSidecar({
        version: 1,
        mode: 'seal-envelope',
        documentId: '0x1234',
        encryptedDek: 'ZW5jcnlwdGVk',
        iv: VALID_IV_BASE64,
        cipher: 'AES-GCM-256',
        mimeType: 'application/zip',
        fileName: 'bundle.zip',
        contentHash: 'deadbeef',
      }),
    ).toThrow('Seal envelope sidecar documentId is invalid')
  })

  it('rejects sidecars whose encrypted fields are not valid base64', async () => {
    const { parseSealEnvelopeSidecar } = await import('../../web/lib/services/seal-crypto.ts')

    expect(() =>
      parseSealEnvelopeSidecar({
        version: 1,
        mode: 'seal-envelope',
        documentId: `0x${'11'.repeat(32)}${'22'.repeat(16)}`,
        encryptedDek: '!not-base64!',
        iv: VALID_IV_BASE64,
        cipher: 'AES-GCM-256',
        mimeType: 'application/zip',
        fileName: 'bundle.zip',
        contentHash: 'deadbeef',
      }),
    ).toThrow('Seal envelope sidecar encryptedDek is invalid base64')
  })

  it('rejects sidecars whose iv does not decode to 12 bytes', async () => {
    const { parseSealEnvelopeSidecar } = await import('../../web/lib/services/seal-crypto.ts')

    expect(() =>
      parseSealEnvelopeSidecar({
        version: 1,
        mode: 'seal-envelope',
        documentId: `0x${'11'.repeat(32)}${'22'.repeat(16)}`,
        encryptedDek: 'ZW5jcnlwdGVk',
        iv: 'aXY=',
        cipher: 'AES-GCM-256',
        mimeType: 'application/zip',
        fileName: 'bundle.zip',
        contentHash: 'deadbeef',
      }),
    ).toThrow('Seal envelope sidecar iv must decode to 12 bytes')
  })

  it('requires a release object id when encrypting a perpetual bundle', async () => {
    const { encryptBundle } = await import('../../web/lib/services/seal-crypto.ts')

    await expect(() =>
      encryptBundle({
        sealClient: {
          encrypt: vi.fn(async ({ data }: { data: Uint8Array }) => ({
            encryptedObject: Uint8Array.from(data, (byte) => byte ^ 0xff),
            key: new Uint8Array(32).fill(7),
          })),
        } as never,
        accessPolicy: {
          packageId: '0xsoul',
          moduleName: 'seal_policy',
          functionName: 'seal_approve_perpetual',
          seriesObjectId: SERIES_OBJECT_ID,
        },
        data: new TextEncoder().encode('sealed soul bundle payload'),
        mimeType: 'application/zip',
        fileName: 'bundle.zip',
        threshold: 2,
        nonce: FIXED_NONCE,
      }),
    ).rejects.toThrow('releaseObjectId is required for perpetual Seal encryption')
  })

  it('roundtrips a bundle through envelope encryption with a mock Seal client', async () => {
    const { decryptBundle, encryptBundle } = await import('../../web/lib/services/seal-crypto.ts')

    const sealClient = {
      encrypt: vi.fn(async ({ data }: { data: Uint8Array }) => ({
        encryptedObject: Uint8Array.from(data, (byte) => byte ^ 0xff),
        key: new Uint8Array(32).fill(7),
      })),
      decrypt: vi.fn(async ({ data }: { data: Uint8Array }) => Uint8Array.from(data, (byte) => byte ^ 0xff)),
    }

    const plaintext = new TextEncoder().encode('sealed soul bundle payload')
    const accessPolicy = {
      packageId: '0xsoul',
      moduleName: 'seal_policy' as const,
      functionName: 'seal_approve_perpetual' as const,
      seriesObjectId: SERIES_OBJECT_ID,
    }

    const { encryptedData, sidecar } = await encryptBundle({
      sealClient: sealClient as never,
      accessPolicy,
      data: plaintext,
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
      releaseObjectId: RELEASE_OBJECT_ID,
      threshold: 2,
      nonce: FIXED_NONCE,
    })

    expect(sidecar).toMatchObject({
      version: 1,
      mode: 'seal-envelope',
      documentId: `0x${'11'.repeat(32)}${'22'.repeat(32)}000102030405060708090a0b0c0d0e0f`,
      cipher: 'AES-GCM-256',
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
    })
    expect(sidecar.iv).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(sidecar.iv).toHaveLength(16)
    expect(sealClient.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: 2,
        packageId: '0xsoul',
        id: sidecar.documentId,
        data: expect.any(Uint8Array),
      }),
    )

    const decrypted = await decryptBundle({
      sealClient: sealClient as never,
      sessionKey: { key: 'session' } as never,
      txBytes: new Uint8Array([1, 2, 3]),
      encryptedData,
      sidecar,
    })

    expect(decrypted).toEqual(plaintext)
    expect(sealClient.decrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Uint8Array),
        sessionKey: { key: 'session' },
        txBytes: new Uint8Array([1, 2, 3]),
      }),
    )
  })

  it('zeroes the in-memory DEK buffer after encrypting it for Seal', async () => {
    const { encryptBundle } = await import('../../web/lib/services/seal-crypto.ts')

    let capturedDek: Uint8Array | null = null
    const sealClient = {
      encrypt: vi.fn(async ({ data }: { data: Uint8Array }) => {
        capturedDek = data
        return {
          encryptedObject: Uint8Array.from(data, (byte) => byte ^ 0xff),
          key: new Uint8Array(32).fill(7),
        }
      }),
    }

    await encryptBundle({
      sealClient: sealClient as never,
      accessPolicy: {
        packageId: '0xsoul',
        moduleName: 'seal_policy',
        functionName: 'seal_approve_perpetual',
        seriesObjectId: SERIES_OBJECT_ID,
      },
      data: new TextEncoder().encode('sealed soul bundle payload'),
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
      releaseObjectId: RELEASE_OBJECT_ID,
      threshold: 2,
      nonce: FIXED_NONCE,
    })

    expect(capturedDek).not.toBeNull()
    expect(Array.from(capturedDek!)).toEqual(new Array(32).fill(0))
  })
})
