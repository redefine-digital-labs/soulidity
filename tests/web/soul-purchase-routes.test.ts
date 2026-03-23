import { beforeEach, describe, expect, it, vi } from 'vitest'

const BUYER_ADDRESS = `0x${'b'.repeat(64)}`
const SERIES_ID = `0x${'1'.repeat(64)}`
const PASS_ID = `0x${'2'.repeat(64)}`
const RELEASE_ID = `0x${'3'.repeat(64)}`
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const VALID_TX_DIGEST = '11111111111111111111111111111111'

function normalizeTestSuiAddress(value: string): string {
  const hex = value.trim().toLowerCase().replace(/^0x/, '')
  return `0x${hex.padStart(64, '0')}`
}

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  member: { findUnique: vi.fn() },
  soulTxSync: { upsert: vi.fn() },
  $transaction: vi.fn(),
}))
const mockedDbCreatePass = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  getTransactionBlock: vi.fn(),
  getObject: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbCreatePass: mockedDbCreatePass,
}))

vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('Soul purchase route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID = PACKAGE_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(BUYER_ADDRESS)
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: SERIES_ID,
    })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      wallet: BUYER_ADDRESS,
      walletBindings: [{ address: BUYER_ADDRESS, chain: 'sui' }],
    })
    mockedSuiClient.getTransactionBlock.mockResolvedValue({
      digest: VALID_TX_DIGEST,
      effects: { status: { status: 'success' } },
      objectChanges: [
        {
          type: 'created',
          objectId: PASS_ID,
          objectType: `${PACKAGE_ID}::pass::PerpetualPass`,
          sender: BUYER_ADDRESS,
          owner: { AddressOwner: BUYER_ADDRESS },
        },
      ],
    })
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: PASS_ID,
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        owner: { AddressOwner: BUYER_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            series_id: SERIES_ID,
            release_id: RELEASE_ID,
            owner: BUYER_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })
    mockedDbCreatePass.mockResolvedValue({
      id: 'pass-db-1',
      onChainId: '0xpass',
      passType: 'perpetual',
    })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockedPrisma) => Promise<unknown>) => callback(mockedPrisma))
  })

  it('returns 400 for invalid JSON', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/purchase', {
        method: 'POST',
        body: '{invalid',
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(400)
  })

  it('rate limits purchase mirroring before the route hits chain RPCs', async () => {
    mockedTakeRateLimitToken.mockReturnValue({ limited: true, retryAfterSeconds: 120 })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbCreatePass).not.toHaveBeenCalled()
  })

  it('rejects agent identities from using the human purchase mirror route', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'agent-member-1', kind: 'agent' },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Use the agent purchase API',
    })
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('rejects mirroring when the submitted transaction never created the requested pass', async () => {
    mockedSuiClient.getTransactionBlock.mockResolvedValue({
      digest: VALID_TX_DIGEST,
      effects: { status: { status: 'success' } },
      objectChanges: [],
    })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Transaction did not create the submitted pass',
    })
    expect(mockedDbCreatePass).not.toHaveBeenCalled()
  })

  it('replays the stored purchase sync response for an already-processed txDigest', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValue({
      statusCode: 201,
      body: {
        id: 'pass-db-cached',
        onChainId: PASS_ID,
        passType: 'perpetual',
      },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      id: 'pass-db-cached',
      onChainId: PASS_ID,
      passType: 'perpetual',
    })
    expect(mockedGetStoredSoulTxSync).toHaveBeenCalledWith({
      txDigest: VALID_TX_DIGEST,
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: PASS_ID,
    })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedSuiClient.getObject).not.toHaveBeenCalled()
    expect(mockedDbCreatePass).not.toHaveBeenCalled()
  })

  it('returns 503 when the soul package id env is missing before on-chain verification', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Service temporarily unavailable',
    })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbCreatePass).not.toHaveBeenCalled()
  })

  it('returns structured 500 JSON when purchase mirroring hits an unexpected sync error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedSuiClient.getTransactionBlock.mockRejectedValueOnce(new Error('rpc down'))

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Sync failed',
    })
    expect(mockedDbCreatePass).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('derives pass type and locked release from verified chain state instead of request JSON', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: PASS_ID,
          txDigest: VALID_TX_DIGEST,
          planType: 'subscription',
          lockedReleaseId: '0xspoofed-release',
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(201)
    expect(mockedDbCreatePass).toHaveBeenCalledWith({
      db: mockedPrisma,
      passOnChainId: PASS_ID,
      seriesOnChainId: SERIES_ID,
      ownerAddress: BUYER_ADDRESS,
      ownerMemberId: 'member-1',
      passType: 'perpetual',
      lockedReleaseId: RELEASE_ID,
      mintTxDigest: VALID_TX_DIGEST,
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith({
      db: mockedPrisma,
      txDigest: VALID_TX_DIGEST,
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: PASS_ID,
      statusCode: 201,
      body: {
        id: 'pass-db-1',
        onChainId: '0xpass',
        passType: 'perpetual',
      },
    })
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockedGetMemberPrimarySuiWalletAddress).toHaveBeenCalledWith('member-1')
  })

  it('stores purchase sync results under the normalized request pass id even if RPC returns a different casing', async () => {
    const requestPassId = '0xAbCd'
    const normalizedPassId = normalizeTestSuiAddress(requestPassId)
    const rpcPassId = normalizedPassId.toUpperCase()

    mockedSuiClient.getTransactionBlock.mockResolvedValueOnce({
      digest: VALID_TX_DIGEST,
      effects: { status: { status: 'success' } },
      objectChanges: [
        {
          type: 'created',
          objectId: rpcPassId,
          objectType: `${PACKAGE_ID}::pass::PerpetualPass`,
          sender: BUYER_ADDRESS,
          owner: { AddressOwner: BUYER_ADDRESS },
        },
      ],
      transaction: { data: { sender: BUYER_ADDRESS } },
    })
    mockedSuiClient.getObject.mockResolvedValueOnce({
      data: {
        objectId: rpcPassId,
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        owner: { AddressOwner: BUYER_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            series_id: SERIES_ID,
            release_id: RELEASE_ID,
            owner: BUYER_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/purchase/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/souls/${SERIES_ID}/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passOnChainId: requestPassId,
          txDigest: VALID_TX_DIGEST,
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(201)
    expect(mockedGetStoredSoulTxSync).toHaveBeenCalledWith({
      txDigest: VALID_TX_DIGEST,
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: normalizedPassId,
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith({
      db: mockedPrisma,
      txDigest: VALID_TX_DIGEST,
      routeKey: 'purchase',
      actorKey: 'member-1',
      resourceKey: normalizedPassId,
      statusCode: 201,
      body: {
        id: 'pass-db-1',
        onChainId: '0xpass',
        passType: 'perpetual',
      },
    })
  })

  it('returns 503 for renew requests (not yet implemented)', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/renew/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/renew', {
        method: 'POST',
        body: '{invalid}',
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(503)
  })
})
