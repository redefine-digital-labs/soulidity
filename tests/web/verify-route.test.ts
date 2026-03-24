import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  inviteCode: {
    updateMany: vi.fn(),
  },
  member: {
    upsert: vi.fn(),
  },
}))

const mockedGetRequestIp = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: mockedGetRequestIp,
  MISSING_CLIENT_IP_ERROR: 'Client IP unavailable',
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

describe('verify route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedGetRequestIp.mockReturnValue('127.0.0.1')
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.inviteCode.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.member.upsert.mockResolvedValue({})
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockedPrisma) => Promise<unknown>) => callback(mockedPrisma))
  })

  it('returns 400 for malformed JSON bodies', async () => {
    const { POST } = await import('../../web/app/api/verify/route.ts')
    const response = await POST(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' })
    expect(mockedPrisma.inviteCode.updateMany).not.toHaveBeenCalled()
  })

  it('rejects non-string or oversized tg_name values before DB writes', async () => {
    const { POST } = await import('../../web/app/api/verify/route.ts')
    const response = await POST(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'JOIN1234',
        tg_id: '123456',
        tg_name: 'x'.repeat(101),
      }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid input' })
    expect(mockedPrisma.inviteCode.updateMany).not.toHaveBeenCalled()
    expect(mockedPrisma.member.upsert).not.toHaveBeenCalled()
  })

  it('rejects non-numeric tg_id values before consuming invite codes', async () => {
    const { POST } = await import('../../web/app/api/verify/route.ts')
    const response = await POST(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'JOIN1234',
        tg_id: 'tg-not-numeric',
      }),
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid input' })
    expect(mockedPrisma.inviteCode.updateMany).not.toHaveBeenCalled()
    expect(mockedPrisma.member.upsert).not.toHaveBeenCalled()
  })

  it('returns 422 when the invite code is invalid or already used', async () => {
    mockedPrisma.inviteCode.updateMany.mockResolvedValue({ count: 0 })

    const { POST } = await import('../../web/app/api/verify/route.ts')
    const response = await POST(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'USED1234',
        tg_id: '123456',
      }),
    }) as any)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      verified: false,
      error: 'Invalid or used invite code',
    })
    expect(mockedPrisma.member.upsert).not.toHaveBeenCalled()
  })

  it('trims tg_name before storing a newly verified member', async () => {
    const { POST } = await import('../../web/app/api/verify/route.ts')
    const response = await POST(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'JOIN1234',
        tg_id: '123456',
        tg_name: '  openclaw  ',
      }),
    }) as any)

    expect(response.status).toBe(200)
    expect(mockedPrisma.inviteCode.updateMany).toHaveBeenCalledWith({
      where: { code: 'JOIN1234', active: 1, usedBy: null },
      data: { usedBy: '123456', active: 0 },
    })
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.member.upsert).toHaveBeenCalledWith({
      where: { tgId: '123456' },
      create: { tgId: '123456', tgName: 'openclaw', inviteCode: 'JOIN1234' },
      update: {},
    })
  })

  it('stores null when tg_name becomes empty after trimming', async () => {
    const { POST } = await import('../../web/app/api/verify/route.ts')
    const response = await POST(new Request('http://localhost/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'JOIN1234',
        tg_id: '123456',
        tg_name: '   ',
      }),
    }) as any)

    expect(response.status).toBe(200)
    expect(mockedPrisma.member.upsert).toHaveBeenCalledWith({
      where: { tgId: '123456' },
      create: { tgId: '123456', tgName: null, inviteCode: 'JOIN1234' },
      update: {},
    })
  })
})
