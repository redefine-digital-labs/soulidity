import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedBuildAgentApiKeyData = vi.hoisted(() => vi.fn())
const mockedGenerateApiKey = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  member: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  buildAgentApiKeyData: mockedBuildAgentApiKeyData,
  generateApiKey: mockedGenerateApiKey,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('agents route hardening', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'human-1',
      kind: 'human',
    })
    mockedTakeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 3600,
    })
    mockedBuildAgentApiKeyData.mockReturnValue({
      apiKey: null,
      apiKeyHash: 'hash',
      agentStatus: 'active',
    })
    mockedGenerateApiKey.mockReturnValue('sk-test')
    mockedPrisma.member.count.mockResolvedValue(0)
    mockedPrisma.member.create.mockResolvedValue({
      id: 'agent-1',
      displayName: 'Scout',
    })
  })

  it('blocks agent identities from deleting sibling agents', async () => {
    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'agent-1',
      kind: 'agent',
    })

    const { DELETE } = await import('../../web/app/api/agents/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/agents?id=550e8400-e29b-41d4-a716-446655440000') as any,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Agent 不能管理其他 Agent' })
    expect(mockedPrisma.member.findUnique).not.toHaveBeenCalled()
  })

  it('blocks agent identities from regenerating keys for sibling agents', async () => {
    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'agent-1',
      kind: 'agent',
    })

    const { PATCH } = await import('../../web/app/api/agents/route.ts')
    const response = await PATCH(
      new Request('http://localhost/api/agents', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '550e8400-e29b-41d4-a716-446655440000' }),
      }) as any,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Agent 不能管理其他 Agent' })
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('rejects overlong display names during agent creation', async () => {
    const { POST } = await import('../../web/app/api/agents/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'x'.repeat(101) }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'displayName 不能超过 100 个字符' })
    expect(mockedPrisma.member.create).not.toHaveBeenCalled()
  })

  it('rate limits repeated agent creation attempts', async () => {
    mockedTakeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 3600,
    })

    const { POST } = await import('../../web/app/api/agents/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Scout' }),
      }) as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
    await expect(response.json()).resolves.toEqual({ error: '请求过于频繁，请稍后再试' })
  })

  it('enforces an account-level agent quota', async () => {
    mockedPrisma.member.count.mockResolvedValue(20)

    const { POST } = await import('../../web/app/api/agents/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Scout' }),
      }) as any,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '每个账号最多只能创建 20 个 Agent' })
    expect(mockedPrisma.member.create).not.toHaveBeenCalled()
  })

  it('blocks deleting agents that still own related soul records without relying on a removed settlementEvent model', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      accountId: 'account-1',
      kind: 'agent',
    })

    const tx = {
      $queryRaw: vi.fn(),
      post: {
        count: vi.fn().mockResolvedValue(0),
      },
      soulAsset: {
        count: vi.fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
      },
      soulPreparedPurchase: {
        count: vi.fn().mockResolvedValue(1),
      },
      member: {
        delete: vi.fn(),
      },
    }

    mockedPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx))

    const { DELETE } = await import('../../web/app/api/agents/route.ts')
    const response = await DELETE(
      {
        nextUrl: new URL('http://localhost/api/agents?id=550e8400-e29b-41d4-a716-446655440000'),
      } as any,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: '该 Agent 已有关联内容或交易记录，暂不支持删除',
    })
    expect(tx.member.delete).not.toHaveBeenCalled()
  })
})
