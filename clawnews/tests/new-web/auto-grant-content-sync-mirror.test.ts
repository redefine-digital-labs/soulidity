import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ID = `0x${'1'.repeat(64)}`
const OTHER_SOUL_ID = `0x${'7'.repeat(64)}`
const CONTENT_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'4'.repeat(64)}`
const WALLET = `0x${'5'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'
const PACKAGE_ID = `0x${'9'.repeat(64)}`

const mockedFindSoulAssetByRouteId = vi.hoisted(() => vi.fn())
const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedBuildSyncSealSidecars = vi.hoisted(() => vi.fn())
const mockedSyncContentVersionProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedSyncGrantProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedEndSoulGrantProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedMarkContentVersionDeletedFromChain = vi.hoisted(() => vi.fn())
const mockedMarkContentVersionPurgedFromChain = vi.hoisted(() => vi.fn())
const mockedGetRequiredSoulidityEnv = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedResolveWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedExtractContentVersionAppendedEvent = vi.hoisted(() => vi.fn())
const mockedExtractContentVersionDeletedEvent = vi.hoisted(() => vi.fn())
const mockedExtractContentVersionPurgedEvent = vi.hoisted(() => vi.fn())
const mockedExtractActiveBindingUpdatedEvent = vi.hoisted(() => vi.fn())
const mockedExtractSoulStateConfigUpsertedEvent = vi.hoisted(() => vi.fn())
const mockedExtractSoulStateConfigDeletedEvent = vi.hoisted(() => vi.fn())
const mockedGetSoulStateConfigEntry = vi.hoisted(() => vi.fn())
const mockedExtractAllSoulGrantIssuedEvents = vi.hoisted(() => vi.fn())
const mockedExtractAllSoulGrantSupersededEvents = vi.hoisted(() => vi.fn())
const mockedGetSoulStateObject = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findSoulAssetByRouteId: mockedFindSoulAssetByRouteId,
}))

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@/lib/soulidity/mirror/build-seal-sidecars', () => ({
  buildSyncSealSidecars: mockedBuildSyncSealSidecars,
  SealSidecarSyncConfigError: class extends Error {},
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncContentVersionProjectionFromChain: mockedSyncContentVersionProjectionFromChain,
  syncGrantProjectionFromChain: mockedSyncGrantProjectionFromChain,
  endSoulGrantProjectionFromChain: mockedEndSoulGrantProjectionFromChain,
  markContentVersionDeletedFromChain: mockedMarkContentVersionDeletedFromChain,
  markContentVersionPurgedFromChain: mockedMarkContentVersionPurgedFromChain,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))

vi.mock('@soulidity/sdk', async () => {
  const actual = await vi.importActual<typeof import('@soulidity/sdk')>('@soulidity/sdk')
  return {
    ...actual,
    getRequiredSoulidityEnv: mockedGetRequiredSoulidityEnv,
    getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
    readTransactionSender: mockedReadTransactionSender,
    waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
    resolveWalrusBlobId: mockedResolveWalrusBlobId,
    extractContentVersionAppendedEvent: mockedExtractContentVersionAppendedEvent,
    extractContentVersionDeletedEvent: mockedExtractContentVersionDeletedEvent,
    extractContentVersionPurgedEvent: mockedExtractContentVersionPurgedEvent,
    extractActiveBindingUpdatedEvent: mockedExtractActiveBindingUpdatedEvent,
    extractSoulStateConfigUpsertedEvent: mockedExtractSoulStateConfigUpsertedEvent,
    extractSoulStateConfigDeletedEvent: mockedExtractSoulStateConfigDeletedEvent,
    extractAllSoulGrantIssuedEvents: mockedExtractAllSoulGrantIssuedEvents,
    extractAllSoulGrantSupersededEvents: mockedExtractAllSoulGrantSupersededEvents,
    getSoulStateConfigEntry: mockedGetSoulStateConfigEntry,
    getSoulStateObject: mockedGetSoulStateObject,
    parseRequiredTxDigest: mockedParseRequiredTxDigest,
  }
})

function jsonRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/souls/${SOUL_ID}/content/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function syncParams() {
  return { params: Promise.resolve({ id: SOUL_ID }) }
}

function appendBody() {
  return {
    action: 'append',
    txDigest: TX_DIGEST,
    kind: 3, // KIND_SPRITE
    name: 'idle',
    blobId: 'walrus-blob-id',
    contentHash: 'a'.repeat(64),
    sealSidecar: { documentId: '0xdoc' },
  }
}

function appendedEventBase() {
  return {
    contentId: CONTENT_ID,
    soulId: SOUL_ID,
    stateId: STATE_ID,
    kind: 3,
    kindName: 'sprite',
    name: 'idle',
    versionIndex: 1,
    blobObjectId: BLOB_OBJECT_ID,
    readModeMask: 3,
    opMask: 15,
    grantScopeMask: 8,
    isPublic: false,
    sealEncrypted: true,
    downloadPolicy: 'owner_only',
    createdAtMs: 123,
  }
}

