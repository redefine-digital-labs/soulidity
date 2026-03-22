import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ADDRESS = `0x${'a'.repeat(64)}`
const SERIES_ID = `0x${'b'.repeat(64)}`
const OTHER_SERIES_ID = `0x${'c'.repeat(64)}`
const RELEASE_ID = `0x${'d'.repeat(64)}`

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  member: { findUnique: vi.fn() },
}))
const mockedDbCreatePass = vi.hoisted(() => vi.fn())
const mockedClaimPreparedSoulPurchaseForExecution = vi.hoisted(() => vi.fn())
const mockedGetPreparedSoulPurchaseForExecution = vi.hoisted(() => vi.fn())
const mockedFinalizePreparedSoulPurchaseExecution = vi.hoisted(() => vi.fn())
const mockedHashPreparedSoulPurchaseTxBytes = vi.hoisted(() => vi.fn(() => 'deadbeef'))
const mockedSuiClient = vi.hoisted(() => ({
  executeTransactionBlock: vi.fn(),
  waitForTransaction: vi.fn(),
  getObject: vi.fn(),
}))

vi.mock('@web/lib/auth/require-agent-api-key', () => ({
  requireAgentApiKey: mockedRequireAgentApiKey,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbCreatePass: mockedDbCreatePass,
}))

