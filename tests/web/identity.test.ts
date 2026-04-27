import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRateLimitBucketsForTests } from '../../web/lib/rate-limit.ts'

const NORMALIZED_ABC = `0x${'0'.repeat(61)}abc`

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findUnique: vi.fn(),
  },
  walletChallenge: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
  },
}))

const mockedHeaders = vi.hoisted(() => vi.fn())
const mockedVerify = vi.hoisted(() => ({
  verifyPersonalMessageSignature: vi.fn(),
}))
const mockedResolveAgent = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/request-headers', () => ({
  getRequestHeaders: mockedHeaders,
}))

vi.mock('@web/lib/sui-verify', () => mockedVerify)

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: mockedResolveAgent,
}))

describe('resolveIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resetRateLimitBucketsForTests()
    process.env.NEXT_PUBLIC_BASE_URL = 'https://clawnews.example.com'
    process.env.AUTH_SECRET = 'test-secret-for-session-jwt'
    delete process.env.TRUST_PROXY_HEADERS
  })

  it('returns null when there are no auth headers and no cookie', async () => {
    mockedHeaders.mockResolvedValue(new Headers())
    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toBeNull()
  })

  it('rejects unknown bearer tokens (no Privy fallback)', async () => {
    mockedHeaders.mockResolvedValue(new Headers({ authorization: 'Bearer some-legacy-token' }))
    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toBeNull()
  })

  it('rejects empty bearer tokens', async () => {
    mockedHeaders.mockResolvedValue(new Headers({ authorization: 'Bearer ' }))
    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toBeNull()
  })

  it('resolves agent identity from sk- bearer token', async () => {
    mockedHeaders.mockResolvedValue(new Headers({ authorization: 'Bearer sk-agent-secret-key' }))
    mockedResolveAgent.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'account-1',
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toEqual({
      accountId: 'account-1',
      memberId: 'agent-1',
      ownerMemberId: 'owner-1',
      kind: 'agent',
    })
  })

  it('rejects trivially short sk- API keys without DB lookup', async () => {
    mockedHeaders.mockResolvedValue(new Headers({ authorization: 'Bearer sk-' }))
    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedResolveAgent).not.toHaveBeenCalled()
  })

  it('resolves human identity from a valid session cookie', async () => {
    const { signSession, generateCsrfToken, hashCsrfToken } = await import('../../web/lib/auth/session.ts')
    const csrfHash = hashCsrfToken(generateCsrfToken())
    const sessionToken = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: NORMALIZED_ABC,
      csrfHash,
      kind: 'human',
    })
    mockedHeaders.mockResolvedValue(new Headers({ cookie: `session=${sessionToken}` }))
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      accountId: 'account-1',
      kind: 'human',
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolveIdentity()
    expect(identity).toMatchObject({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    expect(identity?.session?.csrfHash).toBe(csrfHash)
  })

  it('rejects a session cookie when the member no longer exists', async () => {
    const { signSession, generateCsrfToken, hashCsrfToken } = await import('../../web/lib/auth/session.ts')
    const sessionToken = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: NORMALIZED_ABC,
      csrfHash: hashCsrfToken(generateCsrfToken()),
      kind: 'human',
    })
    mockedHeaders.mockResolvedValue(new Headers({ cookie: `session=${sessionToken}` }))
    mockedPrisma.member.findUnique.mockResolvedValue(null)

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toBeNull()
  })

  it('rejects a session cookie when the member account no longer matches', async () => {
    const { signSession, generateCsrfToken, hashCsrfToken } = await import('../../web/lib/auth/session.ts')
    const sessionToken = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: NORMALIZED_ABC,
      csrfHash: hashCsrfToken(generateCsrfToken()),
      kind: 'human',
    })
    mockedHeaders.mockResolvedValue(new Headers({ cookie: `session=${sessionToken}` }))
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      accountId: 'account-different',
      kind: 'human',
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toBeNull()
  })

  it('prefers wallet auth over session cookie when both are present', async () => {
    const nonce = '12121212-1212-4212-8212-121212121212'
    const normalizedAddress = `0x${'0'.repeat(63)}1`
    process.env.TRUST_PROXY_HEADERS = 'true'

    const { signSession, generateCsrfToken, hashCsrfToken } = await import('../../web/lib/auth/session.ts')
    const sessionToken = await signSession({
      memberId: 'cookie-member',
      accountId: 'cookie-account',
      walletAddress: NORMALIZED_ABC,
      csrfHash: hashCsrfToken(generateCsrfToken()),
      kind: 'human',
    })

    mockedHeaders.mockResolvedValue(new Headers({
      cookie: `session=${sessionToken}`,
      'x-forwarded-for': '203.0.113.10',
      'x-agent-address': normalizedAddress,
      'x-agent-signature': 'signature',
      'x-agent-message': nonce,
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: normalizedAddress,
      nonce,
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
      domain: 'clawnews.example.com',
    })
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      member: { id: 'wallet-member', accountId: 'wallet-account', kind: 'human' },
    })
    mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => normalizedAddress,
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    await expect(resolveIdentity()).resolves.toMatchObject({
      memberId: 'wallet-member',
      accountId: 'wallet-account',
      kind: 'human',
    })
    expect(mockedPrisma.member.findUnique).not.toHaveBeenCalled()
  })
})

