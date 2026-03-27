import { describe, expect, it, vi } from 'vitest'

const SOUL_OBJECT_ID = `0x${'11'.repeat(32)}`
const OTHER_SOUL_OBJECT_ID = `0x${'33'.repeat(32)}`
const ACCESS_CAP_OBJECT_ID = `0x${'55'.repeat(32)}`
const FIXED_NONCE = Uint8Array.from({ length: 16 }, (_, index) => index)
const VALID_IV_BASE64 = 'AAAAAAAAAAAAAAAA'
const VALID_CONTENT_HASH = 'a'.repeat(64)

function expectedDocumentIdHex(soulObjectId: string) {
  const domainHex = Buffer.from('soul-seal:', 'utf8').toString('hex')
  const soulHex = soulObjectId.slice(2)
  const nonceHex = Array.from(FIXED_NONCE, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `0x${domainHex}01${soulHex}${nonceHex}`
}

describe('Seal envelope crypto', () => {
  it('prefixes the document id with the soul document namespace and soul object id bytes', async () => {
    const { generateSealDocumentId } = await import('../../web/lib/services/seal-crypto.ts')

    expect(generateSealDocumentId(SOUL_OBJECT_ID, FIXED_NONCE)).toBe(expectedDocumentIdHex(SOUL_OBJECT_ID))
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
        contentHash: VALID_CONTENT_HASH,
      }),
    ).toThrow('Seal envelope sidecar documentId is invalid')
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
      functionName: 'seal_approve_owner' as const,
      soulObjectId: SOUL_OBJECT_ID,
    }

    const { encryptedData, sidecar } = await encryptBundle({
      sealClient: sealClient as never,
      accessPolicy,
      data: plaintext,
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
      threshold: 2,
      nonce: FIXED_NONCE,
    })

    expect(sidecar).toMatchObject({
      version: 1,
      mode: 'seal-envelope',
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      cipher: 'AES-GCM-256',
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
    })
    expect(sidecar.iv).toHaveLength(16)

    const decrypted = await decryptBundle({
      sealClient: sealClient as never,
      sessionKey: { key: 'session' } as never,
      txBytes: new Uint8Array([1, 2, 3]),
      encryptedData,
      sidecar,
      expectedSoulObjectId: SOUL_OBJECT_ID,
    })

    expect(decrypted).toEqual(plaintext)
  })

  it('rejects decrypting a sidecar whose document id is outside the expected soul namespace', async () => {
    const { decryptBundle } = await import('../../web/lib/services/seal-crypto.ts')

    await expect(() =>
      decryptBundle({
        sealClient: {
          decrypt: vi.fn(async () => new Uint8Array(64)),
        } as never,
        sessionKey: { key: 'session' } as never,
        txBytes: new Uint8Array([1, 2, 3]),
        encryptedData: new Uint8Array([4, 5, 6]),
        sidecar: {
          version: 1,
          mode: 'seal-envelope',
          documentId: expectedDocumentIdHex(OTHER_SOUL_OBJECT_ID),
          encryptedDek: 'AQI',
          iv: VALID_IV_BASE64,
          cipher: 'AES-GCM-256',
          mimeType: 'application/zip',
          fileName: 'bundle.zip',
          contentHash: VALID_CONTENT_HASH,
        },
        expectedSoulObjectId: SOUL_OBJECT_ID,
      }),
    ).rejects.toThrow('Seal documentId does not belong to the expected soul')
  })

  it('builds an owner approval tx bound to the requested soul document id', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const buildSpy = vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')
    const bytes = await buildSealApprovalTxBytes({
      accessPolicy: {
        packageId: '0xsoul',
        moduleName: 'seal_policy',
        functionName: 'seal_approve_owner',
        soulObjectId: SOUL_OBJECT_ID,
      },
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
    })

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
    buildSpy.mockRestore()
  })

  it('rejects agent approval txs without a soul access cap object id', async () => {
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')

    await expect(() =>
      buildSealApprovalTxBytes({
        accessPolicy: {
          packageId: '0xsoul',
          moduleName: 'seal_policy',
          functionName: 'seal_approve_agent',
          soulObjectId: SOUL_OBJECT_ID,
        },
        documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      }),
    ).rejects.toThrow('soulAccessCapObjectId is required for agent Seal approval')
  })

  it('builds an agent approval tx with the supplied access cap object id', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const buildSpy = vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')
    const bytes = await buildSealApprovalTxBytes({
      accessPolicy: {
        packageId: '0xsoul',
        moduleName: 'seal_policy',
        functionName: 'seal_approve_agent',
        soulObjectId: SOUL_OBJECT_ID,
      },
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      soulAccessCapObjectId: ACCESS_CAP_OBJECT_ID,
    })

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
    buildSpy.mockRestore()
  })
})
