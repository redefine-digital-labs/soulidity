import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const OWNER_ADDRESS = `0x${'1'.repeat(64)}`
const AGENT_ADDRESS = `0x${'2'.repeat(64)}`
const SOUL_ID = `0x${'3'.repeat(64)}`
const ACCESS_CAP_ID = `0x${'4'.repeat(64)}`
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
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulAccessCapState = vi.hoisted(() => vi.fn())
const mockedDbSetSoulAgentGrant = vi.hoisted(() => vi.fn())
const mockedDbRevokeSoulAgentGrant = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
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
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  getVerifiedSoulAccessCapState: mockedGetVerifiedSoulAccessCapState,
  sameSuiValue: (left: string | null | undefined, right: string | null | undefined) =>
    String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbSetSoulAgentGrant: mockedDbSetSoulAgentGrant,
  dbRevokeSoulAgentGrant: mockedDbRevokeSoulAgentGrant,
}))

describe('soul grant route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([OWNER_ADDRESS])
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'member-1',
      listingStatus: 'held',
    })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedGetVerifiedSoulState.mockResolvedValue({
      ownerAddress: OWNER_ADDRESS,
      agentGrant: AGENT_ADDRESS,
      grantVersion: 5n,
    })
    mockedGetVerifiedSoulAccessCapState.mockResolvedValue({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      grantVersion: 5n,
    })
    mockedDbSetSoulAgentGrant.mockResolvedValue(undefined)
    mockedDbRevokeSoulAgentGrant.mockResolvedValue(undefined)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
  })

  it('only allows the current holder of a held Soul to manage grant state', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'other-member',
      listingStatus: 'held',
    })

    const { POST } = await import('../../web/app/api/souls/[id]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          agentAddress: AGENT_ADDRESS,
          soulAccessCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Only the current owner can manage agent access',
    })
  })

  it('mirrors agent grant creation from verified on-chain Soul state', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          agentAddress: AGENT_ADDRESS,
          soulAccessCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      agentGrantAddress: AGENT_ADDRESS,
      soulAccessCapOnChainId: ACCESS_CAP_ID,
      grantVersion: '5',
    })
    expect(mockedDbSetSoulAgentGrant).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      agentGrantAddress: AGENT_ADDRESS,
      agentAccessCapOnChainId: ACCESS_CAP_ID,
      grantVersion: 5n,
    })
  })

  it('replays cached grant responses for duplicate tx digests', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 200,
      body: { soulOnChainId: SOUL_ID, grantVersion: '5' },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          agentAddress: AGENT_ADDRESS,
          soulAccessCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedDbSetSoulAgentGrant).not.toHaveBeenCalled()
  })

  it('mirrors grant revocation once the on-chain grant is cleared', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerAddress: OWNER_ADDRESS,
      agentGrant: null,
      grantVersion: 6n,
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/grant/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/grant', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      agentGrantAddress: null,
      soulAccessCapOnChainId: null,
      grantVersion: '6',
    })
    expect(mockedDbRevokeSoulAgentGrant).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      grantVersion: 6n,
    })
  })
})
