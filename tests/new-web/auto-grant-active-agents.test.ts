import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))

const ACCOUNT_ID = 'account-1'

describe('getActiveAgentSuiAddressesForAccount', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty array when accountId is empty', async () => {
    const { getActiveAgentSuiAddressesForAccount } = await import(
      '../../web/lib/agents/account-agents'
    )
    expect(await getActiveAgentSuiAddressesForAccount('')).toEqual([])
    expect(mockedPrisma.member.findMany).not.toHaveBeenCalled()
  })

  it('returns active agents with sui binding mapped to { memberId, address, displayName }', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      {
        id: 'agent-1',
        displayName: 'Echo',
        walletBindings: [{ address: '0xagent1' }],
      },
      {
        id: 'agent-2',
        displayName: null,
        walletBindings: [{ address: '0xagent2' }],
      },
    ])

    const { getActiveAgentSuiAddressesForAccount } = await import(
      '../../web/lib/agents/account-agents'
    )
    const result = await getActiveAgentSuiAddressesForAccount(ACCOUNT_ID)

    expect(result).toEqual([
      { memberId: 'agent-1', address: '0xagent1', displayName: 'Echo' },
      { memberId: 'agent-2', address: '0xagent2', displayName: null },
    ])
    expect(mockedPrisma.member.findMany).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID, kind: 'agent', agentStatus: 'active' },
      select: expect.objectContaining({
        id: true,
        displayName: true,
        walletBindings: expect.objectContaining({
          where: { chain: 'sui' },
          select: { address: true },
          take: 1,
        }),
      }),
      orderBy: { joinedAt: 'asc' },
    })
  })

  it('skips agents with no sui wallet binding (chain==sui filter is in the prisma where, but result row may still be empty)', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: 'A', walletBindings: [] },
      { id: 'agent-2', displayName: 'B', walletBindings: [{ address: '0xagent2' }] },
    ])
    const { getActiveAgentSuiAddressesForAccount } = await import(
      '../../web/lib/agents/account-agents'
    )
    const result = await getActiveAgentSuiAddressesForAccount(ACCOUNT_ID)
    expect(result).toEqual([
      { memberId: 'agent-2', address: '0xagent2', displayName: 'B' },
    ])
  })

  it('returns empty when prisma returns no rows', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([])
    const { getActiveAgentSuiAddressesForAccount } = await import(
      '../../web/lib/agents/account-agents'
    )
    expect(await getActiveAgentSuiAddressesForAccount(ACCOUNT_ID)).toEqual([])
  })
})
