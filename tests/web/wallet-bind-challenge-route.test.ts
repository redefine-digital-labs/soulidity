import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

describe('wallet bind challenge route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      memberId: 'member-1',
      kind: 'human',
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
  })

  it('requires explicit header auth instead of cookie fallback', async () => {
    const { POST } = await import('../../web/app/api/wallet/bind/challenge/route.ts')

    await POST(new Request('http://localhost/api/wallet/bind/challenge', { method: 'POST' }) as any)

    expect(mockedResolveIdentity).toHaveBeenCalledWith({ allowCookieFallback: false })
  })
})
