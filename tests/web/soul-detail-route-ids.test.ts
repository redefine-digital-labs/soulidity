import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ID = `0x${'1'.repeat(64)}`

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedGetAnonymousRateLimitFingerprint = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedToSoulAssetDetail = vi.hoisted(() => vi.fn())
const mockedGetSoulPurchaseQuote = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getAnonymousRateLimitFingerprint: mockedGetAnonymousRateLimitFingerprint,
  getRequestIp: mockedGetRequestIp,
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
  toSoulAssetDetail: mockedToSoulAssetDetail,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
}))

vi.mock('@web/lib/souls/purchase-quote', () => ({
  getSoulPurchaseQuote: mockedGetSoulPurchaseQuote,
}))

describe('soul detail routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue(null)
    mockedGetAnonymousRateLimitFingerprint.mockReturnValue('anon-fingerprint')
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([])
    mockedGetRequestIp.mockReturnValue('203.0.113.10')
    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 0 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      creatorRoyaltyBps: 0,
      listingObjectOnChainId: `0x${'6'.repeat(64)}`,
      listedPriceAtomic: '1000000',
      listingStatus: 'listed',
      currentKioskId: `0x${'4'.repeat(64)}`,
    })
    mockedToSoulAssetDetail.mockReturnValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      name: 'Signal Soul',
      description: 'desc',
      imageUrl: 'https://example.com/soul.png',
      category: 'Research',
      tags: [],
      previewImages: [],
      creatorRoyaltyBps: 0,
      listingObjectOnChainId: `0x${'6'.repeat(64)}`,
      listedPriceAtomic: '1000000',
      listingStatus: 'listed',
      creatorAddress: `0x${'2'.repeat(64)}`,
      currentOwnerAddress: `0x${'3'.repeat(64)}`,
      createdAt: '2026-03-27T00:00:00.000Z',
      updatedAt: '2026-03-27T00:00:00.000Z',
      metadataRef: null,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      currentKioskId: `0x${'4'.repeat(64)}`,
      currentKioskCapOnChainId: `0x${'5'.repeat(64)}`,
      readme: null,
      allowlistAddress: null,
      allowlistCapOnChainId: null,
      allowlistVersion: '0',
      creatorMemberId: 'creator-1',
      currentOwnerMemberId: 'owner-1',
      purchasePlatformFeeAtomic: null,
      purchaseCreatorRoyaltyAtomic: null,
      purchaseTotalAtomic: null,
      quotedPriceAtomic: null,
      isOwner: false,
      isCreator: false,
      isAllowlisted: false,
    })
    mockedGetSoulPurchaseQuote.mockResolvedValue({
      platformFeeAtomic: 50_000n,
      priceAtomic: 1_000_000n,
      creatorRoyaltyAtomic: 25_000n,
      totalAtomic: 1_075_000n,
    })
  })

  it('returns 404 when the public detail route cannot find the Soul', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce(null)

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(404)
    expect(mockedFindSoulAssetDetailByRouteId).toHaveBeenCalledWith(SOUL_ID)
  })

  it('rate limits public detail requests before the on-chain quote lookup', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 12 })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many soul detail requests, try again later',
    })
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
    expect(mockedToSoulAssetDetail).not.toHaveBeenCalled()
    expect(mockedGetSoulPurchaseQuote).not.toHaveBeenCalled()
  })

  it('uses an anonymous fingerprint rate-limit bucket when the request IP is unavailable', async () => {
    mockedGetRequestIp.mockReturnValueOnce(null)

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul', {
        headers: {
          'user-agent': 'SoulBrowser/1.0',
          'accept-language': 'en-US,en;q=0.9',
        },
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'soul-detail:anon:anon-fingerprint',
      expect.objectContaining({ max: 120 }),
    )
    expect(mockedFindSoulAssetDetailByRouteId).toHaveBeenCalledWith(SOUL_ID)
  })

  it('uses a member-scoped fallback bucket when the request IP is unavailable for an authenticated viewer', async () => {
    mockedGetRequestIp.mockReturnValueOnce(null)
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'owner-1' })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'soul-detail:member:owner-1',
      expect.objectContaining({ max: 60 }),
    )
  })

  it('still blocks anonymous fingerprint bucket requests when the request IP is unavailable', async () => {
    mockedGetRequestIp.mockReturnValueOnce(null)
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 7 })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul', {
        headers: {
          'user-agent': 'SoulBrowser/1.0',
          'accept-language': 'en-US,en;q=0.9',
        },
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many soul detail requests, try again later',
    })
    expect(response.headers.get('Retry-After')).toBe('7')
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'soul-detail:anon:anon-fingerprint',
      expect.objectContaining({ max: 120 }),
    )
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('rejects anonymous requests when neither IP nor fingerprint is available', async () => {
    mockedGetRequestIp.mockReturnValueOnce(null)
    mockedGetAnonymousRateLimitFingerprint.mockReturnValueOnce(null)

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to determine client identity for rate limiting',
    })
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('computes purchase fees for listed Souls on the public detail route', async () => {
    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onChainId: SOUL_ID,
      purchasePlatformFeeAtomic: '50000',
      purchaseCreatorRoyaltyAtomic: '25000',
      purchaseTotalAtomic: '1075000',
      quotedPriceAtomic: '1000000',
    })
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.objectContaining({
      onChainId: SOUL_ID,
    }), {
      viewerMemberId: null,
      viewerWalletAddresses: [],
    })
  })

  it('reuses a short-lived cached purchase quote across repeated listed detail requests', async () => {
    mockedToSoulAssetDetail
      .mockReturnValueOnce({
        id: 'asset-db-1',
        onChainId: SOUL_ID,
        name: 'Signal Soul',
        description: 'desc',
        imageUrl: 'https://example.com/soul.png',
        category: 'Research',
        tags: [],
        previewImages: [],
        creatorRoyaltyBps: 0,
        listingObjectOnChainId: `0x${'6'.repeat(64)}`,
        listedPriceAtomic: '1000000',
        listingStatus: 'listed',
        creatorAddress: `0x${'2'.repeat(64)}`,
        currentOwnerAddress: `0x${'3'.repeat(64)}`,
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        metadataRef: null,
        contentBlobId: 'blob-content',
        contentBlobObjectId: '0xblob',
        currentKioskId: `0x${'4'.repeat(64)}`,
        currentKioskCapOnChainId: `0x${'5'.repeat(64)}`,
        readme: null,
        allowlistAddress: null,
        allowlistCapOnChainId: null,
        allowlistVersion: '0',
        creatorMemberId: 'creator-1',
        currentOwnerMemberId: 'owner-1',
        purchasePlatformFeeAtomic: null,
        purchaseCreatorRoyaltyAtomic: null,
        purchaseTotalAtomic: null,
        quotedPriceAtomic: null,
        isOwner: false,
        isCreator: false,
        isAllowlisted: false,
      })
      .mockReturnValueOnce({
        id: 'asset-db-1',
        onChainId: SOUL_ID,
        name: 'Signal Soul',
        description: 'desc',
        imageUrl: 'https://example.com/soul.png',
        category: 'Research',
        tags: [],
        previewImages: [],
        creatorRoyaltyBps: 0,
        listingObjectOnChainId: `0x${'6'.repeat(64)}`,
        listedPriceAtomic: '1000000',
        listingStatus: 'listed',
        creatorAddress: `0x${'2'.repeat(64)}`,
        currentOwnerAddress: `0x${'3'.repeat(64)}`,
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        metadataRef: null,
        contentBlobId: 'blob-content',
        contentBlobObjectId: '0xblob',
        currentKioskId: `0x${'4'.repeat(64)}`,
        currentKioskCapOnChainId: `0x${'5'.repeat(64)}`,
        readme: null,
        allowlistAddress: null,
        allowlistCapOnChainId: null,
        allowlistVersion: '0',
        creatorMemberId: 'creator-1',
        currentOwnerMemberId: 'owner-1',
        purchasePlatformFeeAtomic: null,
        purchaseCreatorRoyaltyAtomic: null,
        purchaseTotalAtomic: null,
        quotedPriceAtomic: null,
        isOwner: false,
        isCreator: false,
        isAllowlisted: false,
      })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')

    const firstResponse = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )
    const secondResponse = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockedGetSoulPurchaseQuote).toHaveBeenCalledTimes(1)
  })

  it('passes the authenticated viewer id into public detail serialization', async () => {
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'owner-1' })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), {
      viewerMemberId: 'owner-1',
      viewerWalletAddresses: [],
    })
  })

  it('starts viewer wallet lookup before the Soul detail query resolves for authenticated viewers', async () => {
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'owner-1' })
    let resolveSoul: ((value: unknown) => void) | null = null
    mockedFindSoulAssetDetailByRouteId.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSoul = resolve
    }))

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const responsePromise = GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockedGetMemberSuiWalletAddresses).toHaveBeenCalledWith('owner-1')

    resolveSoul?.({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      creatorRoyaltyBps: 0,
      listingObjectOnChainId: `0x${'6'.repeat(64)}`,
      listedPriceAtomic: '1000000',
      listingStatus: 'listed',
      currentKioskId: `0x${'4'.repeat(64)}`,
    })

    const response = await responsePromise
    expect(response.status).toBe(200)
  })

  it('marks the agent detail route as force-dynamic', async () => {
    const mod = await import('../../web/app/api/agent/souls/[id]/route.ts')
    expect(mod.dynamic).toBe('force-dynamic')
  })

  it('rate limits agent detail requests before loading the Soul record', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 9 })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many soul detail requests, try again later',
    })
    expect(response.headers.get('Retry-After')).toBe('9')
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith('agent-detail:agent-member-1', {
      max: 60,
      windowMs: 60 * 1000,
    })
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('still returns public Soul detail when the authenticated viewer has multiple Sui wallet bindings', async () => {
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'owner-1' })
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(walletError)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
      const response = await GET(
        new Request('http://localhost/api/souls/0xsoul') as any,
        { params: Promise.resolve({ id: SOUL_ID }) },
      )

      expect(response.status).toBe(200)
      expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), {
        viewerMemberId: 'owner-1',
        viewerWalletAddresses: [],
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[soul-detail] Viewer wallet lookup is ambiguous; continuing without wallet-scoped fields',
        { name: 'MultipleSuiWalletBindingsError', message: 'Multiple Sui wallets' },
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('degrades gracefully when viewer wallet lookup fails unexpectedly', async () => {
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'owner-1' })
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(new Error('wallet service unavailable'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
      const response = await GET(
        new Request('http://localhost/api/souls/0xsoul') as any,
        { params: Promise.resolve({ id: SOUL_ID }) },
      )

      expect(response.status).toBe(200)
      expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), {
        viewerMemberId: 'owner-1',
        viewerWalletAddresses: [],
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[soul-detail] Failed to resolve viewer wallets',
        { name: 'Error', message: 'wallet service unavailable' },
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips purchase quote lookup when the listed Soul is missing its kiosk mirror', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      creatorRoyaltyBps: 0,
      listingObjectOnChainId: null,
      listedPriceAtomic: '1000000',
      listingStatus: 'listed',
      currentKioskId: null,
    })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onChainId: SOUL_ID,
      purchasePlatformFeeAtomic: null,
      purchaseCreatorRoyaltyAtomic: null,
      purchaseTotalAtomic: null,
      quotedPriceAtomic: null,
    })
    expect(mockedGetSoulPurchaseQuote).not.toHaveBeenCalled()
  })

  it('still returns Soul detail when purchase quote lookup fails', async () => {
    mockedGetSoulPurchaseQuote.mockRejectedValueOnce(new MockOnChainVerificationError('Listing is stale'))

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onChainId: SOUL_ID,
      purchasePlatformFeeAtomic: null,
      purchaseCreatorRoyaltyAtomic: null,
      purchaseTotalAtomic: null,
      quotedPriceAtomic: null,
    })
  })

  it('uses the agent member id when serializing agent detail responses', async () => {
    const { GET } = await import('../../web/app/api/agent/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), {
      viewerMemberId: 'agent-member-1',
      viewerWalletAddresses: [],
    })
  })

  it('passes agent wallet addresses so allowlisted state can be derived', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([`0x${'a'.repeat(64)}`])

    const { GET } = await import('../../web/app/api/agent/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), {
      viewerMemberId: 'agent-member-1',
      viewerWalletAddresses: [`0x${'a'.repeat(64)}`],
    })
  })
})
