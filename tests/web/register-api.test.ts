import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimitBucketsForTests } from '@web/lib/rate-limit'

const AUTH_JSON_HEADERS = {
  authorization: 'Bearer token',
  'content-type': 'application/json',
  'x-forwarded-for': '203.0.113.10',
} as const

const transactionMocks = vi.hoisted(() => ({
  account: {
    create: vi.fn(),
  },
  inviteCode: {
    updateMany: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const mockedPrisma = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
  },
  inviteCode: {
    findUnique: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const mockedPrivy = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

describe('POST /api/register', () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS

  beforeEach(() => {
    vi.resetAllMocks()
    resetRateLimitBucketsForTests()
    process.env.TRUST_PROXY_HEADERS = 'true'

    mockedPrivy.verifyAuthToken.mockResolvedValue({ userId: 'did:privy:123' })
    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'user@example.com' },
    })
    mockedPrisma.account.findUnique.mockResolvedValue(null)
    mockedPrisma.inviteCode.findUnique.mockResolvedValue({
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      active: 0,
      usedBy: '123456',
    })
    mockedPrisma.member.findFirst.mockResolvedValue({ id: 'member-1', tgId: '123456' })
    transactionMocks.account.create.mockResolvedValue({ id: 'account-1' })
    transactionMocks.member.findFirst.mockResolvedValue({ id: 'member-1', tgId: '123456' })
    transactionMocks.member.updateMany.mockResolvedValue({ count: 1 })
    transactionMocks.inviteCode.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.$transaction.mockImplementation(async (callback: any) => callback(transactionMocks))
  })

  afterEach(() => {
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders
    }
  })

  it('returns a JSON 500 response for unexpected registration errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrisma.$transaction.mockRejectedValue(new Error('boom'))

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: '注册失败，请稍后重试' })
    expect(consoleError).toHaveBeenCalledWith('[register] unexpected error:', expect.any(Error))

    consoleError.mockRestore()
  })

  it('returns a JSON 500 response when Privy user lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrivy.getUser.mockRejectedValueOnce(new Error('privy unavailable'))

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: '注册失败，请稍后重试' })
    expect(consoleError).toHaveBeenCalledWith('[register] unexpected error:', expect.any(Error))

    consoleError.mockRestore()
  })

  it('rejects requests without a bearer token', async () => {
    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '未登录' })
  })

  it('rejects invalid bearer tokens', async () => {
    mockedPrivy.verifyAuthToken.mockRejectedValue(new Error('bad token'))

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: {
        ...AUTH_JSON_HEADERS,
        authorization: 'Bearer invalid',
      },
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '无效的认证令牌' })
  })

  it('rejects missing invite codes', async () => {
    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({}),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '缺少邀请码' })
  })

  it('treats malformed JSON bodies as missing invite codes', async () => {
    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: '{',
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '缺少邀请码' })
  })

  it('rejects malformed invite codes', async () => {
    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'not-a-code' }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '邀请码格式无效' })
  })

  it('rejects already-registered accounts', async () => {
    mockedPrisma.account.findUnique.mockResolvedValueOnce({ id: 'existing-account' })

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '该账号已注册' })
  })

  it('rejects email reuse', async () => {
    mockedPrisma.account.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'email-taken' })

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '该邮箱已注册' })
  })

  it('rejects invalid invite codes without revealing pending-member state', async () => {
    mockedPrisma.inviteCode.findUnique.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: '邀请码无效或已使用' })
  })

  it('rejects codes without a pending member using the same generic error', async () => {
    mockedPrisma.member.findFirst.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: '邀请码无效或已使用' })
  })

  it('rejects pending members whose invite code was never consumed by join', async () => {
    mockedPrisma.inviteCode.findUnique.mockResolvedValue({
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      active: 1,
      usedBy: null,
    })

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: '邀请码无效或已使用' })
  })

  it('expires stale pending registrations when invite codes have no explicit expiry', async () => {
    const staleCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    mockedPrisma.inviteCode.findUnique.mockResolvedValue({ createdAt: staleCreatedAt, expiresAt: null, active: 0, usedBy: '123456' })
    mockedPrisma.member.findFirst.mockResolvedValue({
      id: 'member-1',
      tgId: '123456',
    })

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: '邀请码已过期' })
  })

  it('returns a race-safe 422 when the pending member disappears inside the transaction', async () => {
    transactionMocks.member.findFirst.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: '邀请码无效或已使用' })
  })

  it('creates an account and links the pending member on success', async () => {
    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, memberId: 'member-1' })
    expect(transactionMocks.account.create).toHaveBeenCalledWith({
      data: {
        privyDid: 'did:privy:123',
        tgId: '123456',
        email: 'user@example.com',
      },
    })
    expect(transactionMocks.member.updateMany).toHaveBeenCalledWith({
      where: { id: 'member-1', accountId: null },
      data: { accountId: 'account-1', displayName: 'user' },
    })
    expect(transactionMocks.inviteCode.updateMany).toHaveBeenCalledWith({
      where: { code: 'ABCD1234', active: 1, usedBy: null },
      data: { active: 0, usedBy: '123456' },
    })
  })

  it('maps privyDid unique conflicts to a 409', async () => {
    const conflict: any = new Error('Unique constraint failed')
    conflict.code = 'P2002'
    conflict.meta = { target: ['privy_did'] }
    transactionMocks.account.create.mockRejectedValueOnce(conflict)

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '该账号已注册' })
  })

  it('maps tgId unique conflicts to a 409', async () => {
    const conflict: any = new Error('Unique constraint failed')
    conflict.code = 'P2002'
    conflict.meta = { target: ['tg_id'] }
    transactionMocks.account.create.mockRejectedValueOnce(conflict)

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '该账号已注册' })
  })

  it('maps email unique conflicts to a 409', async () => {
    const conflict: any = new Error('Unique constraint failed')
    conflict.code = 'P2002'
    conflict.meta = { target: ['email'] }
    transactionMocks.account.create.mockRejectedValueOnce(conflict)

    const { POST } = await import('../../web/app/api/register/route.ts')
    const response = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '该邮箱已注册' })
  })

  it('rate-limits repeated registration attempts by authenticated user', async () => {
    const { POST } = await import('../../web/app/api/register/route.ts')

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await POST(new Request('http://localhost/api/register', {
        method: 'POST',
        headers: AUTH_JSON_HEADERS,
        body: JSON.stringify({ code: 'ABCD1234' }),
      }) as any)
      expect(response.status).toBe(200)
    }

    const limitedResponse = await POST(new Request('http://localhost/api/register', {
      method: 'POST',
      headers: AUTH_JSON_HEADERS,
      body: JSON.stringify({ code: 'ABCD1234' }),
    }) as any)

    expect(limitedResponse.status).toBe(429)
    await expect(limitedResponse.json()).resolves.toEqual({ error: '请求过于频繁，请稍后再试' })
    expect(limitedResponse.headers.get('Retry-After')).toBeTruthy()
  })
})
