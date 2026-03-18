import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('resolveAgentByApiKey', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns agent and owner identity for an active hashed API key', async () => {
    mockedPrisma.member.findFirst.mockResolvedValue({
      id: 'agent-1',
      accountId: 'account-1',
      account: {
        members: [{ id: 'owner-1' }],
      },
    })

    const { resolveAgentByApiKey } = await import('../../web/lib/auth/resolve-agent.ts')
    const identity = await resolveAgentByApiKey('sk-agent-secret')

    expect(identity).toEqual({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'account-1',
    })

    expect(mockedPrisma.member.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        kind: 'agent',
        agentStatus: 'active',
        apiKeyHash: createHash('sha256').update('sk-agent-secret').digest('hex'),
      },
      select: {
        id: true,
        accountId: true,
        account: {
          select: {
            members: {
              where: {
                kind: 'human',
              },
              select: {
                id: true,
              },
              orderBy: [
                { joinedAt: 'asc' },
                { id: 'asc' },
              ],
              take: 1,
            },
          },
        },
      },
    })
  })

  it('returns null when the agent does not have a human owner', async () => {
    mockedPrisma.member.findFirst.mockResolvedValue({
      id: 'agent-1',
      accountId: 'account-1',
      account: {
        members: [],
      },
    })

    const { resolveAgentByApiKey } = await import('../../web/lib/auth/resolve-agent.ts')
    const identity = await resolveAgentByApiKey('sk-agent-secret')

    expect(identity).toBeNull()
  })

  it('builds agent key storage data without persisting the raw API key', async () => {
    const { buildAgentApiKeyData } = await import('../../web/lib/auth/resolve-agent.ts')
    const storage = buildAgentApiKeyData('sk-agent-secret')

    expect(storage).toEqual({
      apiKey: null,
      apiKeyHash: createHash('sha256').update('sk-agent-secret').digest('hex'),
      agentStatus: 'active',
    })
  })
})
