import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOUL_ID = `0x${'1'.repeat(64)}`
const CONTENT_ID = `0x${'2'.repeat(64)}`
const STATE_ID = `0x${'3'.repeat(64)}`
const BLOB_OBJECT_ID = `0x${'4'.repeat(64)}`
const WALLET = `0x${'5'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'
const PACKAGE_ID = `0x${'9'.repeat(64)}`

const mockedFindContentVersionsByRouteId = vi.hoisted(() => vi.fn())
const mockedFindContentVersionByRouteId = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetByRouteId = vi.hoisted(() => vi.fn())
const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedResolveContentAccessPayload = vi.hoisted(() => vi.fn())
const mockedBuildSyncSealSidecars = vi.hoisted(() => vi.fn())
const mockedSyncContentVersionProjectionFromChain = vi.hoisted(() => vi.fn())
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
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/soulidity/repository', () => ({
  findContentVersionsByRouteId: mockedFindContentVersionsByRouteId,
  findContentVersionByRouteId: mockedFindContentVersionByRouteId,
  findSoulAssetByRouteId: mockedFindSoulAssetByRouteId,
}))

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@/lib/soulidity/access', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/soulidity/access')>('@/lib/soulidity/access')
  return {
    ...actual,
    resolveContentAccessPayload: mockedResolveContentAccessPayload,
  }
})

vi.mock('@/lib/soulidity/mirror/build-seal-sidecars', () => ({
  buildSyncSealSidecars: mockedBuildSyncSealSidecars,
  SealSidecarSyncConfigError: class SealSidecarSyncConfigError extends Error {},
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncContentVersionProjectionFromChain: mockedSyncContentVersionProjectionFromChain,
  markContentVersionDeletedFromChain: mockedMarkContentVersionDeletedFromChain,
  markContentVersionPurgedFromChain: mockedMarkContentVersionPurgedFromChain,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

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
    parseRequiredTxDigest: mockedParseRequiredTxDigest,
  }
})

function jsonRequest(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function accessParams(kind = 'skill', name = 'market-scout', versionIndex = '2') {
  return {
    params: Promise.resolve({
      id: SOUL_ID,
      kind,
      name,
      versionIndex,
    }),
  }
}

function syncParams() {
  return { params: Promise.resolve({ id: SOUL_ID }) }
}

describe('GET /api/souls/[id]/content', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('paginates one requested content kind/name without inventing a parallel DTO', async () => {
    const page = {
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 2,
      name: 'market-scout',
      items: [{ id: 'version-2', kind: 2, name: 'market-scout', versionIndex: 2 }],
      nextCursor: 'next-cursor',
      total: 3,
    }
    mockedFindContentVersionsByRouteId.mockResolvedValue(page)

    const { GET } = await import('../../web/app/api/souls/[id]/content/route')
    const response = await GET(
      new Request(`http://localhost/api/souls/${SOUL_ID}/content?kind=skill&name=market-scout&cursor=cursor-1&limit=2`),
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(page)
    expect(mockedFindContentVersionsByRouteId).toHaveBeenCalledWith(SOUL_ID, 2, {
      name: 'market-scout',
      cursor: 'cursor-1',
      limit: 2,
    })
  })
})

describe('GET /api/souls/[id]/content/[kind]/[name]/[versionIndex]/access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1' },
      walletAddresses: [WALLET],
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetByRouteId.mockResolvedValue({
      onChainId: SOUL_ID,
      stateOnChainId: STATE_ID,
      contentOnChainId: CONTENT_ID,
      paidAccessListOnChainId: null,
    })
    mockedFindContentVersionByRouteId.mockResolvedValue({
      id: 'version-2',
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 2,
      kindName: 'skill',
      name: 'market-scout',
      versionIndex: 2,
    })
    mockedGetRequiredSoulidityEnv.mockReturnValue(PACKAGE_ID)
    mockedResolveContentAccessPayload.mockResolvedValue({
      visibility: 'sealed',
      slot: { kind: 2, name: 'market-scout', versionIndex: 2 },
      artifact: { walrusBlobUrl: null, walrusBlobId: null, blobObjectId: BLOB_OBJECT_ID },
    })
  })

  it('resolves non-SOUL_DOC versions through the unified content access resolver', async () => {
    const { GET } = await import('../../web/app/api/souls/[id]/content/[kind]/[name]/[versionIndex]/access/route')
    const response = await GET(new Request('http://localhost/access'), accessParams())

    expect(response.status).toBe(200)
    expect(mockedFindContentVersionByRouteId).toHaveBeenCalledWith(SOUL_ID, 2, 'market-scout', 2)
    expect(mockedResolveContentAccessPayload).toHaveBeenCalledWith({
      soul: {
        onChainId: SOUL_ID,
        stateOnChainId: STATE_ID,
        contentOnChainId: CONTENT_ID,
        paidAccessListOnChainId: null,
      },
      version: expect.objectContaining({
        kind: 2,
        name: 'market-scout',
        versionIndex: 2,
      }),
      viewerAddresses: [WALLET],
      packageId: PACKAGE_ID,
    })
  })
})

