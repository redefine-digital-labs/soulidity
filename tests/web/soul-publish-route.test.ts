import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sameSuiValueForTests } from './test-sui-value.ts'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const HOLDER_ADDRESS = `0x${'5'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const LISTING_ID = `0x${'7'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'6'.repeat(64)}`
const CONTENT_BLOB_OBJECT_ID = `0x${'4'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findUnique: vi.fn(),
  },
}))
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedExtractSoulPublishEvent = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedDbUpsertSoulAsset = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedCreateSealClient = vi.hoisted(() => vi.fn())
const mockedCreateSealEnvelopeSidecar = vi.hoisted(() => vi.fn())
const mockedUnsealDekEnvelope = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))

vi.mock('@web/lib/souls/transaction', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
}))

vi.mock('@web/lib/souls/transaction-metadata', () => ({
  readTransactionSender: mockedReadTransactionSender,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  extractSoulPublishEvent: mockedExtractSoulPublishEvent,
  getTrustedPackageIds: (...packageIds: Array<string | null | undefined>) => packageIds.filter((value): value is string => Boolean(value)),
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: sameSuiValueForTests,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbUpsertSoulAsset: mockedDbUpsertSoulAsset,
}))

vi.mock('@web/lib/services/seal', () => ({
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  createSealClient: mockedCreateSealClient,
}))

vi.mock('@web/lib/services/seal-crypto', () => ({
  createSealEnvelopeSidecar: mockedCreateSealEnvelopeSidecar,
}))

vi.mock('@web/lib/services/dek-envelope', () => ({
  unsealDekEnvelope: mockedUnsealDekEnvelope,
}))

