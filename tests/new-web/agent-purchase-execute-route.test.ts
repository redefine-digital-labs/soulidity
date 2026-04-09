import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const AGENT_ADDRESS = `0x${'1'.repeat(64)}`
const SOUL_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const MEMORY_ID = `0x${'4'.repeat(64)}`
const KIOSK_ID = `0x${'5'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'6'.repeat(64)}`
const PREPARED_PURCHASE_ID = '550e8400-e29b-41d4-a716-446655440000'
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const TX_BYTES_BASE64 = Buffer.from('server-tx').toString('base64')
const TX_BYTES_HASH = createHash('sha256').update(Buffer.from(TX_BYTES_BASE64, 'base64')).digest('hex')

const mockedRequireAgentWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  executeTransactionBlock: vi.fn(),
}))
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedExtractSoulPurchasedEvent = vi.hoisted(() => vi.fn())
const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedEndActiveSoulGrantProjectionsFromChain = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulPreparedPurchase: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/soulidity/agent-server', () => ({
  requireAgentWalletIdentity: mockedRequireAgentWalletIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
}))

vi.mock('@/lib/soulidity/events', () => ({
  extractSoulPurchasedEvent: mockedExtractSoulPurchasedEvent,
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
  endActiveSoulGrantProjectionsFromChain: mockedEndActiveSoulGrantProjectionsFromChain,
}))

vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
  readTransactionSender: mockedReadTransactionSender,
  waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
  sameSuiValue: (left: string | null | undefined, right: string | null | undefined) =>
    String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

function makeRequest() {
  return new Request(`http://localhost/api/agent/souls/${SOUL_ID}/purchase/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preparedPurchaseId: PREPARED_PURCHASE_ID,
      signature: 'agent-signature',
    }),
  })
}

describe('POST /api/agent/souls/[id]/purchase/execute', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireAgentWalletIdentity.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      walletAddresses: [AGENT_ADDRESS],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      onChainId: SOUL_ID,
      stateOnChainId: STATE_ID,
      memoryOnChainId: MEMORY_ID,
      category: 'Trading',
      tags: ['e2e'],
      previewImages: [],
      readme: null,
      sealSidecar: null,
      creatorMemberId: 'creator-member-1',
    })
    mockedPrisma.soulPreparedPurchase.findUnique.mockResolvedValue({
      id: PREPARED_PURCHASE_ID,
      agentMemberId: 'agent-member-1',
      executedAt: null,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      txBytesBase64: TX_BYTES_BASE64,
      txBytesHash: TX_BYTES_HASH,
    })
    mockedPrisma.soulPreparedPurchase.update.mockResolvedValue({})
    mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
    mockedSuiClient.executeTransactionBlock.mockResolvedValue({ digest: '0xtx' })
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: '0xtx' })
    mockedReadTransactionSender.mockReturnValue(AGENT_ADDRESS)
    mockedExtractSoulPurchasedEvent.mockReturnValue({ soulId: SOUL_ID })
    mockedSyncSoulProjectionFromChain.mockResolvedValue({
      onChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingStatus: 'held',
    })
    mockedEndActiveSoulGrantProjectionsFromChain.mockResolvedValue(undefined)
    mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  })

  async function callRoute() {
    const { POST } = await import('../../new-web/app/api/agent/souls/[id]/purchase/execute/route.ts')
    return POST(makeRequest() as any, { params: Promise.resolve({ id: SOUL_ID }) })
  }

  it('returns partial success instead of 500 when chain execution succeeds but local mirror sync fails', async () => {
    mockedSyncSoulProjectionFromChain.mockRejectedValueOnce(new Error('mirror offline'))

    const response = await callRoute()

    expect(response.status).toBe(207)
    await expect(response.json()).resolves.toEqual({
      digest: '0xtx',
      soulOnChainId: SOUL_ID,
      onChainSuccess: true,
      dbSynced: false,
      error: 'Transaction succeeded on chain, but local Soul sync failed.',
    })
  })

  it('does not downgrade a successful purchase when only post-sync bookkeeping fails', async () => {
    mockedEndActiveSoulGrantProjectionsFromChain.mockRejectedValueOnce(new Error('grant projection failed'))

    const response = await callRoute()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      digest: '0xtx',
      soulOnChainId: SOUL_ID,
      currentOwnerAddress: AGENT_ADDRESS,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingStatus: 'held',
    })
  })
})
