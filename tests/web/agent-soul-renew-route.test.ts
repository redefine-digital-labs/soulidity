import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ADDRESS = `0x${'a'.repeat(64)}`
const SERIES_ID = `0x${'1'.repeat(64)}`
const PASS_ID = `0x${'2'.repeat(64)}`
const PLAN_ID = `0x${'3'.repeat(64)}`
const PACKAGE_ID = `0x${'9'.repeat(64)}`

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  soulPassSnapshot: { findFirst: vi.fn() },
}))
const mockedSuiClient = vi.hoisted(() => ({
  getCoins: vi.fn(),
}))
const mockedGetVerifiedPricingPlanState = vi.hoisted(() => vi.fn())
const mockedSelectCoinObjectIdsForAmountAcrossPages = vi.hoisted(() => vi.fn())
const mockedBuildRenewSubscriptionTx = vi.hoisted(() => vi.fn())
const mockedCreatePreparedSoulPurchase = vi.hoisted(() => vi.fn())
const mockedGetRequiredPublicEnv = vi.hoisted(() => vi.fn())
const mockedTx = vi.hoisted(() => ({
  setSender: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  getVerifiedPricingPlanState: mockedGetVerifiedPricingPlanState,
  OnChainVerificationError: class OnChainVerificationError extends Error {
    status: number
    constructor(message: string, status = 422) {
      super(message)
      this.name = 'OnChainVerificationError'
      this.status = status
    }
  },
  sameSuiValue: (a: unknown, b: unknown) =>
    typeof a === 'string' && typeof b === 'string'
      ? a.toLowerCase() === b.toLowerCase()
      : false,
}))

vi.mock('@web/lib/souls/coin-selection', () => ({
  selectCoinObjectIdsForAmountAcrossPages: mockedSelectCoinObjectIdsForAmountAcrossPages,
}))

vi.mock('@web/lib/souls/tx-builder', () => ({
  buildRenewSubscriptionTx: mockedBuildRenewSubscriptionTx,
}))

vi.mock('@web/lib/souls/prepared-purchase', () => ({
  createPreparedSoulPurchase: mockedCreatePreparedSoulPurchase,
}))

vi.mock('@web/lib/souls/config', () => ({
  getRequiredPublicEnv: mockedGetRequiredPublicEnv,
  MissingPublicEnvError: class MissingPublicEnvError extends Error {
    envName: string
    constructor(envName: string) {
      super('Service temporarily unavailable')
      this.name = 'MissingPublicEnvError'
      this.envName = envName
    }
  },
}))

vi.mock('@web/lib/souls/request-validation', () => ({
  parseRequiredObjectId: (v: unknown) =>
    typeof v === 'string' && v.startsWith('0x') ? v : null,
}))

vi.mock('@web/lib/souls/route-safety', () => ({
  getClientSafeOnChainVerificationErrorMessage: (e: { message: string }) => e.message,
  toSafeErrorDetails: (e: unknown) => String(e),
}))

vi.mock('@web/lib/is-uuid', () => ({
  isUuid: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
}))

function makeRequest(body: unknown = { passOnChainId: PASS_ID }) {
  return new Request(`http://localhost/api/agent/souls/${SERIES_ID}/renew`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
  })
}

