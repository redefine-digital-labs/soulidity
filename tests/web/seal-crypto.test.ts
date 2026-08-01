import { describe, expect, it, vi } from 'vitest'

const SOUL_OBJECT_ID = `0x${'11'.repeat(32)}`
const SEAL_PACKAGE_ID = `0x${'22'.repeat(32)}`
const CALLABLE_PACKAGE_ID = `0x${'44'.repeat(32)}`
const OTHER_SOUL_OBJECT_ID = `0x${'33'.repeat(32)}`
const ACCESS_CAP_OBJECT_ID = `0x${'55'.repeat(32)}`
const KIOSK_OBJECT_ID = `0x${'66'.repeat(32)}`
const KIOSK_CAP_OBJECT_ID = `0x${'77'.repeat(32)}`
const ALLOWLIST_REGISTRY_OBJECT_ID = `0x${'88'.repeat(32)}`
const FIXED_NONCE = Uint8Array.from({ length: 16 }, (_, index) => index)
const VALID_IV_BASE64 = 'AAAAAAAAAAAAAAAA'
const VALID_CONTENT_HASH = 'a'.repeat(64)

function fakeSealEncryptedObject(packageId: string, documentId: string) {
  const packageBytes = Buffer.from(packageId.slice(2).padStart(64, '0'), 'hex')
  const idBytes = Buffer.from(documentId.slice(2), 'hex')
  if (idBytes.length >= 128) throw new Error('Test document id is too long')
  return new Uint8Array([
    0, // encrypted object version
    ...packageBytes,
    idBytes.length,
    ...idBytes,
    0, // services vector
    1, // threshold
    0, // BonehFranklinBLS12381 enum variant
    ...new Uint8Array(96),
    0, // encrypted shares vector
    ...new Uint8Array(32),
    2, // Plain ciphertext enum variant (payload is irrelevant to routing tests)
  ])
}