describe('soul publish route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([AUTHOR_ADDRESS])
    mockedPrisma.soulAsset.findUnique.mockResolvedValue(null)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedReadTransactionSender.mockReturnValue(AUTHOR_ADDRESS)
    mockedPrisma.soulAsset.findUnique.mockResolvedValue(null)
    mockedExtractSoulPublishEvent.mockReturnValue({
      kind: 'listed',
      event: {
        listingObjectId: LISTING_ID,
        soulObjectId: SOUL_ID,
        kioskId: KIOSK_ID,
        kioskCapOnChainId: KIOSK_CAP_ID,
        sellerAddress: AUTHOR_ADDRESS,
        priceAtomic: 1_000_000n,
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValue({
      objectId: SOUL_ID,
      creatorAddress: AUTHOR_ADDRESS,
      creatorRoyaltyBps: 0,
      ownerAddress: KIOSK_ID,
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      name: 'Signal Soul',
      description: 'Encrypted bundle',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
      contentBlobId: 'blob-content',
      allowlistAddress: null,
      allowlistVersion: 0n,
    })
    mockedGetSealRuntimeConfig.mockReturnValue({
      network: 'testnet',
      threshold: 2,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xserver', weight: 1 }],
    })
    mockedCreateSealClient.mockReturnValue({ seal: true })
    mockedCreateSealEnvelopeSidecar.mockResolvedValue({ encryptedObject: 'sealed' })
    mockedUnsealDekEnvelope.mockReturnValue({
      dek: Buffer.alloc(32, 1),
      iv: Buffer.alloc(12, 2),
      contentHash: 'ab'.repeat(32),
      mimeType: 'application/octet-stream',
      fileName: 'bundle.bin',
    })
    mockedDbUpsertSoulAsset.mockResolvedValue(undefined)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
  })

  it('returns cached publish sync responses for duplicate tx digests', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 200,
      body: { soulOnChainId: SOUL_ID, listingStatus: 'listed' },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      listingStatus: 'listed',
    })
    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
  })

  it('fails fast when sealDekEnvelope is missing', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
      }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'sealDekEnvelope is required',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('rejects oversized readme payloads before on-chain verification', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        readme: 'a'.repeat(70_000),
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'readme must be 65536 bytes or less',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('rejects tag arrays that exceed the server-side publish limit before on-chain verification', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'tags must contain at most 10 items',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('starts soul-state verification before the transaction fetch resolves', async () => {
    let resolveTransaction: ((value: unknown) => void) | null = null
    mockedGetSuccessfulTransactionBlock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveTransaction = resolve
    }))

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const responsePromise = POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockedGetVerifiedSoulState).toHaveBeenCalledWith(SOUL_ID, PACKAGE_ID)

    resolveTransaction?.({
      digest: TX_DIGEST,
      transaction: {
        data: {
          sender: AUTHOR_ADDRESS,
        },
      },
    })

    const response = await responsePromise
    expect(response.status).toBe(200)
  })

  it('rejects preview image arrays that exceed the server-side publish limit before on-chain verification', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: Array.from({ length: 11 }, (_, index) => `blob-preview-${index}`),
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'previewImages must contain at most 10 items',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('returns 503 when the soul object package id env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(503)
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('returns 409 when the publisher has multiple Sui wallet bindings', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(walletError)

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
  })

  it('rejects listing events whose seller wallet does not match the authenticated user', async () => {
    mockedExtractSoulPublishEvent.mockReturnValueOnce({
      kind: 'listed',
      event: {
        soulObjectId: SOUL_ID,
        kioskId: KIOSK_ID,
        kioskCapOnChainId: KIOSK_CAP_ID,
        sellerAddress: `0x${'f'.repeat(64)}`,
        priceAtomic: 1_000_000_000n,
      },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul publisher does not match the authenticated wallet',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })

  it('rejects listing events whose mirrored price is zero or negative', async () => {
    mockedExtractSoulPublishEvent.mockReturnValueOnce({
      kind: 'listed',
      event: {
        listingObjectId: LISTING_ID,
        soulObjectId: SOUL_ID,
        kioskId: KIOSK_ID,
        kioskCapOnChainId: KIOSK_CAP_ID,
        sellerAddress: AUTHOR_ADDRESS,
        priceAtomic: 0n,
      },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul listing price must be greater than zero',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })

  it('allows the current holder to sync a relisted Soul without matching the creator wallet', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([HOLDER_ADDRESS])
    mockedReadTransactionSender.mockReturnValueOnce(HOLDER_ADDRESS)
    mockedPrisma.soulAsset.findUnique.mockResolvedValueOnce({
      creatorMemberId: 'creator-member',
      creatorAddress: AUTHOR_ADDRESS,
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-preview'],
      readme: 'Stored README',
      sealSidecar: { encryptedObject: 'sealed' },
    })
    mockedExtractSoulPublishEvent.mockReturnValueOnce({
      kind: 'listed',
      event: {
        listingObjectId: LISTING_ID,
        soulObjectId: SOUL_ID,
        kioskId: KIOSK_ID,
        kioskCapOnChainId: KIOSK_CAP_ID,
        sellerAddress: HOLDER_ADDRESS,
        priceAtomic: 2_000_000n,
      },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(200)
    expect(mockedDbUpsertSoulAsset).toHaveBeenCalledWith(expect.objectContaining({
      creatorAddress: AUTHOR_ADDRESS,
      creatorMemberId: 'creator-member',
      currentOwnerAddress: HOLDER_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: 2_000_000n,
      readme: 'Stored README',
    }))
    expect(mockedCreateSealEnvelopeSidecar).not.toHaveBeenCalled()
  })

  it('allows an agent owner to relist an existing Soul through the publish mirror route', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { memberId: 'agent-member-1', kind: 'agent' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([HOLDER_ADDRESS])
    mockedReadTransactionSender.mockReturnValueOnce(HOLDER_ADDRESS)
    mockedPrisma.soulAsset.findUnique.mockResolvedValueOnce({
      creatorMemberId: 'creator-member',
      creatorAddress: AUTHOR_ADDRESS,
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-preview'],
      readme: 'Stored README',
      sealSidecar: { encryptedObject: 'sealed' },
    })
    mockedExtractSoulPublishEvent.mockReturnValueOnce({
      kind: 'listed',
      event: {
        listingObjectId: LISTING_ID,
        soulObjectId: SOUL_ID,
        kioskId: KIOSK_ID,
        kioskCapOnChainId: KIOSK_CAP_ID,
        sellerAddress: HOLDER_ADDRESS,
        priceAtomic: 2_000_000n,
      },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer sk-agent-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
      }),
    }) as any)

    expect(response.status).toBe(200)
    expect(mockedDbUpsertSoulAsset).toHaveBeenCalledWith(expect.objectContaining({
      creatorAddress: AUTHOR_ADDRESS,
      creatorMemberId: 'creator-member',
      currentOwnerAddress: HOLDER_ADDRESS,
      currentOwnerMemberId: 'agent-member-1',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: 2_000_000n,
      readme: 'Stored README',
    }))
    expect(mockedCreateSealEnvelopeSidecar).not.toHaveBeenCalled()
  })

  it('still rejects agent initial publish sync for Souls that do not exist locally yet', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { memberId: 'agent-member-1', kind: 'agent' },
    })
    mockedPrisma.soulAsset.findUnique.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer sk-agent-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Only human accounts can mirror the initial Soul publish',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('rejects listing transactions whose sender does not match the authenticated wallet', async () => {
    mockedReadTransactionSender.mockReturnValueOnce(HOLDER_ADDRESS)

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction sender does not match the authenticated wallet',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })

  it('rejects listing transactions when the sender metadata is missing', async () => {
    mockedReadTransactionSender.mockReturnValueOnce(null)

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction sender does not match the authenticated wallet',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })

  it('rejects publish sync when the submitted content blob id does not match the on-chain Soul', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      objectId: SOUL_ID,
      creatorAddress: AUTHOR_ADDRESS,
      creatorRoyaltyBps: 0,
      ownerAddress: KIOSK_ID,
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      name: 'Signal Soul',
      description: 'Encrypted bundle',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
      contentBlobId: 'blob-onchain',
      allowlistAddress: null,
      allowlistVersion: 0n,
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-client',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Submitted content blob id does not match the on-chain Soul',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })

  it('allows a non-creator holder to sync a relisted Soul using stored metadata', async () => {
    const HOLDER_ADDRESS = `0x${'7'.repeat(64)}`
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([HOLDER_ADDRESS])
    mockedReadTransactionSender.mockReturnValueOnce(HOLDER_ADDRESS)
    mockedExtractSoulPublishEvent.mockReturnValueOnce({
      kind: 'listed',
      event: {
        listingObjectId: LISTING_ID,
        soulObjectId: SOUL_ID,
        kioskId: KIOSK_ID,
        kioskCapOnChainId: KIOSK_CAP_ID,
        sellerAddress: HOLDER_ADDRESS,
        priceAtomic: 2_000_000n,
      },
    })
    mockedPrisma.soulAsset.findUnique.mockResolvedValueOnce({
      creatorMemberId: 'creator-member-1',
      creatorAddress: AUTHOR_ADDRESS,
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-preview'],
      readme: 'README',
      sealSidecar: { encryptedObject: 'sealed' },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
      }),
    }) as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '2000000',
      listingStatus: 'listed',
    })
    expect(mockedCreateSealEnvelopeSidecar).not.toHaveBeenCalled()
    expect(mockedDbUpsertSoulAsset).toHaveBeenCalledWith(expect.objectContaining({
      creatorMemberId: 'creator-member-1',
      currentOwnerAddress: HOLDER_ADDRESS,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: 2_000_000n,
      contentBlobId: 'blob-content',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['blob-preview'],
      readme: 'README',
      sealSidecar: { encryptedObject: 'sealed' },
    }))
  })

  it('rejects contentBlobId values that do not match the verified on-chain Soul', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-wrong',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Submitted content blob id does not match the on-chain Soul',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })

  it('mirrors the listed Soul and persists tx sync state', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        readme: 'README',
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: '1000000',
      listingStatus: 'listed',
    })
    expect(mockedDbUpsertSoulAsset).toHaveBeenCalledWith(expect.objectContaining({
      soulOnChainId: SOUL_ID,
      creatorAddress: AUTHOR_ADDRESS,
      creatorRoyaltyBps: 0,
      currentOwnerAddress: AUTHOR_ADDRESS,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingObjectOnChainId: LISTING_ID,
      listedPriceAtomic: 1_000_000n,
      contentBlobId: 'blob-content',
      contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
      readme: 'README',
    }))
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'publish',
      resourceKey: SOUL_ID,
      statusCode: 200,
    }))
  })

  it('uses the on-chain Soul package id when creating the publish seal sidecar', async () => {
    const onChainSoulPackageId = `0x${'8'.repeat(64)}`
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      objectId: SOUL_ID,
      packageId: onChainSoulPackageId,
      creatorAddress: AUTHOR_ADDRESS,
      creatorRoyaltyBps: 0,
      ownerAddress: KIOSK_ID,
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      name: 'Signal Soul',
      description: 'Encrypted bundle',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
      contentBlobId: 'blob-content',
      allowlistAddress: null,
      allowlistVersion: 0n,
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        readme: 'README',
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(200)
    expect(mockedCreateSealEnvelopeSidecar).toHaveBeenCalledWith(expect.objectContaining({
      packageId: onChainSoulPackageId,
    }))
  })

  it('rejects stale publish retry when Soul ownership has changed', async () => {
    const BUYER_ADDRESS = `0x${'b'.repeat(64)}`
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      objectId: SOUL_ID,
      creatorAddress: AUTHOR_ADDRESS,
      creatorRoyaltyBps: 0,
      ownerAddress: BUYER_ADDRESS,
      ownerKind: 'address',
      ownerObjectId: null,
      name: 'Signal Soul',
      description: 'Encrypted bundle',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
      contentBlobId: 'blob-content',
      allowlistAddress: null,
      allowlistVersion: 0n,
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txDigest: TX_DIGEST,
        soulOnChainId: SOUL_ID,
        contentBlobId: 'blob-content',
        contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
        category: 'Research',
        tags: ['alpha'],
        previewImages: ['blob-preview'],
        sealDekEnvelope: 'envelope',
      }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul ownership has changed since this publish transaction',
    })
    expect(mockedDbUpsertSoulAsset).not.toHaveBeenCalled()
  })
})