describe('requireMutationIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resetRateLimitBucketsForTests()
    process.env.NEXT_PUBLIC_BASE_URL = 'https://clawnews.example.com'
    process.env.AUTH_SECRET = 'test-secret-for-session-jwt'
  })

  async function buildSessionRequest(opts: { withCsrfHeader?: boolean; sameOrigin?: boolean } = {}) {
    const { signSession, generateCsrfToken, hashCsrfToken } = await import('../../web/lib/auth/session.ts')
    const csrfToken = generateCsrfToken()
    const csrfHash = hashCsrfToken(csrfToken)
    const sessionToken = await signSession({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: NORMALIZED_ABC,
      csrfHash,
      kind: 'human',
    })

    const headers = new Headers({
      host: 'app.example.com',
      cookie: `session=${sessionToken}`,
    })
    if (opts.sameOrigin !== false) headers.set('origin', 'https://app.example.com')
    else headers.set('origin', 'https://evil.example.com')
    if (opts.withCsrfHeader) headers.set('x-csrf-token', csrfToken)

    mockedHeaders.mockResolvedValue(headers)
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      accountId: 'account-1',
      kind: 'human',
    })

    return new Request('https://app.example.com/api/test', { method: 'POST', headers })
  }

  it('rejects cookie-auth mutations without a CSRF header', async () => {
    const request = await buildSessionRequest({ withCsrfHeader: false })
    const { requireMutationIdentity } = await import('../../web/lib/auth/identity.ts')
    const result = await requireMutationIdentity(request)
    expect(result.identity).toBeNull()
    expect(result.error?.status).toBe(403)
  })

  it('rejects cookie-auth mutations with a wrong-origin Origin header', async () => {
    const request = await buildSessionRequest({ withCsrfHeader: true, sameOrigin: false })
    const { requireMutationIdentity } = await import('../../web/lib/auth/identity.ts')
    const result = await requireMutationIdentity(request)
    expect(result.identity).toBeNull()
    expect(result.error?.status).toBe(403)
  })

  it('accepts cookie-auth mutations with a matching CSRF token and same-origin', async () => {
    const request = await buildSessionRequest({ withCsrfHeader: true, sameOrigin: true })
    const { requireMutationIdentity } = await import('../../web/lib/auth/identity.ts')
    const result = await requireMutationIdentity(request)
    expect(result.error).toBeNull()
    expect(result.identity).toMatchObject({
      memberId: 'member-1',
      accountId: 'account-1',
      kind: 'human',
    })
  })

  it('accepts header-only agent identity without requiring CSRF', async () => {
    process.env.TRUST_PROXY_HEADERS = 'true'
    const nonce = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const normalizedAddress = `0x${'0'.repeat(63)}1`

    mockedHeaders.mockResolvedValue(new Headers({
      'x-forwarded-for': '203.0.113.10',
      'x-agent-address': normalizedAddress,
      'x-agent-signature': 'signature',
      'x-agent-message': nonce,
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: normalizedAddress,
      nonce,
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
      domain: 'clawnews.example.com',
    })
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      member: { id: 'agent-member', accountId: 'agent-account', kind: 'agent' },
    })
    mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => normalizedAddress,
    })

    const request = new Request('https://app.example.com/api/test', { method: 'POST' })
    const { requireMutationIdentity } = await import('../../web/lib/auth/identity.ts')
    const result = await requireMutationIdentity(request)
    expect(result.error).toBeNull()
    expect(result.identity).toMatchObject({
      memberId: 'agent-member',
      accountId: 'agent-account',
      kind: 'agent',
    })
  })

  it('returns 401 when there is no identity at all', async () => {
    mockedHeaders.mockResolvedValue(new Headers())
    const request = new Request('https://app.example.com/api/test', { method: 'POST' })
    const { requireMutationIdentity } = await import('../../web/lib/auth/identity.ts')
    const result = await requireMutationIdentity(request)
    expect(result.identity).toBeNull()
    expect(result.error?.status).toBe(401)
  })
})
