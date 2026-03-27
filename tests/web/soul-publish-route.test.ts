import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AUTHOR_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`
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
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedExtractSoulListingEvent = vi.hoisted(() => vi.fn())
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

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  extractSoulListingEvent: mockedExtractSoulListingEvent,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: (left: string | null | undefined, right: string | null | undefined) =>
    String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
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
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedExtractSoulListingEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      sellerAddress: AUTHOR_ADDRESS,
      priceSui: 1_000_000_000n,
    })
    mockedGetVerifiedSoulState.mockResolvedValue({
      objectId: SOUL_ID,
      creatorAddress: AUTHOR_ADDRESS,
      ownerAddress: KIOSK_ID,
      name: 'Signal Soul',
      description: 'Encrypted bundle',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: CONTENT_BLOB_OBJECT_ID,
      contentBlobId: 'blob-content',
      agentGrant: null,
      grantVersion: 0n,
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

  it('rejects listing events whose seller wallet does not match the authenticated user', async () => {
    mockedExtractSoulListingEvent.mockReturnValueOnce({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      sellerAddress: `0x${'f'.repeat(64)}`,
      priceSui: 1_000_000_000n,
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
      error: 'Soul listing seller does not match the authenticated wallet',
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
      sellerKioskId: KIOSK_ID,
      listedPriceSui: '1000000000',
      listingStatus: 'listed',
    })
    expect(mockedDbUpsertSoulAsset).toHaveBeenCalledWith(expect.objectContaining({
      soulOnChainId: SOUL_ID,
      creatorAddress: AUTHOR_ADDRESS,
      currentOwnerAddress: AUTHOR_ADDRESS,
      sellerKioskId: KIOSK_ID,
      listedPriceSui: 1_000_000_000n,
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
})