vi.mock('@web/lib/souls/prepared-purchase', () => ({
  claimPreparedSoulPurchaseForExecution: mockedClaimPreparedSoulPurchaseForExecution,
  getPreparedSoulPurchaseForExecution: mockedGetPreparedSoulPurchaseForExecution,
  finalizePreparedSoulPurchaseExecution: mockedFinalizePreparedSoulPurchaseExecution,
  hashPreparedSoulPurchaseTxBytes: mockedHashPreparedSoulPurchaseTxBytes,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('agent soul purchase execute route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      onChainId: SERIES_ID,
    })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'agent-member-1',
      wallet: AGENT_ADDRESS,
      walletBindings: [{ address: AGENT_ADDRESS, chain: 'sui' }],
    })
    mockedSuiClient.executeTransactionBlock.mockResolvedValue({
      digest: '0xdigest',
      effects: { status: { status: 'success' } },
      objectChanges: [
        {
          type: 'created',
          objectId: '0xpass',
          objectType: '0xpackage::pass::PerpetualPass',
          sender: AGENT_ADDRESS,
          owner: { AddressOwner: AGENT_ADDRESS },
        },
      ],
    })
    mockedSuiClient.waitForTransaction.mockResolvedValue(undefined)
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        type: '0xpackage::pass::PerpetualPass',
        owner: { AddressOwner: AGENT_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
          fields: {
            series_id: OTHER_SERIES_ID,
            release_id: RELEASE_ID,
            owner: AGENT_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })
    mockedDbCreatePass.mockResolvedValue({
      id: 'pass-db-1',
      onChainId: '0xpass',
      passType: 'perpetual',
    })
    mockedGetPreparedSoulPurchaseForExecution.mockResolvedValue({
      id: 'prepared-purchase-1',
      txBytesBase64: 'c2VydmVyLXR4LWJ5dGVz',
      txBytesHash: 'deadbeef',
      seriesOnChainId: SERIES_ID,
      planOnChainId: '0xplan-1',
      planType: 'onetime',
      releaseOnChainId: RELEASE_ID,
      amountUsdc: 1_000_000n,
      agentAddress: AGENT_ADDRESS,
      executedAt: null,
      resultStatusCode: null,
      resultBody: null,
    })
    mockedClaimPreparedSoulPurchaseForExecution.mockResolvedValue({
      id: 'prepared-purchase-1',
      txBytesBase64: 'c2VydmVyLXR4LWJ5dGVz',
      txBytesHash: 'deadbeef',
      seriesOnChainId: SERIES_ID,
      planOnChainId: '0xplan-1',
      planType: 'onetime',
      releaseOnChainId: RELEASE_ID,
      amountUsdc: 1_000_000n,
      agentAddress: AGENT_ADDRESS,
      executedAt: new Date('2099-01-01T00:00:00.000Z'),
      resultStatusCode: null,
      resultBody: null,
    })
    mockedHashPreparedSoulPurchaseTxBytes.mockReturnValue('deadbeef')
    mockedFinalizePreparedSoulPurchaseExecution.mockResolvedValue(undefined)
  })

  it('rejects a created pass whose verified on-chain series does not match the route series', async () => {
    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/purchase/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preparedPurchaseId: 'prepared-purchase-1',
          signature: 'c2ln',
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Created pass does not belong to the requested Soul',
    })
    expect(mockedDbCreatePass).not.toHaveBeenCalled()
  })

  it('submits the server-prepared tx bytes instead of caller-supplied bytes', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        type: '0xpackage::pass::PerpetualPass',
        owner: { AddressOwner: AGENT_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
          fields: {
            series_id: SERIES_ID,
            release_id: RELEASE_ID,
            owner: AGENT_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/purchase/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preparedPurchaseId: 'prepared-purchase-1',
          signature: 'c2ln',
          txBytes: 'Y2xpZW50LXN1cHBsaWVkLWJ5dGVz',
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedGetPreparedSoulPurchaseForExecution).toHaveBeenCalledWith({
      preparedPurchaseId: 'prepared-purchase-1',
      agentMemberId: 'agent-member-1',
      seriesOnChainId: SERIES_ID,
    })
    expect(mockedSuiClient.executeTransactionBlock).toHaveBeenCalledWith({
      transactionBlock: 'c2VydmVyLXR4LWJ5dGVz',
      signature: 'c2ln',
      options: { showEffects: true, showObjectChanges: true },
    })
  })

  it('mirrors the locked release from the verified created pass object', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        type: '0xpackage::pass::PerpetualPass',
        owner: { AddressOwner: AGENT_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
          fields: {
            series_id: SERIES_ID,
            release_id: RELEASE_ID,
            owner: AGENT_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/purchase/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preparedPurchaseId: 'prepared-purchase-1',
          signature: 'c2ln',
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      digest: '0xdigest',
      passOnChainId: '0xpass',
      onChainSuccess: true,
      dbSynced: true,
    })
    expect(mockedDbCreatePass).toHaveBeenCalledWith({
      passOnChainId: '0xpass',
      seriesOnChainId: SERIES_ID,
      ownerAddress: AGENT_ADDRESS,
      ownerMemberId: 'agent-member-1',
      passType: 'perpetual',
      lockedReleaseId: RELEASE_ID,
      mintTxDigest: '0xdigest',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: 'prepared-purchase-1',
      resultStatusCode: 200,
      resultBody: {
        digest: '0xdigest',
        status: 'success',
        passOnChainId: '0xpass',
        onChainSuccess: true,
        dbSynced: true,
      },
      txDigest: '0xdigest',
    })
  })

  it('surfaces partial success when the chain tx succeeds but pass mirroring fails', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        type: '0xpackage::pass::PerpetualPass',
        owner: { AddressOwner: AGENT_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
          fields: {
            series_id: SERIES_ID,
            release_id: RELEASE_ID,
            owner: AGENT_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })
    mockedDbCreatePass.mockRejectedValueOnce(new Error('db unavailable'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/purchase/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preparedPurchaseId: 'prepared-purchase-1',
          signature: 'c2ln',
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toMatchObject({
      digest: '0xdigest',
      passOnChainId: '0xpass',
      onChainSuccess: true,
      dbSynced: false,
      syncError: 'db_sync_failed',
    })
    expect(mockedFinalizePreparedSoulPurchaseExecution).toHaveBeenCalledWith({
      preparedPurchaseId: 'prepared-purchase-1',
      resultStatusCode: 207,
      resultBody: expect.objectContaining({
        digest: '0xdigest',
        passOnChainId: '0xpass',
        onChainSuccess: true,
        dbSynced: false,
      }),
      txDigest: '0xdigest',
    })
  })

  it('does not leak raw execution errors back to the client', async () => {
    mockedSuiClient.executeTransactionBlock.mockRejectedValueOnce(new Error('rpc failed: http://internal-node'))

    const { POST } = await import('../../web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    const response = await POST(
      new Request(`http://localhost/api/agent/souls/${SERIES_ID}/purchase/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preparedPurchaseId: 'prepared-purchase-1',
          signature: 'c2ln',
        }),
      }) as any,
      { params: Promise.resolve({ id: SERIES_ID }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction execution failed',
    })
  })
})
