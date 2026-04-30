import { beforeEach, describe, expect, it, vi } from 'vitest'

const BUYER_ADDRESS = `0x${'1'.repeat(64)}`
const KIOSK_ID = `0x${'2'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'3'.repeat(64)}`

const mockedRequireSoulCreateWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedTakeBestEffortRateLimitToken = vi.hoisted(() => vi.fn())
const mockedResolveOwnedPersonalKiosk = vi.hoisted(() => vi.fn())
const MockSoulidityPersonalKioskInvariantError = vi.hoisted(() => class MockSoulidityPersonalKioskInvariantError extends Error {
  kind: 'conflict' | 'service'

  constructor(message: string, kind: 'conflict' | 'service' = 'service') {
    super(message)
    this.kind = kind
  }
})

vi.mock('@/lib/soulidity/server', () => ({
  requireSoulCreateWalletIdentity: mockedRequireSoulCreateWalletIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  takeBestEffortRateLimitToken: mockedTakeBestEffortRateLimitToken,
}))

vi.mock('@/lib/soulidity/personal-kiosk', () => ({
  resolveOwnedPersonalKiosk: mockedResolveOwnedPersonalKiosk,
  SoulidityPersonalKioskInvariantError: MockSoulidityPersonalKioskInvariantError,
}))

describe('Soul personal kiosk route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireSoulCreateWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1', accountId: 'account-1', kind: 'human' },
      walletAddresses: [BUYER_ADDRESS],
      primarySuiAddress: BUYER_ADDRESS,
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedTakeBestEffortRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedResolveOwnedPersonalKiosk.mockResolvedValue({
      status: 'ready',
      kiosk: {
        ownerAddress: BUYER_ADDRESS,
        currentKioskId: KIOSK_ID,
        currentKioskCapOnChainId: KIOSK_CAP_ID,
      },
    })
  })

  function createRequest(url = 'http://localhost/api/souls/personal-kiosk') {
    return {
      nextUrl: new URL(url),
    } as any
  }

  it('marks the personal kiosk route as dynamic', async () => {
    const routeModule = await import('../../web/app/api/souls/personal-kiosk/route.ts')

    expect(routeModule.dynamic).toBe('force-dynamic')
  })

  it('returns auth failures from the desktop-compatible guard', async () => {
    mockedRequireSoulCreateWalletIdentity.mockResolvedValueOnce({
      error: Response.json({ error: 'Bind a Sui wallet before using the Soulidity market' }, { status: 403 }),
    })

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET(createRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Bind a Sui wallet before using the Soulidity market',
    })
  })

  it('returns 404 when no Soulidity personal kiosk exists yet', async () => {
    mockedResolveOwnedPersonalKiosk.mockResolvedValueOnce({ status: 'missing' })

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET(createRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'No Soulidity personal kiosk found for this wallet',
    })
  })

  it('returns 409 when the registered Soulidity kiosk conflicts with the wallet-owned caps', async () => {
    mockedResolveOwnedPersonalKiosk.mockRejectedValueOnce(
      new MockSoulidityPersonalKioskInvariantError(
        'Soulidity market registry points to a kiosk that is not owned by the current wallet',
        'conflict',
      ),
    )

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET(createRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soulidity market registry points to a kiosk that is not owned by the current wallet',
    })
  })

  it('rate limits personal kiosk resolution before chain lookup', async () => {
    mockedTakeBestEffortRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET(createRequest())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many Soul personal kiosk requests, try again later',
    })
    expect(mockedResolveOwnedPersonalKiosk).not.toHaveBeenCalled()
  })

  it('uses best-effort read-only rate limiting for the create-flow kiosk preflight', async () => {
    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET(createRequest(`http://localhost/api/souls/personal-kiosk?walletAddress=${BUYER_ADDRESS}`))

    expect(response.status).toBe(200)
    expect(mockedTakeBestEffortRateLimitToken).toHaveBeenCalledWith(
      'soul-personal-kiosk:member-1',
      { max: 30, windowMs: 60_000 },
    )
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
  })

  it('returns the resolved Soulidity personal kiosk for the authenticated viewer', async () => {
    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET(createRequest(`http://localhost/api/souls/personal-kiosk?walletAddress=${BUYER_ADDRESS}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ownerAddress: BUYER_ADDRESS,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
    })
    expect(mockedResolveOwnedPersonalKiosk).toHaveBeenCalledWith({
      ownerAddresses: [BUYER_ADDRESS],
    })
  })
})
