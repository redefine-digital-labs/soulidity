import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  soulGrantRecord: {
    findMany: vi.fn(),
  },
  member: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))

const SOUL_ID = `0x${'a'.repeat(64)}`
const ACCOUNT_ID = 'account-1'

describe('getGranteesWithActiveGrants', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty Set when granteeAddresses is empty', async () => {
    const { getGranteesWithActiveGrants } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const result = await getGranteesWithActiveGrants({
      soulOnChainId: SOUL_ID,
      granteeAddresses: [],
    })
    expect(result.size).toBe(0)
    expect(mockedPrisma.soulGrantRecord.findMany).not.toHaveBeenCalled()
  })

  it('queries by soul + grantees + active + non-expired and returns matched addresses (no scope filter)', async () => {
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xagent1' },
      { granteeAddress: '0xagent3' },
    ])
    const now = new Date('2026-05-10T00:00:00.000Z')
    const { getGranteesWithActiveGrants } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const result = await getGranteesWithActiveGrants({
      soulOnChainId: SOUL_ID,
      granteeAddresses: ['0xagent1', '0xagent2', '0xagent3'],
      now,
    })
    expect(result).toEqual(new Set(['0xagent1', '0xagent3']))
    expect(mockedPrisma.soulGrantRecord.findMany).toHaveBeenCalledWith({
      where: {
        soulOnChainId: SOUL_ID,
        granteeAddress: { in: ['0xagent1', '0xagent2', '0xagent3'] },
        status: 'active',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      select: { granteeAddress: true },
    })
  })
})

describe('computeAutoGrantTargets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty plan when no agents exist for account', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 8,
      currentCapacity: 1,
      activeGrantCount: 0,
    })
    expect(plan.targets).toEqual([])
    expect(plan.requiredCapacity).toBe(1)
  })

  it('subtracts agents who already hold any active grant on this soul', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: null, walletBindings: [{ address: '0xagent1' }] },
      { id: 'agent-2', displayName: null, walletBindings: [{ address: '0xagent2' }] },
      { id: 'agent-3', displayName: null, walletBindings: [{ address: '0xagent3' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xagent2' },
    ])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 8,
      currentCapacity: 1,
      activeGrantCount: 1,
    })
    expect(plan.targets.map((t) => t.address)).toEqual(['0xagent1', '0xagent3'])
    // activeGrantCount + new targets = 1 + 2 = 3, larger than currentCapacity=1
    expect(plan.requiredCapacity).toBe(3)
    expect(plan.activeGrantCount).toBe(1)
    expect(plan.currentCapacity).toBe(1)
  })

  it('skips an agent with a narrow grant for a DIFFERENT scope so the issue PTB cannot narrow them — regression for [F-?] auto-grant scope narrowing', async () => {
    // The pet only holds an `[assets]` grant (issued by `PetGrantDialog`,
    // mask 8). The owner now uploads a private memory
    // (kindScopeMask = SOUL_GRANT_SCOPE_MEMORY = 2). Move's `grant::issue`
    // would replace the pet's slot wholesale, leaving them with `[memory]`
    // only and silently dropping `[assets]`. The new filter must treat any
    // existing-grant grantee as already-served and skip them.
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: 'Pet', walletBindings: [{ address: '0xpetagent' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xpetagent' },
    ])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 2, // memory
      currentCapacity: 1,
      activeGrantCount: 1,
    })
    expect(plan.targets).toEqual([])
    // No fanout → capacity stays as-is.
    expect(plan.requiredCapacity).toBe(1)
  })

  it('does not lower currentCapacity below its existing value', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: null, walletBindings: [{ address: '0xagent1' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 8,
      currentCapacity: 100,
      activeGrantCount: 0,
    })
    expect(plan.targets).toHaveLength(1)
    expect(plan.requiredCapacity).toBe(100)
  })

  it('returns empty plan for non-single-bit scopeMask', async () => {
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 0,
      currentCapacity: 1,
      activeGrantCount: 0,
    })
    expect(plan.targets).toEqual([])
    expect(mockedPrisma.member.findMany).not.toHaveBeenCalled()
  })

  it('rejects multi-bit scopeMask (e.g. seal|assets) before reading agents', async () => {
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 9, // seal | assets
      currentCapacity: 1,
      activeGrantCount: 0,
    })
    expect(plan.targets).toEqual([])
    expect(mockedPrisma.member.findMany).not.toHaveBeenCalled()
  })

  it('clamps to MAX_GRANT_CAPACITY when target count would overflow', async () => {
    const agents = Array.from({ length: 12 }, (_, i) => ({
      id: `agent-${i}`,
      displayName: null,
      walletBindings: [{ address: `0xagent${i}` }],
    }))
    mockedPrisma.member.findMany.mockResolvedValue(agents)
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])

    const { computeAutoGrantTargets, MAX_GRANT_CAPACITY } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    // Pretend the soul is one slot below the ceiling so adding 12 agents would
    // push past MAX_GRANT_CAPACITY; ensure we cap at the ceiling.
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: 8,
      currentCapacity: MAX_GRANT_CAPACITY - 5,
      activeGrantCount: MAX_GRANT_CAPACITY - 5,
    })
    // Only 5 slots left before MAX_GRANT_CAPACITY
    expect(plan.targets).toHaveLength(5)
    expect(plan.requiredCapacity).toBe(MAX_GRANT_CAPACITY)
  })
})
