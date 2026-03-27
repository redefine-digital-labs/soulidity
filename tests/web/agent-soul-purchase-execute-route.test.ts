import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const MARKET_ADAPTER_PACKAGE_ID = `0x${'8'.repeat(64)}`
const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`
const PREPARED_PURCHASE_ID = '550e8400-e29b-41d4-a716-446655440000'

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetPreparedSoulPurchaseForExecution = vi.hoisted(() => vi.fn())
const mockedClaimPreparedSoulPurchaseForExecution = vi.hoisted(() => vi.fn())
const mockedFinalizePreparedSoulPurchaseExecution = vi.hoisted(() => vi.fn())
const mockedReleasePreparedSoulPurchaseExecution = vi.hoisted(() => vi.fn())
const mockedGetPreparedSoulPurchaseTxDigest = vi.hoisted(() => vi.fn())
const mockedHashPreparedSoulPurchaseTxBytes = vi.hoisted(() => vi.fn())
const mockedStorePreparedSoulPurchaseExecutionDigest = vi.hoisted(() => vi.fn())
const mockedVerifyPreparedTransactionSignature = vi.hoisted(() => vi.fn())
const mockedDbSetSoulOwnership = vi.hoisted(() => vi.fn())
const mockedExtractSoulPurchasedEvent = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  executeTransactionBlock: vi.fn(),
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@web/lib/souls/prepared-purchase', () => ({
  getPreparedSoulPurchaseForExecution: mockedGetPreparedSoulPurchaseForExecution,
  claimPreparedSoulPurchaseForExecution: mockedClaimPreparedSoulPurchaseForExecution,
  finalizePreparedSoulPurchaseExecution: mockedFinalizePreparedSoulPurchaseExecution,
  releasePreparedSoulPurchaseExecution: mockedReleasePreparedSoulPurchaseExecution,
  getPreparedSoulPurchaseTxDigest: mockedGetPreparedSoulPurchaseTxDigest,
  hashPreparedSoulPurchaseTxBytes: mockedHashPreparedSoulPurchaseTxBytes,
  storePreparedSoulPurchaseExecutionDigest: mockedStorePreparedSoulPurchaseExecutionDigest,
}))

vi.mock('@web/lib/souls/tx-signature', () => ({
  verifyPreparedTransactionSignature: mockedVerifyPreparedTransactionSignature,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbSetSoulOwnership: mockedDbSetSoulOwnership,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  extractSoulPurchasedEvent: mockedExtractSoulPurchasedEvent,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: (left: string | null | undefined, right: string | null | undefined) =>
    String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
}))

vi.mock('@web/lib/souls/tx-confirmation', () => ({
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
}))

vi.mock('@web/lib/souls/transaction', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('agent soul purchase execute route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID = MARKET_ADAPTER_PACKAGE_ID

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AGENT_ADDRESS)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
    })
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValue({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: null,
      executionTxDigest: null,
      resultStatusCode: null,
      resultBody: null,
    })
    mockedClaimPreparedSoulPurchaseForExecution.mockResolvedValue({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: null,
      resultStatusCode: null,
      resultBody: null,
    })
    mockedGetPreparedSoulPurchaseTxDigest.mockReturnValue('0xtx')
    mockedHashPreparedSoulPurchaseTxBytes.mockReturnValue('deadbeef')
    mockedStorePreparedSoulPurchaseExecutionDigest.mockResolvedValue(undefined)
    mockedVerifyPreparedTransactionSignature.mockResolvedValue(undefined)
    mockedSuiClient.executeTransactionBlock.mockResolvedValue({ digest: '0xtx' })
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: '0xtx' })
    mockedExtractSoulPurchasedEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      buyerAddress: AGENT_ADDRESS,
    })
    mockedGetVerifiedSoulState.mockResolvedValue({
      ownerAddress: AGENT_ADDRESS,
      grantVersion: 4n,
    })
    mockedDbSetSoulOwnership.mockResolvedValue(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValue(undefined)
    mockedReleasePreparedSoulPurchaseExecution.mockResolvedValue(undefined)
  })

  it('rejects malformed preparedPurchaseId values before touching storage', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: 'bad', signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(400)
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('returns cached finalized purchase results without re-executing the transaction', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xold',
      resultStatusCode: 200,
      resultBody: { digest: '0xold', dbSynced: true },
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ digest: '0xold', dbSynced: true })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('returns 404 when the prepared purchase no longer exists for this Soul', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Prepared purchase not found, expired, or no longer matches this Soul',
    })
  })

  it('returns 503 when the market adapter package id env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedGetPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('releases the execution claim when the signature is not bound to the prepared wallet', async () => {
    mockedVerifyPreparedTransactionSignature.mockRejectedValueOnce(new Error('bad sig'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction signature does not match the prepared agent wallet',
    })
    expect(mockedReleasePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
    })
    expect(mockedSuiClient.executeTransactionBlock).not.toHaveBeenCalled()
  })

  it('finalizes successful purchases and mirrors Soul ownership', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      digest: '0xtx',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      listingStatus: 'held',
      sellerKioskId: null,
      listedPriceSui: null,
      grantVersion: 4n,
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: '0xtx',
      resultStatusCode: 200,
      resultBody: {
        digest: '0xtx',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        onChainSuccess: true,
        dbSynced: true,
      },
    })
  })

  it('surfaces partial success when the chain tx succeeds but local sync fails', async () => {
    mockedDbSetSoulOwnership.mockRejectedValueOnce(new Error('db offline'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toEqual({
      digest: '0xtx',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      onChainSuccess: true,
      dbSynced: false,
      error: 'Transaction succeeded on chain, but local Soul sync failed.',
    })
  })

  it('recovers a previously submitted purchase when finalization storage failed on the first attempt', async () => {
    mockedFinalizePreparedSoulPurchaseExecution.mockRejectedValueOnce(new Error('db write failed'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')

    const firstResponse = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(firstResponse.status).toBe(500)

    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: null,
      resultStatusCode: null,
      resultBody: null,
    })
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

    const recoveredResponse = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(recoveredResponse.status).toBe(200)
    await expect(recoveredResponse.json()).resolves.toEqual({
      digest: '0xtx',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedGetSuccessfulTransactionBlock).toHaveBeenCalledWith('0xtx')
    expect(mockedClaimPreparedSoulPurchaseForExecution).toHaveBeenCalledTimes(1)
  })
})
