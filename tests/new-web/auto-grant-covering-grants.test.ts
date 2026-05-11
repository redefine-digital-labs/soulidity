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

const SCOPE_SEAL = 1
const SCOPE_MEMORY = 2
const SCOPE_SKILLS = 4
const SCOPE_ASSETS = 8

describe('getActiveGrantScopeByGrantee', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty Map when granteeAddresses is empty', async () => {
    const { getActiveGrantScopeByGrantee } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const result = await getActiveGrantScopeByGrantee({
      soulOnChainId: SOUL_ID,
      granteeAddresses: [],
    })
    expect(result.size).toBe(0)
    expect(mockedPrisma.soulGrantRecord.findMany).not.toHaveBeenCalled()
  })

  it('returns existing scope masks per grantee from active grants', async () => {
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xagent1', scopes: ['seal', 'skills'] },
      { granteeAddress: '0xagent3', scopes: ['memory'] },
    ])
    const now = new Date('2026-05-10T00:00:00.000Z')
    const { getActiveGrantScopeByGrantee } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const result = await getActiveGrantScopeByGrantee({
      soulOnChainId: SOUL_ID,
      granteeAddresses: ['0xagent1', '0xagent2', '0xagent3'],
      now,
    })
    expect(result.get('0xagent1')).toBe(SCOPE_SEAL | SCOPE_SKILLS)
    expect(result.get('0xagent2')).toBeUndefined()
    expect(result.get('0xagent3')).toBe(SCOPE_MEMORY)
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
      select: { granteeAddress: true, scopes: true },
    })
  })

  it('merges multiple rows for the same grantee defensively', async () => {
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xagent1', scopes: ['seal'] },
      { granteeAddress: '0xagent1', scopes: ['assets'] },
    ])
    const { getActiveGrantScopeByGrantee } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const result = await getActiveGrantScopeByGrantee({
      soulOnChainId: SOUL_ID,
      granteeAddresses: ['0xagent1'],
    })
    expect(result.get('0xagent1')).toBe(SCOPE_SEAL | SCOPE_ASSETS)
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
      scopeMask: SCOPE_ASSETS,
      currentCapacity: 1,
      activeGrantCount: 0,
    })
    expect(plan.targets).toEqual([])
    expect(plan.requiredCapacity).toBe(1)
  })

  it('new grantees get desiredScopeMask == kindScope and consume slots', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: null, walletBindings: [{ address: '0xagent1' }] },
      { id: 'agent-2', displayName: null, walletBindings: [{ address: '0xagent2' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: SCOPE_ASSETS,
      currentCapacity: 1,
      activeGrantCount: 0,
    })
    expect(plan.targets).toHaveLength(2)
    expect(plan.targets.every((t) => t.desiredScopeMask === SCOPE_ASSETS)).toBe(true)
    expect(plan.targets.every((t) => t.isNewGrantee)).toBe(true)
    // 0 existing + 2 new grantees → capacity must be >= 2
    expect(plan.requiredCapacity).toBe(2)
  })

  it('expands an agent with a different existing scope to a merged superset mask (regression for sprite upload not granting assets)', async () => {
    // Agent already holds [seal, skills] on this Soul (e.g. issued
    // during a prior memory/skill upload). Owner now uploads a sprite
    // (kindScopeMask = SOUL_GRANT_SCOPE_ASSETS = 8). The new auto-grant
    // path must issue with the MERGED mask (seal|skills|assets = 13)
    // so the on-chain `grant::issue` supersede expands the agent's
    // scope rather than narrowing it down to just [assets].
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: 'Agent', walletBindings: [{ address: '0xagent1' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xagent1', scopes: ['seal', 'skills'] },
    ])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: SCOPE_ASSETS,
      currentCapacity: 1,
      activeGrantCount: 1,
    })
    expect(plan.targets).toHaveLength(1)
    expect(plan.targets[0]?.address).toBe('0xagent1')
    expect(plan.targets[0]?.desiredScopeMask).toBe(SCOPE_SEAL | SCOPE_SKILLS | SCOPE_ASSETS)
    expect(plan.targets[0]?.isNewGrantee).toBe(false)
    // Existing grantee → no new slot consumed → required capacity stays at activeGrantCount.
    expect(plan.requiredCapacity).toBe(1)
  })

  it('skips an agent whose existing scope already covers the kind scope', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'agent-1', displayName: null, walletBindings: [{ address: '0xagent1' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      // Agent already has assets — re-issuing the same kind would be a no-op.
      { granteeAddress: '0xagent1', scopes: ['seal', 'assets'] },
    ])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: SCOPE_ASSETS,
      currentCapacity: 1,
      activeGrantCount: 1,
    })
    expect(plan.targets).toEqual([])
    expect(plan.requiredCapacity).toBe(1)
  })

  it('mixes new and existing grantees and bumps capacity only for new ones', async () => {
    mockedPrisma.member.findMany.mockResolvedValue([
      { id: 'a-new', displayName: null, walletBindings: [{ address: '0xnew' }] },
      { id: 'a-existing', displayName: null, walletBindings: [{ address: '0xexisting' }] },
    ])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([
      { granteeAddress: '0xexisting', scopes: ['seal'] },
    ])
    const { computeAutoGrantTargets } = await import(
      '../../web/lib/soulidity/auto-grant'
    )
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: SCOPE_MEMORY,
      currentCapacity: 1,
      activeGrantCount: 1,
    })
    expect(plan.targets.map((t) => ({
      address: t.address,
      desiredScopeMask: t.desiredScopeMask,
      isNewGrantee: t.isNewGrantee,
    }))).toEqual([
      { address: '0xnew', desiredScopeMask: SCOPE_MEMORY, isNewGrantee: true },
      { address: '0xexisting', desiredScopeMask: SCOPE_SEAL | SCOPE_MEMORY, isNewGrantee: false },
    ])
    // activeGrantCount=1 + 1 new grantee = 2; existing grantee does NOT
    // add to the capacity requirement because the supersede reuses its slot.
    expect(plan.requiredCapacity).toBe(2)
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
      scopeMask: SCOPE_ASSETS,
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
      scopeMask: SCOPE_SEAL | SCOPE_ASSETS,
      currentCapacity: 1,
      activeGrantCount: 0,
    })
    expect(plan.targets).toEqual([])
    expect(mockedPrisma.member.findMany).not.toHaveBeenCalled()
  })

  it('clamps NEW-grantee count to MAX_GRANT_CAPACITY while preserving existing-grantee supersedes', async () => {
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
    const plan = await computeAutoGrantTargets({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ID,
      scopeMask: SCOPE_ASSETS,
      currentCapacity: MAX_GRANT_CAPACITY - 5,
      activeGrantCount: MAX_GRANT_CAPACITY - 5,
    })
    // Only 5 NEW-grantee slots left before MAX_GRANT_CAPACITY
    expect(plan.targets).toHaveLength(5)
    expect(plan.requiredCapacity).toBe(MAX_GRANT_CAPACITY)
  })
})
