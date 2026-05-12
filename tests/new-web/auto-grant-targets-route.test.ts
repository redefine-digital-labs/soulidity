import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ROUTE_ID = `0x${'a'.repeat(64)}`
const SOUL_ON_CHAIN_ID = `0x${'a'.repeat(64)}`
const STATE_ON_CHAIN_ID = `0x${'b'.repeat(64)}`
const HUMAN_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = 'account-1'

const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedComputeAutoGrantTargets = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@/lib/soulidity/auto-grant', () => ({
  computeAutoGrantTargets: mockedComputeAutoGrantTargets,
}))

function jsonRequest(scopeMask: string | null) {
  const url = scopeMask == null
    ? `http://localhost/api/souls/${SOUL_ROUTE_ID}/auto-grant-targets`
    : `http://localhost/api/souls/${SOUL_ROUTE_ID}/auto-grant-targets?scopeMask=${scopeMask}`
  return new Request(url)
}

describe('GET /api/souls/[id]/auto-grant-targets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when no human wallet identity', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })
    const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
    const response = await GET(jsonRequest('8'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })
    expect(response.status).toBe(401)
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('returns 400 when scopeMask is missing or invalid', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
    expect((await GET(jsonRequest(null), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })).status).toBe(400)
    // multi-bit
    expect((await GET(jsonRequest('9'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })).status).toBe(400)
    // out of range
    expect((await GET(jsonRequest('16'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })).status).toBe(400)
    // zero / negative
    expect((await GET(jsonRequest('0'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })).status).toBe(400)
    expect((await GET(jsonRequest('-1'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })).status).toBe(400)
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('returns 404 when soul does not exist', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue(null)
    const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
    const response = await GET(jsonRequest('8'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })
    expect(response.status).toBe(404)
  })

  it('returns 403 when caller is not the Soul owner', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      onChainId: SOUL_ON_CHAIN_ID,
      stateOnChainId: STATE_ON_CHAIN_ID,
      currentOwnerMemberId: 'someone-else',
      grantCapacity: 1,
      activeGrantCount: 0,
    })
    const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
    const response = await GET(jsonRequest('8'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })
    expect(response.status).toBe(403)
    expect(mockedComputeAutoGrantTargets).not.toHaveBeenCalled()
  })

  it('returns 200 with targets, capacities, and requiredCapacity for the owner', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      onChainId: SOUL_ON_CHAIN_ID,
      stateOnChainId: STATE_ON_CHAIN_ID,
      currentOwnerMemberId: HUMAN_MEMBER_ID,
      grantCapacity: 1,
      activeGrantCount: 0,
    })
    mockedComputeAutoGrantTargets.mockResolvedValue({
      targets: [
        { memberId: 'agent-1', address: '0xagent1', displayName: 'Echo' },
        { memberId: 'agent-2', address: '0xagent2', displayName: null },
      ],
      currentCapacity: 1,
      activeGrantCount: 0,
      requiredCapacity: 2,
    })
    const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
    const response = await GET(jsonRequest('8'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      soulOnChainId: SOUL_ON_CHAIN_ID,
      stateOnChainId: STATE_ON_CHAIN_ID,
      scopeMask: 8,
      targets: [
        { memberId: 'agent-1', address: '0xagent1', displayName: 'Echo' },
        { memberId: 'agent-2', address: '0xagent2', displayName: null },
      ],
      currentCapacity: 1,
      activeGrantCount: 0,
      requiredCapacity: 2,
    })
    expect(mockedComputeAutoGrantTargets).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      soulOnChainId: SOUL_ON_CHAIN_ID,
      stateOnChainId: STATE_ON_CHAIN_ID,
      scopeMask: 8,
      currentCapacity: 1,
      activeGrantCount: 0,
    })
  })

  // ── R-002: fail closed on chain-fallback RPC error ────────────────
  it('returns 502 when computeAutoGrantTargets throws (chain-fallback fail-closed)', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      onChainId: SOUL_ON_CHAIN_ID,
      stateOnChainId: STATE_ON_CHAIN_ID,
      currentOwnerMemberId: HUMAN_MEMBER_ID,
      grantCapacity: 1,
      activeGrantCount: 0,
    })
    // Auto-grant planner propagates RPC errors so the route can fail
    // closed — returning a single-bit `desiredScopeMask` here would let
    // the caller's `grant::issue_to_grantee` narrow chain-only grants.
    mockedComputeAutoGrantTargets.mockRejectedValue(new Error('rpc down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
      const response = await GET(jsonRequest('8'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })
      expect(response.status).toBe(502)
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('returns 200 with empty targets when no agents need grants', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' },
      walletAddresses: ['0xowner'],
    })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      onChainId: SOUL_ON_CHAIN_ID,
      stateOnChainId: STATE_ON_CHAIN_ID,
      currentOwnerMemberId: HUMAN_MEMBER_ID,
      grantCapacity: 5,
      activeGrantCount: 2,
    })
    mockedComputeAutoGrantTargets.mockResolvedValue({
      targets: [],
      currentCapacity: 5,
      activeGrantCount: 2,
      requiredCapacity: 5,
    })
    const { GET } = await import('../../web/app/api/souls/[id]/auto-grant-targets/route')
    const response = await GET(jsonRequest('1'), { params: Promise.resolve({ id: SOUL_ROUTE_ID }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.targets).toEqual([])
    expect(body.scopeMask).toBe(1)
  })
})
