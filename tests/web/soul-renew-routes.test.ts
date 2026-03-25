import { beforeEach, describe, expect, it, vi } from 'vitest'

const BUYER_ADDRESS = `0x${'b'.repeat(64)}`
const PRIMARY_BOUND_ADDRESS = `0x${'c'.repeat(64)}`
const SERIES_ID = `0x${'1'.repeat(64)}`
const PASS_ID = `0x${'2'.repeat(64)}`
const PLAN_ID = `0x${'4'.repeat(64)}`
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const VALID_TX_DIGEST = '11111111111111111111111111111111'

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any vi.mock() calls
// ---------------------------------------------------------------------------

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransaction = vi.hoisted(() => vi.fn())
const mockedAssertPassChange = vi.hoisted(() => vi.fn())
const mockedGetVerifiedPassState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulRenewIntents = vi.hoisted(() => vi.fn())
const mockedGetVerifiedPricingPlanState = vi.hoisted(() => vi.fn())
const mockedDbRenewPass = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@web/lib/auth/identity', () => ({ requireIdentity: mockedRequireIdentity }))
vi.mock('@web/lib/auth/sui-wallet', () => ({ getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/rate-limit', () => ({ takeRateLimitToken: () => ({ limited: false }) }))
vi.mock('@web/lib/souls/config', () => ({ getRequiredPublicEnv: () => PACKAGE_ID }))
vi.mock('@web/lib/souls/post-tx-db', () => ({ dbRenewPass: mockedDbRenewPass }))
vi.mock('@web/lib/souls/request-validation', () => ({
  parseRequiredObjectId: (v: unknown) => (typeof v === 'string' && v.startsWith('0x') ? v : null),
  parseRequiredTxDigest: (v: unknown) => (typeof v === 'string' && v.length >= 10 ? v : null),
}))
vi.mock('@web/lib/souls/route-safety', () => ({
  getClientSafeOnChainVerificationErrorMessage: (e: Error) => e.message,
  toSafeErrorDetails: (e: unknown) => e,
}))
vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))
vi.mock('@web/lib/souls/on-chain-verification', () => ({
  assertPassChange: mockedAssertPassChange,
  getSuccessfulTransaction: mockedGetSuccessfulTransaction,
  getVerifiedPassState: mockedGetVerifiedPassState,
  getVerifiedPricingPlanState: mockedGetVerifiedPricingPlanState,
  getVerifiedSoulRenewIntents: mockedGetVerifiedSoulRenewIntents,
  OnChainVerificationError: class extends Error {
    status: number
    constructor(msg: string, status = 422) {
      super(msg)
      this.status = status
    }
  },
  sameSuiValue: (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaultPassState(overrides: Record<string, unknown> = {}) {
  return {
    objectId: PASS_ID,
    passType: 'subscription',
    seriesId: SERIES_ID,
    ownerAddress: BUYER_ADDRESS,
    lockedReleaseId: null,
    expiresAt: new Date('2026-04-25T00:00:00.000Z'),
    agentGrant: null,
    ...overrides,
  }
}

function buildDefaultRenewIntent(overrides: Record<string, unknown> = {}) {
  return {
    planId: PLAN_ID,
    seriesId: SERIES_ID,
    passId: PASS_ID,
    ...overrides,
  }
}

function buildDefaultPricingPlanState(overrides: Record<string, unknown> = {}) {
  return {
    objectId: PLAN_ID,
    seriesId: SERIES_ID,
    planType: 'subscription',
    priceUsdc: 1000000n,
    periodMs: 2592000000n,
    active: true,
    ...overrides,
  }
}

async function callPost(body: Record<string, unknown>, seriesRouteId = SERIES_ID) {
  const { POST } = await import('../../web/app/api/souls/[id]/renew/route.ts')
  const request = new Request(`http://localhost/api/souls/${seriesRouteId}/renew`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return POST(request as any, { params: Promise.resolve({ id: seriesRouteId }) })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Soul renew route (human)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID = PACKAGE_ID

    // Default happy-path setup
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { kind: 'human', memberId: 'member-1' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([BUYER_ADDRESS])
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({ onChainId: SERIES_ID })
    mockedGetSuccessfulTransaction.mockResolvedValue({ digest: VALID_TX_DIGEST })
    mockedAssertPassChange.mockReturnValue(undefined)
    mockedGetVerifiedPassState.mockResolvedValue(buildDefaultPassState())
    mockedGetVerifiedSoulRenewIntents.mockReturnValue([buildDefaultRenewIntent()])
    mockedGetVerifiedPricingPlanState.mockResolvedValue(buildDefaultPricingPlanState())
    mockedDbRenewPass.mockResolvedValue(undefined)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
    mockedPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => fn(mockedPrisma),
    )
  })

  // -------------------------------------------------------------------------
  // Authentication / identity guard
  // -------------------------------------------------------------------------

  it('rejects agent identities with 403', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { kind: 'agent', memberId: 'agent-1' },
    })

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Use the agent renew API' })
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
  })

  it('propagates requireIdentity error responses when auth fails', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockedRequireIdentity.mockResolvedValue({ error: errorResponse, identity: null })

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(401)
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Request validation
  // -------------------------------------------------------------------------

  it('rejects missing passOnChainId with 400', async () => {
    const response = await callPost({ txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('passOnChainId'),
    })
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
  })

  it('rejects missing txDigest with 400', async () => {
    const response = await callPost({ passOnChainId: PASS_ID })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('txDigest'),
    })
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON body with 400', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/renew/route.ts')
    const request = new Request(`http://localhost/api/souls/${SERIES_ID}/renew`, {
      method: 'POST',
      body: '{not-valid-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await POST(request as any, { params: Promise.resolve({ id: SERIES_ID }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON' })
  })

  it('rejects a series route id that exceeds the maximum length', async () => {
    const longId = 'x'.repeat(129)
    const { POST } = await import('../../web/app/api/souls/[id]/renew/route.ts')
    const request = new Request(`http://localhost/api/souls/${longId}/renew`, {
      method: 'POST',
      body: JSON.stringify({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST }),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await POST(request as any, { params: Promise.resolve({ id: longId }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('too long') })
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Idempotency / TX sync cache
  // -------------------------------------------------------------------------

  it('returns cached result for a duplicate txDigest without re-verifying on-chain', async () => {
    const cachedBody = {
      onChainId: PASS_ID,
      passType: 'subscription',
      expiresAt: '2026-04-25T00:00:00.000Z',
    }
    mockedGetStoredSoulTxSync.mockResolvedValue({ statusCode: 200, body: cachedBody })

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(cachedBody)
    expect(mockedGetStoredSoulTxSync).toHaveBeenCalledWith({
      txDigest: VALID_TX_DIGEST,
      routeKey: 'renew',
      actorKey: 'member-1',
      resourceKey: PASS_ID,
    })
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Soul series lookup
  // -------------------------------------------------------------------------

  it('returns 404 when the Soul series is not found in the database', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue(null)

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Soul not found' })
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Wallet binding guard
  // -------------------------------------------------------------------------

  it('returns 400 when no Sui wallet is bound to the authenticated member', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([])

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'No Sui wallet bound to account' })
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // On-chain pass type validation
  // -------------------------------------------------------------------------

  it('returns 422 when the verified pass is perpetual rather than subscription', async () => {
    mockedGetVerifiedPassState.mockResolvedValue(
      buildDefaultPassState({ passType: 'perpetual', expiresAt: null }),
    )

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Only subscription passes can be renewed',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 when the verified pass does not belong to the requested Soul series', async () => {
    const differentSeriesId = `0x${'f'.repeat(64)}`
    mockedGetVerifiedPassState.mockResolvedValue(
      buildDefaultPassState({ seriesId: differentSeriesId }),
    )

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Renewed pass does not belong to the requested Soul',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 when the verified pass owner does not match any bound wallet', async () => {
    const unrelatedAddress = `0x${'e'.repeat(64)}`
    mockedGetVerifiedPassState.mockResolvedValue(
      buildDefaultPassState({ ownerAddress: unrelatedAddress }),
    )

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Renewed pass owner does not match the authenticated wallet',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Renew intent validation
  // -------------------------------------------------------------------------

  it('returns 422 when no matching renew intent is found in the transaction', async () => {
    mockedGetVerifiedSoulRenewIntents.mockReturnValue([])

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('matching Soul renewal'),
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 when the renew intent series does not match the requested series', async () => {
    const otherSeriesId = `0x${'a'.repeat(64)}`
    mockedGetVerifiedSoulRenewIntents.mockReturnValue([
      buildDefaultRenewIntent({ seriesId: otherSeriesId }),
    ])

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('matching Soul renewal'),
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 when the renew intent pass id does not match the requested pass', async () => {
    const otherPassId = `0x${'d'.repeat(64)}`
    mockedGetVerifiedSoulRenewIntents.mockReturnValue([
      buildDefaultRenewIntent({ passId: otherPassId }),
    ])

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('matching Soul renewal'),
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Pricing plan validation
  // -------------------------------------------------------------------------

  it('returns 422 when the verified pricing plan belongs to a different series', async () => {
    const otherSeriesId = `0x${'7'.repeat(64)}`
    mockedGetVerifiedPricingPlanState.mockResolvedValue(
      buildDefaultPricingPlanState({ seriesId: otherSeriesId }),
    )

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('renewal pricing plan'),
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 when the verified pricing plan type is not subscription', async () => {
    mockedGetVerifiedPricingPlanState.mockResolvedValue(
      buildDefaultPricingPlanState({ planType: 'onetime' }),
    )

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('renewal pricing plan'),
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('surfaces OnChainVerificationError messages with the error status code', async () => {
    const { OnChainVerificationError } = await import('@web/lib/souls/on-chain-verification')
    mockedGetSuccessfulTransaction.mockRejectedValue(
      new OnChainVerificationError('Transaction not found on chain', 404),
    )

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Transaction not found on chain' })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 500 with generic message for unexpected errors and logs them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedGetSuccessfulTransaction.mockRejectedValue(new Error('RPC node overloaded'))

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Sync failed' })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns 500 and does not corrupt state when the DB transaction fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrisma.$transaction.mockRejectedValue(new Error('DB connection lost'))

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Sync failed' })
    consoleError.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with subscription pass data on successful renewal', async () => {
    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      onChainId: PASS_ID,
      passType: 'subscription',
      expiresAt: '2026-04-25T00:00:00.000Z',
    })
  })

  it('persists the renewal via dbRenewPass with the on-chain expiry date', async () => {
    await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(mockedDbRenewPass).toHaveBeenCalledWith({
      db: mockedPrisma,
      passOnChainId: PASS_ID,
      newExpiresAt: new Date('2026-04-25T00:00:00.000Z'),
      renewTxDigest: VALID_TX_DIGEST,
    })
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('stores the tx sync record so duplicate calls return the cached response', async () => {
    await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith({
      db: mockedPrisma,
      txDigest: VALID_TX_DIGEST,
      routeKey: 'renew',
      actorKey: 'member-1',
      resourceKey: PASS_ID,
      statusCode: 200,
      body: {
        onChainId: PASS_ID,
        passType: 'subscription',
        expiresAt: new Date('2026-04-25T00:00:00.000Z'),
      },
    })
  })

  it('calls assertPassChange with mutated change type to verify the pass was renewed not created', async () => {
    await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(mockedAssertPassChange).toHaveBeenCalledWith(
      { digest: VALID_TX_DIGEST },
      expect.objectContaining({
        passOnChainId: PASS_ID,
        changeTypes: ['mutated'],
        expectedSender: [BUYER_ADDRESS],
        expectedPackageId: PACKAGE_ID,
      }),
    )
  })

  it('accepts renewal when the pass was purchased using a non-primary bound wallet', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([PRIMARY_BOUND_ADDRESS, BUYER_ADDRESS])

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(200)
    expect(mockedAssertPassChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedSender: [PRIMARY_BOUND_ADDRESS, BUYER_ADDRESS] }),
    )
    expect(mockedDbRenewPass).toHaveBeenCalled()
  })

  it('resolves series by DB primary key uuid when id is a uuid', async () => {
    const uuidId = '550e8400-e29b-41d4-a716-446655440000'
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({ onChainId: SERIES_ID })

    const { POST } = await import('../../web/app/api/souls/[id]/renew/route.ts')
    const request = new Request(`http://localhost/api/souls/${uuidId}/renew`, {
      method: 'POST',
      body: JSON.stringify({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST }),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await POST(request as any, { params: Promise.resolve({ id: uuidId }) })

    expect(response.status).toBe(200)
    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: uuidId } }),
    )
  })

  it('resolves series by on-chain id when id looks like a Sui address', async () => {
    await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { onChainId: SERIES_ID } }),
    )
  })

  it('picks the matching renew intent among multiple intents in the same transaction', async () => {
    const otherPassId = `0x${'d'.repeat(64)}`
    mockedGetVerifiedSoulRenewIntents.mockReturnValue([
      buildDefaultRenewIntent({ passId: otherPassId }),
      buildDefaultRenewIntent({ passId: PASS_ID }),
    ])

    const response = await callPost({ passOnChainId: PASS_ID, txDigest: VALID_TX_DIGEST })

    expect(response.status).toBe(200)
    expect(mockedGetVerifiedPricingPlanState).toHaveBeenCalledWith(PLAN_ID, PACKAGE_ID)
  })
})
