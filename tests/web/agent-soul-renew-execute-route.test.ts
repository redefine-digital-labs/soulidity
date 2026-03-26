import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ADDRESS = `0x${'a'.repeat(64)}`
const SERIES_ID = `0x${'1'.repeat(64)}`
const PASS_ID = `0x${'2'.repeat(64)}`
const RELEASE_ID = `0x${'4'.repeat(64)}`
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const PREPARED_PURCHASE_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = `0x${'3'.repeat(64)}`
const VALID_DIGEST = 'renew-tx-digest-00000000000000'
const EXPIRES_AT = new Date('2026-05-01T00:00:00.000Z')

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetRequiredPublicEnv = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
const mockedDbRenewPass = vi.hoisted(() => vi.fn())
const mockedGetPreparedSoulPurchaseForExecution = vi.hoisted(() => vi.fn())
const mockedClaimPreparedSoulPurchaseForExecution = vi.hoisted(() => vi.fn())
const mockedFinalizePreparedSoulPurchaseExecution = vi.hoisted(() => vi.fn())
const mockedReleasePreparedSoulPurchaseExecution = vi.hoisted(() => vi.fn())
const mockedHashPreparedSoulPurchaseTxBytes = vi.hoisted(() => vi.fn(() => 'expected-hash'))
const mockedVerifyPreparedTransactionSignature = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  executeTransactionBlock: vi.fn(),
  waitForTransaction: vi.fn(),
}))
const mockedAssertPassChange = vi.hoisted(() => vi.fn())
const mockedEnsureTransactionSucceeded = vi.hoisted(() => vi.fn())
const mockedGetVerifiedPassState = vi.hoisted(() => vi.fn())
const mockedSameSuiValue = vi.hoisted(() => vi.fn())
const mockedOnChainVerificationError = vi.hoisted(() => {
  class OnChainVerificationError extends Error {
    status: number
    constructor(message: string, status = 422) {
      super(message)
      this.name = 'OnChainVerificationError'
      this.status = status
    }
  }
  return OnChainVerificationError
})
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/config', () => ({
  getRequiredPublicEnv: mockedGetRequiredPublicEnv,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbRenewPass: mockedDbRenewPass,
}))

vi.mock('@web/lib/souls/prepared-purchase', () => ({
  claimPreparedSoulPurchaseForExecution: mockedClaimPreparedSoulPurchaseForExecution,
  getPreparedSoulPurchaseForExecution: mockedGetPreparedSoulPurchaseForExecution,
  finalizePreparedSoulPurchaseExecution: mockedFinalizePreparedSoulPurchaseExecution,
  releasePreparedSoulPurchaseExecution: mockedReleasePreparedSoulPurchaseExecution,
  hashPreparedSoulPurchaseTxBytes: mockedHashPreparedSoulPurchaseTxBytes,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/souls/tx-signature', () => ({
  verifyPreparedTransactionSignature: mockedVerifyPreparedTransactionSignature,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  assertPassChange: mockedAssertPassChange,
  ensureTransactionSucceeded: mockedEnsureTransactionSucceeded,
  getVerifiedPassState: mockedGetVerifiedPassState,
  sameSuiValue: mockedSameSuiValue,
  OnChainVerificationError: mockedOnChainVerificationError,
}))

vi.mock('@web/lib/souls/tx-confirmation', () => ({
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
}))

// Default prepared purchase shared across tests
const DEFAULT_PREPARED_PURCHASE = {
  id: PREPARED_PURCHASE_ID,
  seriesOnChainId: SERIES_ID,
  planOnChainId: PLAN_ID,
  planType: 'subscription',
  releaseOnChainId: null,
  passOnChainId: PASS_ID,
  agentAddress: AGENT_ADDRESS,
  amountUsdc: 1_000_000n,
  txBytesBase64: 'dHgtYnl0ZXM=',
  txBytesHash: 'expected-hash',
  executedAt: null,
  resultStatusCode: null,
  resultBody: null,
}

const DEFAULT_CLAIMED_PURCHASE = {
  ...DEFAULT_PREPARED_PURCHASE,
  executedAt: new Date(),
}

const DEFAULT_TX_RESULT = {
  digest: VALID_DIGEST,
  effects: { status: { status: 'success' } },
  objectChanges: [
    {
      type: 'mutated',
      objectType: `${PACKAGE_ID}::pass::SubscriptionPass`,
      objectId: PASS_ID,
    },
  ],
}

