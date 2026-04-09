import { describe, expect, it, vi } from 'vitest'
import {
  createSoulDownloadBlob,
  DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS,
  loadDecryptedSoulBundle,
  readAccessDownloadError,
  requirePrimarySuiWallet,
  sanitizeDownloadFileName,
  scheduleBlobUrlRevoke,
} from '../../web/lib/souls/access-download.ts'

const VIEWER_ADDRESS = `0x${'1'.repeat(64)}`
const PACKAGE_ID = `0x${'2'.repeat(64)}`
const SOUL_ID = `0x${'3'.repeat(64)}`

function createJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as any
}

function createBinaryResponse(bytes: Uint8Array, ok = true) {
  return {
    ok,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    json: vi.fn().mockResolvedValue(null),
  } as any
}

function createAccessPayload() {
  return {
    artifact: { walrusBlobUrl: 'https://walrus.example/blob', walrusBlobId: 'blob-1', contentBlobObjectId: '0xblob' },
    accessPolicy: {
      packageId: PACKAGE_ID,
      soulObjectId: SOUL_ID,
      moduleName: 'seal_policy' as const,
      functionName: 'seal_approve_owner_in_personal_kiosk' as const,
      currentKioskId: `0x${'4'.repeat(64)}`,
      currentKioskCapOnChainId: `0x${'5'.repeat(64)}`,
      allowlistRegistryObjectId: null,
      soulAllowlistCapObjectId: null,
    },
    seal: {
      network: 'testnet' as const,
      threshold: 1,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xserver', weight: 1 }],
    },
    sealSidecar: {
      version: 1,
      mode: 'seal-envelope' as const,
      encryptedDek: 'enc',
      iv: 'a'.repeat(24),
      cipher: 'AES-GCM-256' as const,
      mimeType: 'application/octet-stream',
      fileName: 'soul.bin',
      documentId: 'doc-1',
      contentHash: 'b'.repeat(64),
    },
    viewerAddress: VIEWER_ADDRESS,
    accessKind: 'owner' as const,
    sessionTtlMin: 10,
  }
}

