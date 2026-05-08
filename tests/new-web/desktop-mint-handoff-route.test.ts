import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedHandoffDeleteMany = vi.hoisted(() => vi.fn())
const mockedHandoffCreate = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/desktop/auth', () => ({
  requireDesktopIdentity: mockedRequireDesktopIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: {
    desktopMintHandoff: {
      deleteMany: mockedHandoffDeleteMany,
      create: mockedHandoffCreate,
    },
  },
}))

function buildPayload(): Record<string, unknown> {
  return {
    name: 'Test Soul',
    description: 'A description',
    tags: ['alpha'],
    royaltyBps: 500,
    soulMarkdown: '# Soul',
    memoryMarkdown: '# Memory',
    coverImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    coverImageFileName: 'cover.png',
    coverImageMimeType: 'image/png',
    coverImagePrompt: 'a cover',
    characterType: 'agent',
    extraDescription: '',
    skillsArchive: null,
  }
}

function postJson(payload: unknown): Request {
  return new Request('http://localhost/api/desktop/mint-handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('POST /api/desktop/mint-handoff route hardening', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-1',
      desktopPet: {
        id: 'pet-1',
        accountId: 'account-1',
        agentAddress: '0xagent',
        agentMemberId: 'member-1',
      },
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedHandoffDeleteMany.mockResolvedValue({ count: 0 })
    mockedHandoffCreate.mockImplementation(async ({ data, select }: {
      data: { token: string; expiresAt: Date }
      select: unknown
    }) => {
      void select
      return { token: data.token, expiresAt: data.expiresAt }
    })
  })

  it('returns 429 with Retry-After when the rate limit is exceeded, and never touches the DB', async () => {
    mockedTakeRateLimitToken.mockResolvedValue({ limited: true, retryAfterSeconds: 42 })

    const { POST } = await import('../../web/app/api/desktop/mint-handoff/route')
    const response = await POST(postJson(buildPayload()))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    await expect(response.json()).resolves.toEqual({ error: 'Too many requests' })
    expect(mockedHandoffDeleteMany).not.toHaveBeenCalled()
    expect(mockedHandoffCreate).not.toHaveBeenCalled()
    // The rate-limit bucket must be keyed on the authenticated account so a
    // hostile renderer cannot rotate around the cap by spoofing a header.
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      'desktop-mint-handoff:account-1',
      expect.objectContaining({ max: expect.any(Number), windowMs: expect.any(Number) }),
    )
  })

  it('drops every prior handoff row for the account before inserting a new one (single-active-handoff)', async () => {
    const { POST } = await import('../../web/app/api/desktop/mint-handoff/route')
    const response = await POST(postJson(buildPayload()))

    expect(response.status).toBe(200)
    expect(mockedHandoffDeleteMany).toHaveBeenCalledTimes(1)
    // The where clause must scope to accountId only — the previous "OR
    // expired/consumed" filter let the storage-amplification path land an
    // unbounded set of unexpired+unconsumed rows per token.
    expect(mockedHandoffDeleteMany).toHaveBeenCalledWith({
      where: { accountId: 'account-1' },
    })
    expect(mockedHandoffCreate).toHaveBeenCalledTimes(1)
  })
})