describe('agent soul renew prepare route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-1' },
      response: null,
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AGENT_ADDRESS)
    mockedGetRequiredPublicEnv.mockImplementation((name: string) => {
      if (name === 'NEXT_PUBLIC_PLATFORM_CONFIG_ID') return '0xplatform'
      if (name === 'NEXT_PUBLIC_SOUL_PACKAGE_ID') return PACKAGE_ID
      if (name === 'NEXT_PUBLIC_USDC_COIN_TYPE') return '0xusdc::coin::USDC'
      throw new Error(`Missing env: ${name}`)
    })
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: SERIES_ID,
      status: 'active',
      subPlanOnChainId: PLAN_ID,
    })
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue({
      id: 'pass-db-1',
      onChainId: PASS_ID,
      seriesId: 'series-db-1',
      passType: 'subscription',
      status: 'active',
      ownerAddress: AGENT_ADDRESS,
      agentGrant: null,
    })
    mockedGetVerifiedPricingPlanState.mockResolvedValue({
      seriesId: SERIES_ID,
      planType: 'subscription',
      priceUsdc: 1_000_000n,
      active: true,
    })
    mockedSelectCoinObjectIdsForAmountAcrossPages.mockResolvedValue(['coin-a', 'coin-b'])
    mockedTx.build.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mockedBuildRenewSubscriptionTx.mockReturnValue(mockedTx)
    mockedCreatePreparedSoulPurchase.mockResolvedValue({
      id: 'prepared-renew-1',
      expiresAt: new Date('2099-03-22T00:05:00.000Z'),
    })
  })

  it('returns 401 without API key', async () => {
    mockedRequireAgentApiKey.mockResolvedValue({
      agent: null,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const request = new Request(`http://localhost/api/agent/souls/${SERIES_ID}/renew`, {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
    })
    const response = await POST(request as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid JSON' })
  })

  it('returns 400 for missing passOnChainId', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest({ passOnChainId: '' }) as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('passOnChainId'),
    })
  })

  it('returns 404 for missing series', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Series'),
    })
  })

  it('returns 404 for inactive series', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: SERIES_ID,
      status: 'inactive',
      subPlanOnChainId: PLAN_ID,
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Series'),
    })
  })

  it('returns 404 for pass not found', async () => {
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('pass'),
    })
  })

  it('returns 403 for agent without wallet', async () => {
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('wallet'),
    })
  })

  it('returns 403 for agent without access to the pass', async () => {
    const OTHER_ADDRESS = `0x${'b'.repeat(64)}`
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue({
      id: 'pass-db-1',
      onChainId: PASS_ID,
      seriesId: 'series-db-1',
      passType: 'subscription',
      status: 'active',
      ownerAddress: OTHER_ADDRESS,
      agentGrant: null,
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('access'),
    })
  })

  it('returns 404 for missing sub pricing plan', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: SERIES_ID,
      status: 'active',
      subPlanOnChainId: null,
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('subscription pricing plan'),
    })
  })

  it('returns 402 when agent has insufficient USDC to cover the renewal', async () => {
    mockedSelectCoinObjectIdsForAmountAcrossPages.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('enough USDC'),
    })
    expect(mockedBuildRenewSubscriptionTx).not.toHaveBeenCalled()
  })

  it('returns 402 when agent has zero USDC coins', async () => {
    mockedSelectCoinObjectIdsForAmountAcrossPages.mockResolvedValue([])

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('USDC'),
    })
    expect(mockedBuildRenewSubscriptionTx).not.toHaveBeenCalled()
  })

  it('happy path returns preparedPurchaseId, txBytes and context', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/route.ts')
    const response = await POST(makeRequest() as any, {
      params: Promise.resolve({ id: SERIES_ID }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      preparedPurchaseId: 'prepared-renew-1',
      txBytes: Buffer.from([1, 2, 3]).toString('base64'),
      context: {
        planOnChainId: PLAN_ID,
        planType: 'subscription',
        seriesOnChainId: SERIES_ID,
        releaseOnChainId: null,
        passOnChainId: PASS_ID,
        amount: '1000000',
        agentAddress: AGENT_ADDRESS,
        expiresAt: '2099-03-22T00:05:00.000Z',
      },
    })
    expect(mockedBuildRenewSubscriptionTx).toHaveBeenCalledWith({
      platformConfigId: '0xplatform',
      planId: PLAN_ID,
      seriesId: SERIES_ID,
      passId: PASS_ID,
      paymentCoinIds: ['coin-a', 'coin-b'],
      amount: 1_000_000n,
    })
    expect(mockedCreatePreparedSoulPurchase).toHaveBeenCalledWith({
      agentMemberId: 'agent-1',
      agentAddress: AGENT_ADDRESS,
      amountUsdc: 1_000_000n,
      txBytesBase64: Buffer.from([1, 2, 3]).toString('base64'),
      planOnChainId: PLAN_ID,
      planType: 'subscription',
      releaseOnChainId: null,
      passOnChainId: PASS_ID,
      seriesOnChainId: SERIES_ID,
    })
  })
})