function accessPolicy(functionName: 'seal_approve_owner_in_personal_kiosk' | 'seal_approve_allowlisted') {
  return {
    packageId: SEAL_PACKAGE_ID,
    sealPackageId: SEAL_PACKAGE_ID,
    callablePackageId: CALLABLE_PACKAGE_ID,
    moduleName: 'seal_policy' as const,
    functionName,
    soulObjectId: SOUL_OBJECT_ID,
    currentKioskId: functionName === 'seal_approve_owner_in_personal_kiosk' ? KIOSK_OBJECT_ID : null,
    currentKioskCapOnChainId: functionName === 'seal_approve_owner_in_personal_kiosk' ? KIOSK_CAP_OBJECT_ID : null,
    allowlistRegistryObjectId: functionName === 'seal_approve_allowlisted' ? ALLOWLIST_REGISTRY_OBJECT_ID : null,
    soulAllowlistCapObjectId: null,
  }
}

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

  it('accepts mirrored memory and skill document namespaces', async () => {
    const {
      generateMemoryDocumentId,
      generateSkillDocumentIdForVersion,
      parseSealEnvelopeSidecar,
    } = await import('../../web/lib/services/seal-crypto.ts')
    const memoryDocumentId = generateMemoryDocumentId(`0x${'22'.repeat(32)}`, 123)
    const skillDocumentId = generateSkillDocumentIdForVersion(`0x${'44'.repeat(32)}`, 'api-design', 0)

    for (const documentId of [memoryDocumentId, skillDocumentId]) {
      expect(parseSealEnvelopeSidecar({
        version: 1,
        mode: 'seal-envelope',
        documentId,
        encryptedDek: 'ZW5jcnlwdGVk',
        iv: VALID_IV_BASE64,
        cipher: 'AES-GCM-256',
        mimeType: 'application/zip',
        fileName: 'bundle.zip',
        contentHash: VALID_CONTENT_HASH,
      }).documentId).toBe(documentId)
    }
  })

  it('accepts Phase 2 content-version document namespaces', async () => {
    const { generateContentDocumentIdHex } = await import('../../packages/soulidity-sdk/src/content-document-id')
    const { parseSealEnvelopeSidecar } = await import('../../web/lib/services/seal-crypto.ts')
    const documentId = generateContentDocumentIdHex({
      contentObjectId: `0x${'22'.repeat(32)}`,
      kind: 0,
      name: 'soul',
      versionIndex: 0,
      nonce: FIXED_NONCE,
    })

    expect(parseSealEnvelopeSidecar({
      version: 1,
      mode: 'seal-envelope',
      documentId,
      encryptedDek: 'ZW5jcnlwdGVk',
      iv: VALID_IV_BASE64,
      cipher: 'AES-GCM-256',
      mimeType: 'text/markdown',
      fileName: 'soul.md',
      contentHash: VALID_CONTENT_HASH,
    }).documentId).toBe(documentId)
  })

  it('roundtrips a bundle through envelope encryption with a mock Seal client', async () => {
    const { decryptBundle, encryptBundle } = await import('../../web/lib/services/seal-crypto.ts')

    let wrappedKeyMaterial = new Uint8Array()
    const sealClient = {
      encrypt: vi.fn(async ({ data, packageId, id }: { data: Uint8Array; packageId: string; id: string }) => {
        wrappedKeyMaterial = new Uint8Array(data)
        return {
          encryptedObject: fakeSealEncryptedObject(packageId, id),
          key: new Uint8Array(32).fill(7),
        }
      }),
      decrypt: vi.fn(async () => new Uint8Array(wrappedKeyMaterial)),
    }

    const plaintext = new TextEncoder().encode('sealed soul bundle payload')
    const policy = accessPolicy('seal_approve_owner_in_personal_kiosk')

    const { encryptedData, sidecar } = await encryptBundle({
      sealClient: sealClient as never,
      accessPolicy: policy,
      data: plaintext,
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
      threshold: 2,
      nonce: FIXED_NONCE,
    })

    expect(sidecar).toMatchObject({
      version: 1,
      mode: 'seal-envelope',
      sealPackageId: SEAL_PACKAGE_ID,
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
      expectedSealPackageId: SEAL_PACKAGE_ID,
    })

    expect(decrypted).toEqual(plaintext)
    expect(sealClient.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: SEAL_PACKAGE_ID }),
    )
  })

  it('zeroizes decrypted Seal key material after bundle decryption succeeds', async () => {
    const { decryptBundle, encryptBundle } = await import('../../web/lib/services/seal-crypto.ts')

    let encryptedKeyMaterial: Uint8Array | null = null
    const encryptClient = {
      encrypt: vi.fn(async ({ data }: { data: Uint8Array }) => {
        encryptedKeyMaterial = new Uint8Array(data)
        return {
          encryptedObject: fakeSealEncryptedObject(
            SEAL_PACKAGE_ID,
            expectedDocumentIdHex(SOUL_OBJECT_ID),
          ),
          key: new Uint8Array(32).fill(7),
        }
      }),
    }

    const plaintext = new TextEncoder().encode('sealed soul bundle payload')
    const policy = accessPolicy('seal_approve_owner_in_personal_kiosk')

    const { encryptedData, sidecar } = await encryptBundle({
      sealClient: encryptClient as never,
      accessPolicy: policy,
      data: plaintext,
      mimeType: 'application/zip',
      fileName: 'bundle.zip',
      threshold: 2,
      nonce: FIXED_NONCE,
    })

    const decryptedKeyMaterial = new Uint8Array(encryptedKeyMaterial!)
    const decryptClient = {
      decrypt: vi.fn(async () => decryptedKeyMaterial.buffer),
    }

    const decrypted = await decryptBundle({
      sealClient: decryptClient as never,
      sessionKey: { key: 'session' } as never,
      txBytes: new Uint8Array([1, 2, 3]),
      encryptedData,
      sidecar,
      expectedSoulObjectId: SOUL_OBJECT_ID,
      expectedSealPackageId: SEAL_PACKAGE_ID,
    })

    expect(decrypted).toEqual(plaintext)
    expect(decryptedKeyMaterial).toEqual(new Uint8Array(decryptedKeyMaterial.length))
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
          encryptedDek: Buffer.from(fakeSealEncryptedObject(
            SEAL_PACKAGE_ID,
            expectedDocumentIdHex(OTHER_SOUL_OBJECT_ID),
          )).toString('base64'),
          iv: VALID_IV_BASE64,
          cipher: 'AES-GCM-256',
          mimeType: 'application/zip',
          fileName: 'bundle.zip',
          contentHash: VALID_CONTENT_HASH,
        },
        expectedSoulObjectId: SOUL_OBJECT_ID,
        expectedSealPackageId: SEAL_PACKAGE_ID,
      }),
    ).rejects.toThrow('Seal documentId does not belong to the expected soul')
  })

  it('recovers the namespace from a legacy sidecar without sealPackageId', async () => {
    const { assertSealEnvelopePackageId } = await import('../../web/lib/services/seal-crypto.ts')
    const sidecar = {
      version: 1 as const,
      mode: 'seal-envelope' as const,
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      encryptedDek: Buffer.from(fakeSealEncryptedObject(
        SEAL_PACKAGE_ID,
        expectedDocumentIdHex(SOUL_OBJECT_ID),
      )).toString('base64'),
      iv: VALID_IV_BASE64,
      cipher: 'AES-GCM-256' as const,
      mimeType: 'application/zip',
      fileName: 'legacy.zip',
      contentHash: VALID_CONTENT_HASH,
    }

    expect(assertSealEnvelopePackageId(sidecar, SEAL_PACKAGE_ID)).toBe(SEAL_PACKAGE_ID)
  })

  it('rejects ciphertext encrypted under the latest callable package namespace', async () => {
    const { assertSealEnvelopePackageId } = await import('../../web/lib/services/seal-crypto.ts')
    const sidecar = {
      version: 1 as const,
      mode: 'seal-envelope' as const,
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      encryptedDek: Buffer.from(fakeSealEncryptedObject(
        CALLABLE_PACKAGE_ID,
        expectedDocumentIdHex(SOUL_OBJECT_ID),
      )).toString('base64'),
      iv: VALID_IV_BASE64,
      cipher: 'AES-GCM-256' as const,
      mimeType: 'application/zip',
      fileName: 'wrong-namespace.zip',
      contentHash: VALID_CONTENT_HASH,
    }

    expect(() => assertSealEnvelopePackageId(sidecar, SEAL_PACKAGE_ID))
      .toThrow('Seal envelope namespace mismatch')
  })

  it('rejects a sidecar namespace label that disagrees with encryptedDek', async () => {
    const { getSealEnvelopePackageId } = await import('../../web/lib/services/seal-crypto.ts')
    const sidecar = {
      version: 1 as const,
      mode: 'seal-envelope' as const,
      sealPackageId: CALLABLE_PACKAGE_ID,
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      encryptedDek: Buffer.from(fakeSealEncryptedObject(
        SEAL_PACKAGE_ID,
        expectedDocumentIdHex(SOUL_OBJECT_ID),
      )).toString('base64'),
      iv: VALID_IV_BASE64,
      cipher: 'AES-GCM-256' as const,
      mimeType: 'application/zip',
      fileName: 'mislabeled.zip',
      contentHash: VALID_CONTENT_HASH,
    }

    expect(() => getSealEnvelopePackageId(sidecar))
      .toThrow('sidecar namespace does not match encryptedDek')
  })

  it('rejects a sidecar document id that disagrees with encryptedDek', async () => {
    const { getSealEnvelopePackageId } = await import('../../web/lib/services/seal-crypto.ts')
    const sidecar = {
      version: 1 as const,
      mode: 'seal-envelope' as const,
      sealPackageId: SEAL_PACKAGE_ID,
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      encryptedDek: Buffer.from(fakeSealEncryptedObject(
        SEAL_PACKAGE_ID,
        expectedDocumentIdHex(OTHER_SOUL_OBJECT_ID),
      )).toString('base64'),
      iv: VALID_IV_BASE64,
      cipher: 'AES-GCM-256' as const,
      mimeType: 'application/zip',
      fileName: 'mismatched-document.zip',
      contentHash: VALID_CONTENT_HASH,
    }

    expect(() => getSealEnvelopePackageId(sidecar))
      .toThrow('documentId does not match encryptedDek')
  })

  it('builds an owner approval tx bound to the requested soul document id', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const buildSpy = vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(new Uint8Array([1, 2, 3]))
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')
    const bytes = await buildSealApprovalTxBytes({
      accessPolicy: accessPolicy('seal_approve_owner_in_personal_kiosk'),
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
    })

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${CALLABLE_PACKAGE_ID}::seal_policy::seal_approve_owner_in_personal_kiosk`,
    }))
    moveCallSpy.mockRestore()
    buildSpy.mockRestore()
  })

  it('rejects allowlisted approval txs without a soul allowlist cap object id', async () => {
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')

    await expect(() =>
      buildSealApprovalTxBytes({
        accessPolicy: accessPolicy('seal_approve_allowlisted'),
        documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      }),
    ).rejects.toThrow('soulAllowlistCapObjectId is required for allowlisted Seal approval')
  })

  it('builds an allowlisted approval tx with the supplied access cap object id', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const buildSpy = vi.spyOn(Transaction.prototype, 'build').mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')
    const bytes = await buildSealApprovalTxBytes({
      accessPolicy: accessPolicy('seal_approve_allowlisted'),
      documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      soulAllowlistCapObjectId: ACCESS_CAP_OBJECT_ID,
    })

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
    buildSpy.mockRestore()
  })

  it('rejects unknown Seal approval function names instead of falling through to allowlist mode', async () => {
    const { buildSealApprovalTxBytes } = await import('../../web/lib/services/seal-crypto.ts')

    await expect(() =>
      buildSealApprovalTxBytes({
        accessPolicy: {
          ...accessPolicy('seal_approve_owner_in_personal_kiosk'),
          functionName: 'seal_approve_future_mode' as never,
          currentKioskId: null,
          currentKioskCapOnChainId: null,
          allowlistRegistryObjectId: null,
        },
        documentId: expectedDocumentIdHex(SOUL_OBJECT_ID),
      }),
    ).rejects.toThrow('Unknown Seal approval function: seal_approve_future_mode')
  })
})
