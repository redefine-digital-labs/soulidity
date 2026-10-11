import { beforeEach, describe, expect, it, vi } from 'vitest'

const NORMALIZED_WALLET = `0x${'0'.repeat(61)}abc`
const NONCE = '11111111-1111-4111-8111-111111111111'

const mockedLogin = vi.hoisted(() => ({
  loginWithWalletSignature: vi.fn(),
}))

class MockWalletLoginError extends Error {
  reason: string
  constructor(message: string, reason: string) {
    super(message)
    this.reason = reason
  }
}

vi.mock('@/lib/auth/wallet-login', () => ({
  loginWithWalletSignature: mockedLogin.loginWithWalletSignature,
  WalletLoginError: MockWalletLoginError,
}))

vi.mock('@/lib/rate-limit', () => ({
  getRequestIp: () => null,
  getAnonymousRateLimitFingerprint: () => null,
  takeRateLimitToken: vi.fn().mockResolvedValue({ limited: false }),
}))

function buildRequest(init: {
  origin?: string | null
  referer?: string | null
  host?: string | null
  body?: unknown
}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (init.host) headers.set('host', init.host)
  if (init.origin) headers.set('origin', init.origin)
  if (init.referer) headers.set('referer', init.referer)
  return new Request('https://app.example.com/api/auth/wallet-login', {
    method: 'POST',
    headers,
    body: JSON.stringify(init.body ?? {
      address: NORMALIZED_WALLET,
      signature: 'sig',
      nonce: NONCE,
    }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  process.env.AUTH_SECRET = 'test-secret-for-session-jwt'
  mockedLogin.loginWithWalletSignature.mockResolvedValue({
    memberId: 'member-1',
    accountId: 'account-1',
    walletAddress: NORMALIZED_WALLET,
  })
})

describe('POST /api/auth/wallet-login same-origin gate', () => {
  it('rejects cross-origin requests before minting a session', async () => {
    const { POST } = await import('../../web/app/api/auth/wallet-login/route.ts')
    const req = buildRequest({
      host: 'app.example.com',
      origin: 'https://evil.example.com',
    })

    const res = await POST(req as unknown as Parameters<typeof POST>[0])

    expect(res.status).toBe(403)
    expect(mockedLogin.loginWithWalletSignature).not.toHaveBeenCalled()
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeNull()
  })

  it('rejects when neither origin nor referer is present', async () => {
    const { POST } = await import('../../web/app/api/auth/wallet-login/route.ts')
    const req = buildRequest({ host: 'app.example.com' })

    const res = await POST(req as unknown as Parameters<typeof POST>[0])

    expect(res.status).toBe(403)
    expect(mockedLogin.loginWithWalletSignature).not.toHaveBeenCalled()
  })

  it('proceeds when origin matches the request host', async () => {
    const { POST } = await import('../../web/app/api/auth/wallet-login/route.ts')
    const req = buildRequest({
      host: 'app.example.com',
      origin: 'https://app.example.com',
    })

    const res = await POST(req as unknown as Parameters<typeof POST>[0])

    expect(res.status).toBe(200)
    expect(mockedLogin.loginWithWalletSignature).toHaveBeenCalledTimes(1)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('session=')
  })
})