describe('POST /api/souls/[id]/content/sync', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireHumanWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1' },
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
    mockedSyncContentVersionProjectionFromChain.mockResolvedValue({ id: 'version-2' })
    mockedMarkContentVersionDeletedFromChain.mockResolvedValue({ id: 'version-2' })
    mockedMarkContentVersionPurgedFromChain.mockResolvedValue({ id: 'version-2' })
    mockedPrisma.soulAsset.updateMany.mockResolvedValue({ count: 1 })
  })

  it('mirrors append events idempotently with the existing content:append tx-sync key', async () => {
    mockedExtractContentVersionAppendedEvent.mockReturnValue({
      contentId: CONTENT_ID,
      soulId: SOUL_ID,
      kind: 2,
      kindName: 'skill',
      name: 'market-scout',
      versionIndex: 2,
      blobObjectId: BLOB_OBJECT_ID,
      readModeMask: 3,
      opMask: 7,
      grantScopeMask: 4,
      isPublic: false,
      sealEncrypted: true,
      downloadPolicy: 'owner_only',
      createdAtMs: 123,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'append',
        txDigest: TX_DIGEST,
        kind: 2,
        name: 'market-scout',
        blobId: 'walrus-blob-id',
        contentHash: 'a'.repeat(64),
        sealSidecar: { documentId: '0xdoc' },
      }),
      syncParams(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      action: 'append',
      txDigest: TX_DIGEST,
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 2,
      name: 'market-scout',
      versionIndex: 2,
    })
    expect(mockedSyncContentVersionProjectionFromChain).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 2,
      kindName: 'skill',
      name: 'market-scout',
      versionIndex: 2,
      blobObjectId: BLOB_OBJECT_ID,
      blobId: 'walrus-blob-id',
      readModeMask: 3,
      opMask: 7,
      grantScopeMask: 4,
      isPublic: false,
      sealEncrypted: true,
      downloadPolicy: 'owner_only',
      sealSidecar: { documentId: '0xdoc' },
      createdAtMs: 123,
    })
    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith(expect.objectContaining({
      routeKey: 'content:append',
      txDigest: TX_DIGEST,
      actorKey: 'member-1',
      resourceKey: `${SOUL_ID}:2:market-scout`,
      statusCode: 200,
    }))
  })

  it('returns a stored sync response before re-reading chain data', async () => {
    mockedGetStoredSoulidityTxSync.mockResolvedValue({
      statusCode: 200,
      responseBody: { action: 'delete', txDigest: TX_DIGEST, versionIndex: 1 },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'delete',
        txDigest: TX_DIGEST,
        kind: 1,
        name: 'default',
        versionIndex: 1,
      }),
      syncParams(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ action: 'delete', txDigest: TX_DIGEST, versionIndex: 1 })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('mirrors delete and purge events into the content version projection', async () => {
    mockedExtractContentVersionDeletedEvent.mockReturnValue({
      contentId: CONTENT_ID,
      soulId: SOUL_ID,
      kind: 1,
      kindName: 'memory',
      name: 'default',
      versionIndex: 3,
    })
    mockedExtractContentVersionPurgedEvent.mockReturnValue({
      contentId: CONTENT_ID,
      soulId: SOUL_ID,
      kind: 1,
      kindName: 'memory',
      name: 'default',
      versionIndex: 3,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const deleteResponse = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'delete',
        txDigest: TX_DIGEST,
        kind: 1,
        name: 'default',
        versionIndex: 3,
      }),
      syncParams(),
    )
    const purgeResponse = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'purge',
        txDigest: TX_DIGEST,
        kind: 1,
        name: 'default',
        versionIndex: 3,
      }),
      syncParams(),
    )

    expect(deleteResponse.status).toBe(200)
    expect(purgeResponse.status).toBe(200)
    expect(mockedMarkContentVersionDeletedFromChain).toHaveBeenCalledWith({
      contentOnChainId: CONTENT_ID,
      kind: 1,
      name: 'default',
      versionIndex: 3,
    })
    expect(mockedMarkContentVersionPurgedFromChain).toHaveBeenCalledWith({
      contentOnChainId: CONTENT_ID,
      kind: 1,
      name: 'default',
      versionIndex: 3,
    })
  })

  it('updates the active sprite projection from ActiveBindingUpdated events', async () => {
    mockedExtractActiveBindingUpdatedEvent.mockReturnValue({
      contentId: CONTENT_ID,
      soulId: SOUL_ID,
      kind: 3,
      kindName: 'sprite',
      binding: {
        kind: 3,
        name: 'persona-sprite',
        versionIndex: 4,
        downloadPolicy: 'owner_only',
      },
      updaterAddress: WALLET,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'active-bind',
        txDigest: TX_DIGEST,
        kind: 3,
        name: 'persona-sprite',
        versionIndex: 4,
      }),
      syncParams(),
    )

    expect(response.status).toBe(200)
    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: SOUL_ID, contentOnChainId: CONTENT_ID },
      data: {
        activeSpriteName: 'persona-sprite',
        activeSpriteVersionIndex: 4,
        activeSpriteDownloadPolicy: 'owner_only',
      },
    })
  })
})