describe('POST /api/souls/[id]/content/sync — auto-grant mirror', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1', accountId: 'account-1', kind: 'human' },
      walletAddresses: [WALLET],
    })
    mockedFindSoulAssetByRouteId.mockResolvedValue({
      onChainId: SOUL_ID,
      stateOnChainId: STATE_ID,
      contentOnChainId: CONTENT_ID,
      paidAccessListOnChainId: null,
    })
    mockedParseRequiredTxDigest.mockReturnValue(TX_DIGEST)
    mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
    mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({ digest: TX_DIGEST })
    mockedReadTransactionSender.mockReturnValue(WALLET)
    mockedAssertTransactionSender.mockReturnValue(null)
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedResolveWalrusBlobId.mockResolvedValue('walrus-blob-id')
    mockedBuildSyncSealSidecars.mockReturnValue({
      validatedEntries: [{ validatedSidecar: { documentId: '0xdoc' } }],
    })
    mockedSyncContentVersionProjectionFromChain.mockResolvedValue({ id: 'version-1' })
    mockedSyncGrantProjectionFromChain.mockResolvedValue({ id: 'grant-mirror' })
    mockedEndSoulGrantProjectionFromChain.mockResolvedValue({ id: 'grant-mirror' })
    mockedExtractContentVersionAppendedEvent.mockReturnValue(appendedEventBase())
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([])
    mockedExtractAllSoulGrantSupersededEvents.mockReturnValue([])
    mockedPrisma.soulAsset.updateMany.mockResolvedValue({ count: 1 })
  })

  it('does NOT call grant mirror helpers when no grant events fired', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(jsonRequest(appendBody()), syncParams())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.autoGrantedCount).toBe(0)
    expect(body.autoGrantedGrantOnChainIds).toEqual([])
    expect(mockedSyncGrantProjectionFromChain).not.toHaveBeenCalled()
    expect(mockedEndSoulGrantProjectionFromChain).not.toHaveBeenCalled()
    expect(mockedGetSoulStateObject).not.toHaveBeenCalled()
    // No prisma.soulAsset.updateMany either, since no capacity refresh needed.
    expect(mockedPrisma.soulAsset.updateMany).not.toHaveBeenCalled()
  })

  it('mirrors every SoulGrantIssued event for the same soul and includes count in response', async () => {
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { soulId: SOUL_ID, grantId: '0xgrant-a', granteeAddress: '0xa', scopeMask: 8 },
      { soulId: SOUL_ID, grantId: '0xgrant-b', granteeAddress: '0xb', scopeMask: 8 },
      // event for an unrelated soul must be filtered out — defense in depth
      { soulId: OTHER_SOUL_ID, grantId: '0xgrant-x', granteeAddress: '0xx', scopeMask: 8 },
    ])
    mockedGetSoulStateObject.mockResolvedValue({
      grantCapacity: 5,
      activeGrantCount: 2,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(jsonRequest(appendBody()), syncParams())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.autoGrantedCount).toBe(2)
    expect(body.autoGrantedGrantOnChainIds).toEqual(['0xgrant-a', '0xgrant-b'])
    expect(mockedSyncGrantProjectionFromChain).toHaveBeenCalledTimes(2)
    expect(mockedSyncGrantProjectionFromChain).toHaveBeenNthCalledWith(1, {
      packageId: PACKAGE_ID,
      grantObjectId: '0xgrant-a',
      soulOnChainId: SOUL_ID,
      issuedByMemberId: 'member-1',
    })
    expect(mockedSyncGrantProjectionFromChain).toHaveBeenNthCalledWith(2, {
      packageId: PACKAGE_ID,
      grantObjectId: '0xgrant-b',
      soulOnChainId: SOUL_ID,
      issuedByMemberId: 'member-1',
    })
    // Refresh capacity / count after grant events
    expect(mockedGetSoulStateObject).toHaveBeenCalledWith(STATE_ID, PACKAGE_ID, expect.objectContaining({
      includeActiveGrants: false,
    }))
    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: SOUL_ID, stateOnChainId: STATE_ID },
      data: { grantCapacity: 5, activeGrantCount: 2 },
    })
  })

  it('marks each SoulGrantSuperseded as superseded with the replacement id', async () => {
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([])
    mockedExtractAllSoulGrantSupersededEvents.mockReturnValue([
      { soulId: SOUL_ID, oldGrantId: '0xold', newGrantId: '0xnew', granteeAddress: '0xa' },
      { soulId: OTHER_SOUL_ID, oldGrantId: '0xold-x', newGrantId: '0xnew-x', granteeAddress: '0xz' },
    ])
    mockedGetSoulStateObject.mockResolvedValue({ grantCapacity: 1, activeGrantCount: 1 })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(jsonRequest(appendBody()), syncParams())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.autoGrantSupersededCount).toBe(1)
    expect(mockedEndSoulGrantProjectionFromChain).toHaveBeenCalledWith({
      grantOnChainId: '0xold',
      status: 'superseded',
      replacedByGrantOnChainId: '0xnew',
    })
    expect(mockedEndSoulGrantProjectionFromChain).toHaveBeenCalledTimes(1)
  })

  it('does not abort the response if SoulState refresh throws (best-effort log only)', async () => {
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { soulId: SOUL_ID, grantId: '0xgrant-a', granteeAddress: '0xa', scopeMask: 8 },
    ])
    mockedGetSoulStateObject.mockRejectedValue(new Error('rpc transient'))

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(jsonRequest(appendBody()), syncParams())
    expect(response.status).toBe(200)
    // Grant mirror still wrote
    expect(mockedSyncGrantProjectionFromChain).toHaveBeenCalledTimes(1)
    // Capacity refresh skipped silently
    expect(mockedPrisma.soulAsset.updateMany).not.toHaveBeenCalled()
  })
})
