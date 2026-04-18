import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findUnique: vi.fn(),
  },
  post: {
    findUnique: vi.fn(),
  },
  comment: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/reports', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
  })

  it('returns 404 when the reported soul does not exist', async () => {
    mockedPrisma.soulAsset.findUnique.mockResolvedValue(null)
    const { POST } = await import('../../web/app/api/reports/route.ts')

    const res = await POST(
      makeRequest({
        subjectType: 'soul',
        subjectId: '0xdeadbeef',
        category: 'harmful',
      }) as never,
    )

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'subject-not-found' })
  })

  it('returns 404 for a syntactically invalid post UUID without hitting prisma', async () => {
    const { POST } = await import('../../web/app/api/reports/route.ts')

    const res = await POST(
      makeRequest({
        subjectType: 'post',
        subjectId: 'not-a-uuid',
        category: 'off-topic',
      }) as never,
    )

    expect(res.status).toBe(404)
    expect(mockedPrisma.post.findUnique).not.toHaveBeenCalled()
  })

  it('accepts a real soul report and logs canonical metadata', async () => {
    mockedPrisma.soulAsset.findUnique.mockResolvedValue({
      onChainId: '0xabc',
      name: 'Trader Bot',
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { POST } = await import('../../web/app/api/reports/route.ts')

    const res = await POST(
      makeRequest({
        subjectType: 'soul',
        subjectId: '0xabc',
        category: 'impersonation',
        notes: 'looks like a clone',
      }) as never,
    )

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(infoSpy).toHaveBeenCalledWith(
      '[report]',
      expect.stringContaining('"subjectLabel":"Trader Bot"'),
    )
    infoSpy.mockRestore()
  })

  it('accepts a valid post report by UUID', async () => {
    mockedPrisma.post.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Sample Post',
    })
    const { POST } = await import('../../web/app/api/reports/route.ts')

    const res = await POST(
      makeRequest({
        subjectType: 'post',
        subjectId: '11111111-1111-1111-1111-111111111111',
        category: 'harmful',
      }) as never,
    )

    expect(res.status).toBe(202)
    expect(mockedPrisma.post.findUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-1111-1111-111111111111' },
      select: { id: true, title: true },
    })
  })
})
