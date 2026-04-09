import { beforeEach, describe, expect, it, vi } from 'vitest'

const BUYER_ADDRESS = `0x${'1'.repeat(64)}`
const KIOSK_ID = `0x${'2'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'3'.repeat(64)}`

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedResolveOwnedPersonalKiosk = vi.hoisted(() => vi.fn())
const MockSoulPersonalKioskInvariantError = vi.hoisted(() => class MockSoulPersonalKioskInvariantError extends Error {
  kind: 'conflict' | 'service'

  constructor(message: string, kind: 'conflict' | 'service' = 'service') {
    super(message)
    this.kind = kind
  }
})

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/personal-kiosk', () => ({
  resolveOwnedPersonalKiosk: mockedResolveOwnedPersonalKiosk,
  SoulPersonalKioskInvariantError: MockSoulPersonalKioskInvariantError,
}))

describe('Soul personal kiosk route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([BUYER_ADDRESS])
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedResolveOwnedPersonalKiosk.mockResolvedValue({
      status: 'ready',
      kiosk: {
        ownerAddress: BUYER_ADDRESS,
        currentKioskId: KIOSK_ID,
        currentKioskCapOnChainId: KIOSK_CAP_ID,
      },
    })
  })

  it('marks the personal kiosk route as dynamic', async () => {
    const routeModule = await import('../../web/app/api/souls/personal-kiosk/route.ts')

    expect(routeModule.dynamic).toBe('force-dynamic')
  })

  it('returns 403 when the viewer has no wallet bindings', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([])

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Bind a Sui wallet before using the Soul market',
    })
  })

  it('returns 404 when no Soul personal kiosk exists yet', async () => {
    mockedResolveOwnedPersonalKiosk.mockResolvedValueOnce({ status: 'missing' })

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'No Soul personal kiosk found for this wallet',
    })
  })

  it('returns 409 when the registered Soul kiosk conflicts with the wallet-owned caps', async () => {
    mockedResolveOwnedPersonalKiosk.mockRejectedValueOnce(
      new MockSoulPersonalKioskInvariantError(
        'Soul market registry points to a kiosk that is not owned by the current wallet',
        'conflict',
      ),
    )

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul market registry points to a kiosk that is not owned by the current wallet',
    })
  })

  it('returns 503 when Soul personal kiosk resolution fails unexpectedly', async () => {
    mockedResolveOwnedPersonalKiosk.mockRejectedValueOnce(
      new Error('unexpected kiosk resolution failure'),
    )

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to resolve Soul personal kiosk right now',
    })
  })

  it('keeps service-side Soul kiosk invariant failures on the generic 503 path', async () => {
    mockedResolveOwnedPersonalKiosk.mockRejectedValueOnce(
      new MockSoulPersonalKioskInvariantError('Soul market config type is unavailable on chain', 'service'),
    )

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to resolve Soul personal kiosk right now',
    })
  })

  it('rate limits personal kiosk resolution before wallet lookup', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })

    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many Soul personal kiosk requests, try again later',
    })
    expect(mockedGetMemberSuiWalletAddresses).not.toHaveBeenCalled()
    expect(mockedResolveOwnedPersonalKiosk).not.toHaveBeenCalled()
  })

  it('returns the resolved Soul personal kiosk for the authenticated viewer', async () => {
    const { GET } = await import('../../web/app/api/souls/personal-kiosk/route.ts')
    const response = await GET()

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
