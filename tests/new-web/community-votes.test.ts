import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedQueryRaw = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  post: {
    findFirst: vi.fn(),
  },
  postVote: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  $queryRaw: mockedQueryRaw,
  $transaction: vi.fn(),
}))
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

const IDENTITY = { memberId: 'member-1', kind: 'human' }
const POST_ID = 'post-1'

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/community/posts/${POST_ID}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/community/posts/[id]/vote', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireIdentity.mockResolvedValue({ error: null, identity: IDENTITY })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.post.findFirst.mockResolvedValue({ id: POST_ID })
    mockedPrisma.postVote.findUnique.mockResolvedValue(null) // no existing vote

    // $transaction executes the callback with the mock prisma as tx
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => {
      return fn(mockedPrisma)
    })

    // Default $queryRaw: SELECT FOR UPDATE returns nothing important,
    // UPDATE RETURNING returns like_count
    mockedQueryRaw.mockResolvedValue([{ like_count: 0 }])
  })

  async function callVote(body: Record<string, unknown>) {
    const { POST } = await import('../../new-web/app/api/community/posts/[id]/vote/route.ts')
    return POST(makeRequest(body) as any, { params: Promise.resolve({ id: POST_ID }) })
  }

  it('creates upvote successfully', async () => {
    // First $queryRaw = SELECT FOR UPDATE, second = UPDATE RETURNING
    mockedQueryRaw
      .mockResolvedValueOnce([{ id: POST_ID }])  // FOR UPDATE
      .mockResolvedValueOnce([{ like_count: 1 }]) // UPDATE RETURNING
    const res = await callVote({ direction: 1 })
    expect(res.status).toBe(200)
    expect(mockedPrisma.postVote.create).toHaveBeenCalled()
    const body = await res.json()
    expect(body.likeCount).toBe(1)
    expect(body.userVote).toBe(1)
  })

  it('toggles off same direction vote', async () => {
    mockedPrisma.postVote.findUnique.mockResolvedValueOnce({
      id: 'vote-1', postId: POST_ID, memberId: 'member-1', direction: 1,
    })
    mockedQueryRaw
      .mockResolvedValueOnce([{ id: POST_ID }])  // FOR UPDATE
      .mockResolvedValueOnce([{ like_count: 0 }]) // UPDATE RETURNING
    const res = await callVote({ direction: 1 })
    expect(res.status).toBe(200)
    expect(mockedPrisma.postVote.delete).toHaveBeenCalled()
    const body = await res.json()
    expect(body.userVote).toBeNull()
  })

  it('flips vote direction', async () => {
    mockedPrisma.postVote.findUnique.mockResolvedValueOnce({
      id: 'vote-1', postId: POST_ID, memberId: 'member-1', direction: 1,
    })
    mockedQueryRaw
      .mockResolvedValueOnce([{ id: POST_ID }])   // FOR UPDATE
      .mockResolvedValueOnce([{ like_count: -1 }]) // UPDATE RETURNING
    const res = await callVote({ direction: -1 })
    expect(res.status).toBe(200)
    expect(mockedPrisma.postVote.update).toHaveBeenCalled()
    const body = await res.json()
    expect(body.likeCount).toBe(-1)
    expect(body.userVote).toBe(-1)
  })

  it('rejects unauthenticated vote', async () => {
    const mockError = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockedRequireIdentity.mockResolvedValueOnce({ error: mockError, identity: null })
    const res = await callVote({ direction: 1 })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent post', async () => {
    mockedPrisma.post.findFirst.mockResolvedValueOnce(null)
    const res = await callVote({ direction: 1 })
    expect(res.status).toBe(404)
  })

  it('rejects invalid direction', async () => {
    const res = await callVote({ direction: 2 })
    expect(res.status).toBe(400)
  })
})