describe('soul access download helpers', () => {
  it('rejects missing primary wallet before any network call', () => {
    expect(() => requirePrimarySuiWallet(null)).toThrow('Bind a Sui wallet before accessing Soul content')
  })

  it('prefers explicit access-route error messages and falls back for malformed payloads', () => {
    expect(readAccessDownloadError(null, 'fallback')).toBe('fallback')
    expect(readAccessDownloadError({ error: 'specific' }, 'fallback')).toBe('specific')
    expect(readAccessDownloadError({ error: 42 }, 'fallback')).toBe('fallback')
  })

  it('sanitizes server-provided download filenames before the browser sees them', () => {
    expect(sanitizeDownloadFileName('../soul\\content.bin')).toBe('.._soul_content.bin')
    expect(sanitizeDownloadFileName('   ')).toBe('soul-content.bin')
    expect(sanitizeDownloadFileName('invoice\u202Efdp.exe')).toBe('invoice_fdp.exe')
    expect(sanitizeDownloadFileName('a'.repeat(300))).toHaveLength(255)
  })

  it('surfaces access-route fetch failures before starting Seal session setup', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse({ error: 'Soul access is still syncing' }, false))
    const createSessionKey = vi.fn()

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn(),
      suiClient: {},
      fetchImpl,
      createSessionKey,
    })).rejects.toThrow('Soul access is still syncing')

    expect(createSessionKey).not.toHaveBeenCalled()
  })

  it('surfaces wallet signing failures from the download flow', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse(createAccessPayload()))

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn().mockRejectedValue(new Error('Wallet rejected')),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn().mockResolvedValue({
        getPersonalMessage: () => new Uint8Array([1, 2, 3]),
        setPersonalMessageSignature: vi.fn().mockResolvedValue(undefined),
      }),
    })).rejects.toThrow('Wallet rejected')
  })

  it('surfaces Walrus fetch failures after access is approved', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createAccessPayload()))
      .mockResolvedValueOnce(createBinaryResponse(new Uint8Array([1, 2, 3]), false))

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn().mockResolvedValue('signature'),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn().mockResolvedValue({
        getPersonalMessage: () => new Uint8Array([1, 2, 3]),
        setPersonalMessageSignature: vi.fn().mockResolvedValue(undefined),
      }),
      buildSealApprovalTxBytesImpl: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
    })).rejects.toThrow('Failed to download encrypted Soul bundle')
  })

  it('surfaces decrypt failures after the encrypted blob is downloaded', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createAccessPayload()))
      .mockResolvedValueOnce(createBinaryResponse(new Uint8Array([1, 2, 3])))

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn().mockResolvedValue('signature'),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn().mockResolvedValue({
        getPersonalMessage: () => new Uint8Array([1, 2, 3]),
        setPersonalMessageSignature: vi.fn().mockResolvedValue(undefined),
      }),
      buildSealApprovalTxBytesImpl: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
      createSealClient: vi.fn().mockReturnValue({} as any),
      decryptBundleImpl: vi.fn().mockRejectedValue(new Error('Decrypt failed')),
    })).rejects.toThrow('Decrypt failed')
  })

  it('rejects malformed access payloads before starting session setup', async () => {
    const payload = createAccessPayload()
    delete (payload as { sealSidecar?: unknown }).sealSidecar
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse(payload))
    const createSessionKey = vi.fn()

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn(),
      suiClient: {},
      fetchImpl,
      createSessionKey,
    })).rejects.toThrow('Soul access response is invalid')

    expect(createSessionKey).not.toHaveBeenCalled()
  })

  it('rejects access payloads whose access kind is outside the supported contract', async () => {
    const payload = createAccessPayload()
    ;(payload as { accessKind: string }).accessKind = 'preview'
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse(payload))

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn(),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn(),
    })).rejects.toThrow('Soul access response is invalid')
  })

  it('rejects access payloads whose Seal approval function is outside the supported contract', async () => {
    const payload = createAccessPayload()
    ;(payload.accessPolicy as { functionName: string }).functionName = 'seal_approve_anyone'
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse(payload))
    const createSessionKey = vi.fn()

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn(),
      suiClient: {},
      fetchImpl,
      createSessionKey,
    })).rejects.toThrow('Soul access response is invalid')

    expect(createSessionKey).not.toHaveBeenCalled()
  })

  it('rejects access payloads whose Seal server config entries are malformed', async () => {
    const payload = createAccessPayload()
    ;(payload.seal as { serverConfigs: unknown[] }).serverConfigs = [{ weight: '1' }]
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse(payload))
    const createSessionKey = vi.fn()

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn(),
      suiClient: {},
      fetchImpl,
      createSessionKey,
    })).rejects.toThrow('Soul access response is invalid')

    expect(createSessionKey).not.toHaveBeenCalled()
  })

  it('rejects an access payload whose soul object id does not match the requested id', async () => {
    const payload = createAccessPayload()
    payload.accessPolicy.soulObjectId = `0x${'6'.repeat(64)}`
    const fetchImpl = vi.fn().mockResolvedValueOnce(createJsonResponse(payload))
    const buildSealApprovalTxBytesImpl = vi.fn()

    await expect(loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn().mockResolvedValue('signature'),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn(),
      buildSealApprovalTxBytesImpl,
    })).rejects.toThrow('Soul access response does not match the requested Soul')

    expect(buildSealApprovalTxBytesImpl).not.toHaveBeenCalled()
  })

  it('passes kiosk ids from the access policy into the Seal approval transaction builder', async () => {
    const buildSealApprovalTxBytesImpl = vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9]))
    const decryptBundleImpl = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]))
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createAccessPayload()))
      .mockResolvedValueOnce(createBinaryResponse(new Uint8Array([1, 2, 3])))

    const result = await loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn().mockResolvedValue('signature'),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn().mockResolvedValue({
        getPersonalMessage: () => new Uint8Array([1, 2, 3]),
        setPersonalMessageSignature: vi.fn().mockResolvedValue(undefined),
      }),
      buildSealApprovalTxBytesImpl,
      createSealClient: vi.fn().mockReturnValue({} as any),
      decryptBundleImpl,
    })

    expect(buildSealApprovalTxBytesImpl).toHaveBeenCalledWith({
      accessPolicy: expect.objectContaining({
        soulObjectId: SOUL_ID,
        currentKioskId: `0x${'4'.repeat(64)}`,
        currentKioskCapOnChainId: `0x${'5'.repeat(64)}`,
      }),
      documentId: 'doc-1',
      soulAllowlistCapObjectId: null,
    })
    expect(result).toEqual({
      bytes: new Uint8Array([7, 8, 9]),
      fileName: 'soul.bin',
      mimeType: 'application/octet-stream',
    })
  })

  it('zeroizes the temporary decrypted buffer after copying bytes for the caller', async () => {
    const decryptedBytes = new Uint8Array([7, 8, 9])
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createAccessPayload()))
      .mockResolvedValueOnce(createBinaryResponse(new Uint8Array([1, 2, 3])))

    const result = await loadDecryptedSoulBundle({
      soulObjectId: SOUL_ID,
      getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
      signPersonalMessage: vi.fn().mockResolvedValue('signature'),
      suiClient: {},
      fetchImpl,
      createSessionKey: vi.fn().mockResolvedValue({
        getPersonalMessage: () => new Uint8Array([1, 2, 3]),
        setPersonalMessageSignature: vi.fn().mockResolvedValue(undefined),
      }),
      buildSealApprovalTxBytesImpl: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
      createSealClient: vi.fn().mockReturnValue({} as any),
      decryptBundleImpl: vi.fn().mockResolvedValue(decryptedBytes),
    })

    expect(result.bytes).toEqual(new Uint8Array([7, 8, 9]))
    expect(decryptedBytes).toEqual(new Uint8Array([0, 0, 0]))
  })

  it('zeroizes both buffers if copying decrypted bytes into the caller buffer throws', async () => {
    const decryptedBytes = new Uint8Array([7, 8, 9])
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createAccessPayload()))
      .mockResolvedValueOnce(createBinaryResponse(new Uint8Array([1, 2, 3])))
    let partiallyWrittenBytes: Uint8Array | null = null
    const setSpy = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function mockSet(
      this: Uint8Array,
      source: ArrayLike<number>,
      offset?: number,
    ) {
      const start = offset ?? 0
      for (let index = 0; index < Math.min(2, source.length); index += 1) {
        this[start + index] = Number(source[index] ?? 0)
      }
      partiallyWrittenBytes = this
      throw new Error('copy failed')
    })

    try {
      await expect(loadDecryptedSoulBundle({
        soulObjectId: SOUL_ID,
        getAuthHeaders: async () => ({ authorization: 'Bearer token' }),
        signPersonalMessage: vi.fn().mockResolvedValue('signature'),
        suiClient: {},
        fetchImpl,
        createSessionKey: vi.fn().mockResolvedValue({
          getPersonalMessage: () => new Uint8Array([1, 2, 3]),
          setPersonalMessageSignature: vi.fn().mockResolvedValue(undefined),
        }),
        buildSealApprovalTxBytesImpl: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
        createSealClient: vi.fn().mockReturnValue({} as any),
        decryptBundleImpl: vi.fn().mockResolvedValue(decryptedBytes),
      })).rejects.toThrow('copy failed')

      expect(partiallyWrittenBytes).toEqual(new Uint8Array([0, 0, 0]))
      expect(decryptedBytes).toEqual(new Uint8Array([0, 0, 0]))
    } finally {
      setSpy.mockRestore()
    }
  })

  it('copies bundle bytes into a Blob and zeroizes the original buffer immediately', async () => {
    const bundleBytes = new Uint8Array([1, 2, 3])
    const blob = createSoulDownloadBlob(bundleBytes, 'application/test')
    const blobBytes = new Uint8Array(await blob.arrayBuffer())

    expect(bundleBytes).toEqual(new Uint8Array([0, 0, 0]))
    expect(blobBytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('still zeroizes bundle bytes if Blob creation throws', () => {
    const originalBlob = globalThis.Blob
    const throwingBlob = vi.fn(() => {
      throw new Error('Blob failed')
    }) as unknown as typeof Blob
    vi.stubGlobal('Blob', throwingBlob)

    try {
      const bundleBytes = new Uint8Array([4, 5, 6])
      expect(() => createSoulDownloadBlob(bundleBytes)).toThrow('Blob failed')
      expect(bundleBytes).toEqual(new Uint8Array([0, 0, 0]))
    } finally {
      vi.stubGlobal('Blob', originalBlob)
    }
  })

  it('defers blob-url revocation so the browser download can start first', () => {
    const revoke = vi.fn()
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      callback()
      return 1
    })

    const handle = scheduleBlobUrlRevoke('blob:download', { revoke, schedule })

    expect(handle).toBe(1)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), DOWNLOAD_BLOB_URL_REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:download')
  })
})
