import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimitBucketsForTests } from '@/lib/rate-limit'
import { verifyWalrusUploaderToken } from '../../src/shared/walrus-uploader-token'

const WALLET = `0x${'1'.repeat(64)}`
const OTHER_WALLET = `0x${'2'.repeat(64)}`
const SECRET = 'route-secret-with-enough-entropy'

const mockedRequireSoulCreateWalletIdentity = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireSoulCreateWalletIdentity: mockedRequireSoulCreateWalletIdentity,
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/walrus/upload-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/walrus/upload-token', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resetRateLimitBucketsForTests()
    vi.stubEnv('WALRUS_UPLOADER_TOKEN_SECRET', SECRET)
    vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
    mockedRequireSoulCreateWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1' },
      walletAddresses: [WALLET],
      primarySuiAddress: WALLET,
    })
  })

  it('issues a short-lived token scoped to the signed-in wallet and requested upload budget', async () => {
    const { POST } = await import('../../web/app/api/walrus/upload-token/route')
    const response = await POST(makeRequest({
      walletAddress: WALLET,
      fileCount: 3,
      byteLimit: 30_000,
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      tokenType: 'Bearer',
      walletAddress: WALLET,
      network: 'mainnet',
      fileCount: 3,
      byteLimit: 30_000,
    })
    expect(typeof body.token).toBe('string')
    expect(body.expiresAt).toBeGreaterThan(Date.now())

    expect(() =>
      verifyWalrusUploaderToken(body.token, {
        secret: SECRET,
        nowMs: Date.now(),
        walletAddress: WALLET,
        network: 'mainnet',
        fileCount: 3,
        byteCount: 30_000,
      }),
    ).not.toThrow()
  })

  it('rejects wallets outside the authenticated wallet bindings', async () => {
    const { POST } = await import('../../web/app/api/walrus/upload-token/route')
    const response = await POST(makeRequest({
      walletAddress: OTHER_WALLET,
      fileCount: 1,
      byteLimit: 1,
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'walletAddress does not match the signed-in wallet',
    })
  })

  it('rejects tokens for a network outside the configured Web network', async () => {
    const { POST } = await import('../../web/app/api/walrus/upload-token/route')
    const response = await POST(makeRequest({
      walletAddress: WALLET,
      network: 'testnet',
      fileCount: 1,
      byteLimit: 1,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'network must match the configured mainnet network',
    })
  })

  it('rate-limits repeated upload-token mints from one signed-in member', async () => {
    // Without a rate limit, a signed-in wallet could loop POST /upload-token
    // → /v1/uploads to force the managed uploader to encode and stage
    // payloads indefinitely without ever signing the register PTB. The route
    // applies a 20/5min sliding-window guard keyed on memberId; this test
    // exhausts the bucket and verifies the 21st mint is rejected with 429.
    const { POST } = await import('../../web/app/api/walrus/upload-token/route')
    for (let i = 0; i < 20; i += 1) {
      const ok = await POST(makeRequest({
        walletAddress: WALLET,
        fileCount: 1,
        byteLimit: 1,
      }))
      expect(ok.status).toBe(200)
    }
    const limited = await POST(makeRequest({
      walletAddress: WALLET,
      fileCount: 1,
      byteLimit: 1,
    }))
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({
      error: 'Too many Walrus upload-token requests, try again later',
    })
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/)
  })
})
