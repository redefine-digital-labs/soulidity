import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VerifiedSoulState } from '../../web/lib/souls/on-chain-verification'
import { sameSuiValueForTests } from './test-sui-value.ts'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const KIOSK_ID = `0x${'3'.repeat(64)}`
const BUYER_KIOSK_ID = `0x${'4'.repeat(64)}`
const BUYER_KIOSK_CAP_ID = `0x${'5'.repeat(64)}`
const SELLER_ADDRESS = `0x${'6'.repeat(64)}`
const PREPARED_PURCHASE_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeVerifiedSoulState(overrides: Partial<VerifiedSoulState> = {}): VerifiedSoulState {
  return {
    objectId: SOUL_ID,
    ownerAddress: null,
    ownerObjectId: BUYER_KIOSK_ID,
    ownerKind: 'object',
    creatorAddress: `0x${'6'.repeat(64)}`,
    name: 'Signal Soul',
    description: 'Encrypted bundle',
    imageUrl: 'https://example.com/soul.png',
    metadataRef: null,
    contentBlobId: 'blob-content',
    contentBlobObjectId: '0xblob',
    allowlistAddress: null,
    allowlistVersion: 4n,
    ...overrides,
  }
}

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const MockSoulMirrorOwnershipConflictError = vi.hoisted(() => class MockSoulMirrorOwnershipConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoulMirrorOwnershipConflictError'
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
const mockedGetVerifiedPersonalKioskCapState = vi.hoisted(() => vi.fn())
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
  ZOMBIE_CLAIM_AGE_THRESHOLD_MS: 2 * 60 * 1000,
}))