const DEFAULT_PASS_STATE = {
  objectId: PASS_ID,
  passType: 'subscription',
  seriesId: SERIES_ID,
  ownerAddress: AGENT_ADDRESS,
  lockedReleaseId: null,
  expiresAt: EXPIRES_AT,
  agentGrant: null,
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request(
    `http://localhost/api/agent/souls/${SERIES_ID}/renew/execute`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        preparedPurchaseId: PREPARED_PURCHASE_ID,
        signature: 'c2ln',
        ...body,
      }),
    },
  ) as any
}

function makeParams(id: string = SERIES_ID) {
  return { params: Promise.resolve({ id }) }
}

describe('agent soul renew execute route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID = PACKAGE_ID

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetRequiredPublicEnv.mockReturnValue(PACKAGE_ID)
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AGENT_ADDRESS)
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({ onChainId: SERIES_ID })
    mockedPrisma.$transaction.mockImplementation(
      async (callback: (tx: Record<string, never>) => Promise<unknown>) => callback({}),
    )
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValue(DEFAULT_PREPARED_PURCHASE)
    mockedClaimPreparedSoulPurchaseForExecution.mockResolvedValue(DEFAULT_CLAIMED_PURCHASE)
    mockedHashPreparedSoulPurchaseTxBytes.mockReturnValue('expected-hash')
    mockedVerifyPreparedTransactionSignature.mockResolvedValue(undefined)
    mockedSuiClient.executeTransactionBlock.mockResolvedValue(DEFAULT_TX_RESULT)
    mockedSuiClient.waitForTransaction.mockResolvedValue(undefined)
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedEnsureTransactionSucceeded.mockReturnValue(undefined)
    mockedAssertPassChange.mockReturnValue(undefined)
    mockedGetVerifiedPassState.mockResolvedValue(DEFAULT_PASS_STATE)
    // sameSuiValue: match when values are equal strings
    mockedSameSuiValue.mockImplementation((a: unknown, b: unknown) => a === b)
    mockedDbRenewPass.mockResolvedValue(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValue(undefined)
    mockedReleasePreparedSoulPurchaseExecution.mockResolvedValue(undefined)
  })

  // --- Auth ---

  it('returns 401 without API key', async () => {
    mockedRequireAgentApiKey.mockResolvedValueOnce({
      agent: null,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(401)
  })

  // --- Input validation ---

  it('returns 400 for missing preparedPurchaseId', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/renew/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signature: 'c2ln' }),
      }) as any,
      makeParams(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'preparedPurchaseId must be a valid UUID',
    })
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns 400 for non-UUID preparedPurchaseId', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(
      makeRequest({ preparedPurchaseId: 'not-a-uuid' }),
      makeParams(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'preparedPurchaseId must be a valid UUID',
    })
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns 400 for missing signature', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/renew/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID }),
      }) as any,
      makeParams(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'signature is required (base64)',
    })
  })

  it('returns 400 for oversized signature', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(
      makeRequest({ signature: 's'.repeat(1025) }),
      makeParams(),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'signature is too large',
    })
    expect(mockedSuiClient.executeTransactionBlock).not.toHaveBeenCalled()
  })

  // --- Series / wallet ---

  it('returns 404 for missing series', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Soul not found' })
  })

  it('returns 400 for agent without wallet', async () => {
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Agent has no Sui wallet binding',
    })
  })

  // --- Prepared purchase ---

  it('returns 404 for expired/missing prepared purchase', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Prepared purchase not found, expired, or no longer matches this Soul',
    })
  })

  it('returns 422 for agent address mismatch', async () => {
    const OTHER_ADDRESS = `0x${'f'.repeat(64)}`
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      agentAddress: OTHER_ADDRESS,
    })
    // sameSuiValue(OTHER_ADDRESS, AGENT_ADDRESS) → false
    mockedSameSuiValue.mockImplementation((a: unknown, b: unknown) => a === b)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Prepared purchase owner does not match the agent wallet',
    })
  })

  it('returns 422 when the prepared record belongs to the purchase execute flow', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      planType: 'onetime',
      releaseOnChainId: RELEASE_ID,
      passOnChainId: null,
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Prepared purchase must be executed via the purchase endpoint',
    })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
    expect(mockedSuiClient.executeTransactionBlock).not.toHaveBeenCalled()
    expect(mockedFinalizePreparedSoulPurchaseExecution).not.toHaveBeenCalled()
  })

  it('returns 409 for already executing', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      executedAt: new Date(),
      resultStatusCode: null,
      resultBody: null,
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Prepared purchase is already being executed',
    })
  })

  // --- Signature verification ---

  it('returns 400 for signature mismatch', async () => {
    mockedVerifyPreparedTransactionSignature.mockRejectedValueOnce(
      new Error('Signature is not valid for the provided address'),
    )

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction signature does not match the prepared agent wallet',
    })
    expect(mockedSuiClient.executeTransactionBlock).not.toHaveBeenCalled()
    expect(mockedReleasePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
    })
  })

  // --- TX execution ---

  it('returns 400 for TX execution failure', async () => {
    mockedSuiClient.executeTransactionBlock.mockRejectedValueOnce(
      new Error('rpc failed: http://internal-node'),
    )

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction execution failed',
    })
    expect(mockedReleasePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
    })
  })

  // --- On-chain verification ---

  it('persists a retryable sync result when TX effects omit the renewed pass object', async () => {
    mockedSuiClient.executeTransactionBlock.mockResolvedValueOnce({
      ...DEFAULT_TX_RESULT,
      objectChanges: [],
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Transaction succeeded on chain, but no Soul subscription pass was mutated',
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'verification_retryable',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedPurchaseId: PREPARED_PURCHASE_ID,
        resultStatusCode: 503,
        resultBody: expect.objectContaining({
          digest: VALID_DIGEST,
          passOnChainId: PASS_ID,
          syncError: 'verification_retryable',
        }),
      }),
    )
  })

  it('returns 422 for pass series mismatch', async () => {
    const OTHER_SERIES = `0x${'e'.repeat(64)}`
    mockedGetVerifiedPassState.mockResolvedValueOnce({
      ...DEFAULT_PASS_STATE,
      seriesId: OTHER_SERIES,
    })
    // sameSuiValue(OTHER_SERIES, SERIES_ID) → false; all others equal
    mockedSameSuiValue.mockImplementation((a: unknown, b: unknown) => a === b)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Renewed pass does not belong to the requested Soul',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 for non-subscription pass', async () => {
    mockedGetVerifiedPassState.mockResolvedValueOnce({
      ...DEFAULT_PASS_STATE,
      passType: 'perpetual',
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Only subscription passes can be renewed',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  it('returns 422 for owner/grant mismatch', async () => {
    const OTHER_ADDRESS = `0x${'f'.repeat(64)}`
    mockedGetVerifiedPassState.mockResolvedValueOnce({
      ...DEFAULT_PASS_STATE,
      ownerAddress: OTHER_ADDRESS,
      agentGrant: null,
    })
    // sameSuiValue: only equal values match — seriesId check passes, owner/grant check fails
    mockedSameSuiValue.mockImplementation((a: unknown, b: unknown) => a === b)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Pass is not owned by or granted to the agent wallet',
    })
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
  })

  // --- Happy path ---

  it('returns 200 with dbRenewPass and expiresAt on success', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      digest: VALID_DIGEST,
      status: 'success',
      passOnChainId: PASS_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbRenewPass).toHaveBeenCalledWith({
      db: expect.any(Object),
      passOnChainId: PASS_ID,
      ownerAddress: AGENT_ADDRESS,
      newExpiresAt: EXPIRES_AT,
      renewTxDigest: VALID_DIGEST,
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      db: expect.any(Object),
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: VALID_DIGEST,
      resultStatusCode: 200,
      resultBody: {
        digest: VALID_DIGEST,
        status: 'success',
        passOnChainId: PASS_ID,
        expiresAt: EXPIRES_AT.toISOString(),
        onChainSuccess: true,
        dbSynced: true,
      },
    })
  })

  it('persists retryable renew verification failures after on-chain success', async () => {
    mockedGetVerifiedPassState.mockRejectedValueOnce(
      new mockedOnChainVerificationError('Transaction renew inputs are unavailable for verification', 503),
    )

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Transaction renew inputs are unavailable for verification',
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'verification_retryable',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedPurchaseId: PREPARED_PURCHASE_ID,
        resultStatusCode: 503,
        resultBody: expect.objectContaining({
          digest: VALID_DIGEST,
          passOnChainId: PASS_ID,
          onChainSuccess: true,
          dbSynced: false,
          syncError: 'verification_retryable',
        }),
        txDigest: VALID_DIGEST,
      }),
    )
  })

  it('submits the server-prepared tx bytes instead of any caller-supplied bytes', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(
      makeRequest({ txBytes: 'Y2xpZW50LXN1cHBsaWVkLWJ5dGVz' }),
      makeParams(),
    )

    expect(response.status).toBe(200)
    expect(mockedSuiClient.executeTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: DEFAULT_CLAIMED_PURCHASE.txBytesBase64,
      signature: 'c2ln',
      options: { showEffects: true, showInput: true, showObjectChanges: true },
    })
    expect(mockedVerifyPreparedTransactionSignature).toHaveBeenCalledWith({
      txBytesBase64: DEFAULT_CLAIMED_PURCHASE.txBytesBase64,
      signature: 'c2ln',
      agentAddress: AGENT_ADDRESS,
    })
  })

  // --- DB sync failure / 207 ---

  it('returns 207 with syncError when DB transaction fails', async () => {
    mockedPrisma.$transaction.mockRejectedValueOnce(new Error('db unavailable'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toMatchObject({
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'db_sync_failed',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedPurchaseId: PREPARED_PURCHASE_ID,
        resultStatusCode: 207,
        resultBody: expect.objectContaining({
          digest: VALID_DIGEST,
          passOnChainId: PASS_ID,
          onChainSuccess: true,
          dbSynced: false,
        }),
        txDigest: VALID_DIGEST,
      }),
    )
  })

  it('returns 200 when 207 retry re-sync succeeds', async () => {
    const prevBody = {
      digest: VALID_DIGEST,
      status: 'success',
      passOnChainId: PASS_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'db_sync_failed',
    }
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      executedAt: new Date(),
      resultStatusCode: 207,
      resultBody: prevBody,
    })
    mockedGetVerifiedPassState.mockResolvedValueOnce(DEFAULT_PASS_STATE)
    mockedDbRenewPass.mockResolvedValueOnce(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbRenewPass).toHaveBeenCalledWith({
      db: expect.any(Object),
      passOnChainId: PASS_ID,
      ownerAddress: AGENT_ADDRESS,
      newExpiresAt: EXPIRES_AT,
      renewTxDigest: VALID_DIGEST,
    })
  })

  it('returns 200 when retrying a stored renew verification outage after chain reads recover', async () => {
    const prevBody = {
      error: 'Transaction renew inputs are unavailable for verification',
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'verification_retryable',
    }
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      executedAt: new Date(),
      resultStatusCode: 503,
      resultBody: prevBody,
    })
    mockedGetVerifiedPassState.mockResolvedValueOnce(DEFAULT_PASS_STATE)
    mockedDbRenewPass.mockResolvedValueOnce(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
    expect(mockedDbRenewPass).toHaveBeenCalledWith({
      db: expect.any(Object),
      passOnChainId: PASS_ID,
      ownerAddress: AGENT_ADDRESS,
      newExpiresAt: EXPIRES_AT,
      renewTxDigest: VALID_DIGEST,
    })
  })

  it('returns 422 when retrying a stored renew verification outage for a different pass context', async () => {
    const prevBody = {
      error: 'Transaction renew inputs are unavailable for verification',
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'verification_retryable',
    }
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      executedAt: new Date(),
      resultStatusCode: 503,
      resultBody: prevBody,
    })
    mockedGetVerifiedPassState.mockResolvedValueOnce({
      ...DEFAULT_PASS_STATE,
      objectId: `0x${'5'.repeat(64)}`,
    })
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Renewed pass does not match the prepared renewal context',
    })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
    expect(mockedDbRenewPass).not.toHaveBeenCalled()
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedPurchaseId: PREPARED_PURCHASE_ID,
        txDigest: VALID_DIGEST,
        resultStatusCode: 422,
        resultBody: {
          error: 'Renewed pass does not match the prepared renewal context',
        },
      }),
    )
  })

  it('returns 207 with previous body when 207 retry re-sync also fails', async () => {
    const prevBody = {
      digest: VALID_DIGEST,
      status: 'success',
      passOnChainId: PASS_ID,
      expiresAt: EXPIRES_AT.toISOString(),
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'db_sync_failed',
    }
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      ...DEFAULT_PREPARED_PURCHASE,
      executedAt: new Date(),
      resultStatusCode: 207,
      resultBody: prevBody,
    })
    mockedPrisma.$transaction.mockRejectedValueOnce(new Error('still broken'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toMatchObject({
      digest: VALID_DIGEST,
      passOnChainId: PASS_ID,
      onChainSuccess: true,
      dbSynced: false,
    })
  })

  // --- Confirmation timeout tolerance ---

  it('continues processing after a confirmation polling timeout', async () => {
    mockedWaitForTransactionBestEffort.mockResolvedValueOnce(undefined)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      digest: VALID_DIGEST,
      onChainSuccess: true,
      dbSynced: true,
    })
  })

  // --- UUID route param resolution ---

  it('resolves UUID route params against the primary series id only', async () => {
    const seriesUuid = '550e8400-e29b-41d4-a716-446655440001'

    const { POST } = await import('../../web/app/api/agent/souls/[id]/renew/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${seriesUuid}/renew/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'c2ln' }),
      }) as any,
      makeParams(seriesUuid),
    )

    expect(mockedPrisma.soulSeries.findFirst).toHaveBeenCalledWith({
      where: { id: seriesUuid },
      select: { onChainId: true },
    })
    expect(response.status).not.toBe(404)
  })
})
