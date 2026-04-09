import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  member: {
    update: vi.fn(),
  },
}))
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const IDENTITY = { memberId: 'member-1', kind: 'human' }

describe('PATCH /api/profile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireIdentity.mockResolvedValue({ error: null, identity: IDENTITY })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.member.update.mockResolvedValue({
      id: 'member-1', displayName: 'Test', avatar: '🤖', bio: null, handle: null, twitterUrl: null, websiteUrl: null,
    })
  })

  async function callPatch(body: Record<string, unknown>) {
    const { PATCH } = await import('../../web/app/api/profile/route.ts')
    return PATCH(makeRequest(body) as any)
  }

  it('updates displayName successfully', async () => {
    const res = await callPatch({ displayName: 'New Name' })
    expect(res.status).toBe(200)
    expect(mockedPrisma.member.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: 'New Name' } }),
    )
  })

  it('rejects displayName over 50 chars', async () => {
    const res = await callPatch({ displayName: 'a'.repeat(51) })
    expect(res.status).toBe(400)
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('rejects duplicate handle with 409', async () => {
    mockedPrisma.member.update.mockRejectedValueOnce({ code: 'P2002' })
    const res = await callPatch({ handle: 'taken_handle' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already taken/)
  })

  it('rejects invalid handle format', async () => {
    const res = await callPatch({ handle: 'ab' }) // too short
    expect(res.status).toBe(400)
  })

  it('rejects bio over 160 chars', async () => {
    const res = await callPatch({ bio: 'x'.repeat(161) })
    expect(res.status).toBe(400)
  })

  it('rejects invalid twitterUrl', async () => {
    const res = await callPatch({ twitterUrl: 'not-a-url' })
    expect(res.status).toBe(400)
  })

  it('returns 401 for unauthenticated request', async () => {
    const mockError = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockedRequireIdentity.mockResolvedValueOnce({ error: mockError, identity: null })
    const res = await callPatch({ displayName: 'test' })
    expect(res.status).toBe(401)
  })

  it('partial update only changes specified fields', async () => {
    await callPatch({ bio: 'hello' })
    expect(mockedPrisma.member.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bio: 'hello' } }),
    )
  })

  it('null value clears field', async () => {
    await callPatch({ handle: null })
    expect(mockedPrisma.member.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { handle: null } }),
    )
  })

  it('rate limits profile updates', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })
    const res = await callPatch({ displayName: 'test' })
    expect(res.status).toBe(429)
  })
})
