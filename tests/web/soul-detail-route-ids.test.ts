import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const MARKET_CONFIG_ID = `0x${'8'.repeat(64)}`
const SOUL_ID = `0x${'1'.repeat(64)}`

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedToSoulAssetDetail = vi.hoisted(() => vi.fn())
const mockedGetVerifiedMarketConfigState = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
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
  getVerifiedMarketConfigState: mockedGetVerifiedMarketConfigState,
}))

describe('soul detail routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID = MARKET_CONFIG_ID

    mockedResolveIdentity.mockResolvedValue(null)
    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listedPriceSui: '1000000000',
      listingStatus: 'listed',
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
      listedPriceSui: '1000000000',
      listingStatus: 'listed',
      creatorAddress: `0x${'2'.repeat(64)}`,
      currentOwnerAddress: `0x${'3'.repeat(64)}`,
      createdAt: '2026-03-27T00:00:00.000Z',
      updatedAt: '2026-03-27T00:00:00.000Z',
      metadataRef: null,
      contentBlobId: 'blob-content',
      contentBlobObjectId: '0xblob',
      sellerKioskId: `0x${'4'.repeat(64)}`,
      readme: null,
      agentGrantAddress: null,
      agentAccessCapOnChainId: null,
      grantVersion: '0',
      creatorMemberId: 'creator-1',
      currentOwnerMemberId: 'owner-1',
      purchaseFeeAmountSui: null,
      isOwner: false,
      isCreator: false,
    })
    mockedGetVerifiedMarketConfigState.mockResolvedValue({
      platformFeeBps: 500n,
      royaltyBps: 250n,
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

  it('computes purchase fees for listed Souls on the public detail route', async () => {
    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onChainId: SOUL_ID,
      purchaseFeeAmountSui: '75000000',
    })
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.objectContaining({
      onChainId: SOUL_ID,
    }), null)
  })

  it('passes the authenticated viewer id into public detail serialization', async () => {
    mockedResolveIdentity.mockResolvedValueOnce({ memberId: 'owner-1' })

    const { GET } = await import('../../web/app/api/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), 'owner-1')
  })

  it('uses the agent member id when serializing agent detail responses', async () => {
    const { GET } = await import('../../web/app/api/agent/souls/[id]/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/souls/0xsoul') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedToSoulAssetDetail).toHaveBeenCalledWith(expect.anything(), 'agent-member-1')
  })
})