vi.mock('@web/lib/souls/tx-signature', () => ({
  verifyPreparedTransactionSignature: mockedVerifyPreparedTransactionSignature,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  SoulMirrorOwnershipConflictError: MockSoulMirrorOwnershipConflictError,
  dbSetSoulOwnership: mockedDbSetSoulOwnership,
  narrowListingStatus: (v: string | null | undefined) => (v === 'listed' || v === 'held' ? v : undefined),
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  extractSoulPurchasedEvent: mockedExtractSoulPurchasedEvent,
  getVerifiedPersonalKioskCapState: mockedGetVerifiedPersonalKioskCapState,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  sameSuiValue: sameSuiValueForTests,
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

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AGENT_ADDRESS)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      listingStatus: 'listed',
      currentOwnerAddress: SELLER_ADDRESS,
      currentKioskId: KIOSK_ID,
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
    mockedSuiClient.executeTransactionBlock.mockResolvedValue({
      digest: '0xtx',
      effects: { status: { status: 'success' } },
    })
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: '0xtx' })
    mockedExtractSoulPurchasedEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      buyerKioskId: BUYER_KIOSK_ID,
      buyerKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      buyerAddress: AGENT_ADDRESS,
    })
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValue({
      objectId: BUYER_KIOSK_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      kioskId: BUYER_KIOSK_ID,
    })
    mockedGetVerifiedSoulState.mockResolvedValue(makeVerifiedSoulState())
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
    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
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

  it('returns 503 when the soul object package id env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID

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
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentOwnerMemberId: 'agent-member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 4n,
      expectedCurrentOwnerAddress: SELLER_ADDRESS,
      expectedCurrentKioskId: KIOSK_ID,
      expectedListingStatus: 'listed',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: '0xtx',
      resultStatusCode: 200,
      resultBody: {
        digest: '0xtx',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
        listingStatus: 'held',
        onChainSuccess: true,
        dbSynced: true,
      },
    })
    expect(mockedExtractSoulPurchasedEvent).toHaveBeenCalledTimes(1)
    expect(mockedExtractSoulPurchasedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ digest: '0xtx' }),
      PACKAGE_ID,
    )
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
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
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
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedGetSuccessfulTransactionBlock).toHaveBeenCalledWith('0xtx')
    expect(mockedClaimPreparedSoulPurchaseForExecution).toHaveBeenCalledTimes(1)
  })

  it('re-attempts DB sync when cached result is a recoverable 207', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xpartial',
      resultStatusCode: 207,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      allowlistVersion: 5n,
    }))
    mockedDbSetSoulOwnership.mockResolvedValueOnce(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

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
      digest: '0xpartial',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedGetVerifiedSoulState).toHaveBeenCalledWith(SOUL_ID, PACKAGE_ID)
    expect(mockedGetVerifiedPersonalKioskCapState).toHaveBeenCalledWith(BUYER_KIOSK_CAP_ID)
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentOwnerMemberId: 'agent-member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 5n,
      expectedCurrentOwnerAddress: SELLER_ADDRESS,
      expectedCurrentKioskId: KIOSK_ID,
      expectedListingStatus: 'listed',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: '0xpartial',
      resultStatusCode: 200,
      resultBody: {
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
        onChainSuccess: true,
        dbSynced: true,
      },
    })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('returns cached 207 when DB re-sync also fails on retry', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xpartial',
      resultStatusCode: 207,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      allowlistVersion: 5n,
    }))
    mockedDbSetSoulOwnership.mockRejectedValueOnce(new Error('db still offline'))

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
      onChainSuccess: true,
      dbSynced: false,
      digest: '0xpartial',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
    })
    expect(mockedGetVerifiedSoulState).toHaveBeenCalledWith(SOUL_ID, PACKAGE_ID)
    expect(mockedGetVerifiedPersonalKioskCapState).toHaveBeenCalledWith(BUYER_KIOSK_CAP_ID)
    expect(mockedFinalizePreparedSoulPurchaseExecution).not.toHaveBeenCalled()
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('finalizes cached 207 retries with a terminal 410 when the Soul has moved to a different owner path', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xpartial',
      resultStatusCode: 207,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
    }))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      digest: '0xpartial',
      soulOnChainId: SOUL_ID,
      onChainSuccess: true,
      dbSynced: false,
      ownershipChanged: true,
      error: 'Soul ownership changed since the original purchase sync. Refresh the Soul detail instead of retrying.',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: '0xpartial',
      resultStatusCode: 410,
      resultBody: {
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        onChainSuccess: true,
        dbSynced: false,
        ownershipChanged: true,
        error: 'Soul ownership changed since the original purchase sync. Refresh the Soul detail instead of retrying.',
      },
    })
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
    expect(mockedGetVerifiedPersonalKioskCapState).not.toHaveBeenCalled()
  })

  it('persists a specific 422 when the recovered kiosk cap no longer matches the agent wallet', async () => {
    const cachedBody = {
      onChainSuccess: true,
      dbSynced: false,
      digest: '0xpartial',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
    }
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xpartial',
      resultStatusCode: 207,
      resultBody: cachedBody,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      allowlistVersion: 5n,
    }))
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValueOnce({
      objectId: BUYER_KIOSK_CAP_ID,
      ownerAddress: `0x${'f'.repeat(64)}`,
      kioskId: BUYER_KIOSK_ID,
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

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      ...cachedBody,
      error: 'Purchase ownership verification failed',
    })
    expect(mockedGetVerifiedPersonalKioskCapState).toHaveBeenCalledWith(BUYER_KIOSK_CAP_ID)
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: '0xpartial',
      resultStatusCode: 422,
      resultBody: {
        ...cachedBody,
        error: 'Purchase ownership verification failed',
      },
    })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('re-attempts sync for cached 422 with onChainSuccess true', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xbad',
      resultStatusCode: 422,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: 'test-digest',
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      allowlistVersion: 6n,
    }))
    mockedDbSetSoulOwnership.mockResolvedValueOnce(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

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
      digest: 'test-digest',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedGetVerifiedSoulState).toHaveBeenCalledWith(SOUL_ID, PACKAGE_ID)
    expect(mockedGetVerifiedPersonalKioskCapState).toHaveBeenCalledWith(BUYER_KIOSK_CAP_ID)
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentOwnerMemberId: 'agent-member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 6n,
      expectedCurrentOwnerAddress: SELLER_ADDRESS,
      expectedCurrentKioskId: KIOSK_ID,
      expectedListingStatus: 'listed',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: 'test-digest',
      resultStatusCode: 200,
      resultBody: {
        digest: 'test-digest',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
        onChainSuccess: true,
        dbSynced: true,
      },
    })
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('clears stale allowlist mirrors during cached ownership resync after purchase', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xbad',
      resultStatusCode: 422,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: 'test-digest',
        currentKioskId: BUYER_KIOSK_ID,
        currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      },
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      allowlistAddress: `0x${'6'.repeat(64)}`,
      allowlistVersion: 7n,
    }))
    mockedDbSetSoulOwnership.mockResolvedValueOnce(undefined)
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValueOnce(undefined)

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
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentOwnerMemberId: 'agent-member-1',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingObjectOnChainId: null,
      listingStatus: 'held',
      listedPriceAtomic: null,
      allowlistVersion: 7n,
      expectedCurrentOwnerAddress: SELLER_ADDRESS,
      expectedCurrentKioskId: KIOSK_ID,
      expectedListingStatus: 'listed',
    })
  })

  it('releases execution claim and returns 400 when TX effects indicate failure', async () => {
    mockedSuiClient.executeTransactionBlock.mockResolvedValueOnce({
      digest: 'failed-tx-digest',
      effects: { status: { status: 'failure', error: 'MoveAbort: listing changed' } },
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

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction effects indicate failure',
    })
    expect(mockedReleasePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).not.toHaveBeenCalled()
    expect(mockedWaitForTransactionBestEffort).not.toHaveBeenCalled()
  })

  it('returns original 422 when on-chain owner does not match on retry', async () => {
    const cachedBody = {
      onChainSuccess: true,
      dbSynced: false,
      digest: 'test-digest',
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
    }
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xbad',
      resultStatusCode: 422,
      resultBody: cachedBody,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce(makeVerifiedSoulState({
      ownerObjectId: `0x${'f'.repeat(64)}`,
      allowlistVersion: 6n,
    }))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request('http://localhost/api/agent/souls/0xsoul/purchase/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparedPurchaseId: PREPARED_PURCHASE_ID, signature: 'sig' }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual(cachedBody)
    expect(mockedGetVerifiedSoulState).toHaveBeenCalledWith(SOUL_ID, PACKAGE_ID)
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
    expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
  })

  it('recovers kiosk ids from on-chain transaction when cached partial results are missing them', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xpartial',
      resultStatusCode: 207,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
      },
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
    expect(mockedGetSuccessfulTransactionBlock).toHaveBeenCalledWith('0xpartial')
    expect(mockedExtractSoulPurchasedEvent).toHaveBeenCalled()
    expect(mockedGetVerifiedSoulState).toHaveBeenCalled()
    expect(mockedDbSetSoulOwnership).toHaveBeenCalledWith(expect.objectContaining({
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: BUYER_KIOSK_ID,
      currentKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      listingStatus: 'held',
    }))
  })

  it('rejects cached recovery when the recovered purchase buyer does not match the agent wallet', async () => {
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
      id: PREPARED_PURCHASE_ID,
      soulOnChainId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      agentAddress: AGENT_ADDRESS,
      txBytesBase64: 'c2VydmVyLXR4',
      txBytesHash: 'deadbeef',
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      executionTxDigest: '0xpartial',
      resultStatusCode: 207,
      resultBody: {
        onChainSuccess: true,
        dbSynced: false,
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
      },
    })
    mockedExtractSoulPurchasedEvent.mockReturnValueOnce({
      soulObjectId: SOUL_ID,
      sellerKioskId: KIOSK_ID,
      buyerKioskId: BUYER_KIOSK_ID,
      buyerKioskCapOnChainId: BUYER_KIOSK_CAP_ID,
      buyerAddress: `0x${'f'.repeat(64)}`,
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

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      digest: '0xpartial',
      soulOnChainId: SOUL_ID,
      onChainSuccess: true,
      dbSynced: false,
      error: 'Purchased Soul owner does not match the agent wallet',
    })
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      txDigest: '0xpartial',
      resultStatusCode: 422,
      resultBody: {
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        onChainSuccess: true,
        dbSynced: false,
        error: 'Purchased Soul owner does not match the agent wallet',
      },
    })
  })

  it('falls back to cached result when kiosk ids are missing and on-chain recovery fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      mockedGetSuccessfulTransactionBlock.mockRejectedValueOnce(new Error('RPC unavailable'))
      mockedGetPreparedSoulPurchaseForExecution.mockResolvedValueOnce({
        id: PREPARED_PURCHASE_ID,
        soulOnChainId: SOUL_ID,
        sellerKioskId: KIOSK_ID,
        agentAddress: AGENT_ADDRESS,
        txBytesBase64: 'c2VydmVyLXR4',
        txBytesHash: 'deadbeef',
        executedAt: new Date('2099-01-01T00:00:00.000Z'),
        executionTxDigest: '0xpartial',
        resultStatusCode: 207,
        resultBody: {
          onChainSuccess: true,
          dbSynced: false,
          digest: '0xpartial',
          soulOnChainId: SOUL_ID,
          currentOwnerAddress: AGENT_ADDRESS,
        },
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

      expect(response.status).toBe(207)
      await expect(response.json()).resolves.toEqual({
        onChainSuccess: true,
        dbSynced: false,
        digest: '0xpartial',
        soulOnChainId: SOUL_ID,
        currentOwnerAddress: AGENT_ADDRESS,
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[agent-purchase-execute] Skipping cached partial-result re-sync because kiosk ids are missing and on-chain recovery failed',
        expect.objectContaining({ preparedPurchaseId: PREPARED_PURCHASE_ID }),
      )
      expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
      expect(mockedClaimPreparedSoulPurchaseForExecution).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('rejects when buyer kiosk cap does not point to the buyer kiosk', async () => {
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValueOnce({
      objectId: BUYER_KIOSK_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      kioskId: `0x${'e'.repeat(64)}`,
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

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'Purchased Soul kiosk cap does not match the buyer kiosk',
    }))
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
  })

  it('rejects when buyer kiosk cap is not owned by the agent wallet', async () => {
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValueOnce({
      objectId: BUYER_KIOSK_CAP_ID,
      ownerAddress: `0x${'d'.repeat(64)}`,
      kioskId: BUYER_KIOSK_ID,
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

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'Purchased Soul kiosk cap does not belong to the agent wallet',
    }))
    expect(mockedDbSetSoulOwnership).not.toHaveBeenCalled()
  })
})
