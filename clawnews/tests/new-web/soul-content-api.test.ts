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
const mockedExtractSoulStateConfigUpsertedEvent = vi.hoisted(() => vi.fn())
const mockedExtractSoulStateConfigDeletedEvent = vi.hoisted(() => vi.fn())
const mockedGetSoulStateConfigEntry = vi.hoisted(() => vi.fn())
const mockedParseRequiredTxDigest = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => {
  const stub = {
    soulAsset: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    // The post-Phase-2 sync route wraps mirror writes + the SoulTxSync
    // idempotency write in a single `$transaction` so 500-on-success-write
    // can no longer leave half-committed state. The mirror helpers are
    // mocked separately, so the test only needs a tx callback that runs
    // the inner function with the same stub client.
    $transaction: vi.fn(async (cb: (client: unknown) => unknown) => cb(stub)),
  }
  return stub
})

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
  getRequestIp: () => null,
  getAnonymousRateLimitFingerprint: () => null,
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
    extractSoulStateConfigUpsertedEvent: mockedExtractSoulStateConfigUpsertedEvent,
    extractSoulStateConfigDeletedEvent: mockedExtractSoulStateConfigDeletedEvent,
    getSoulStateConfigEntry: mockedGetSoulStateConfigEntry,
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
      readModeMask: 1, // READ_OWNER only — not public-plaintext-eligible
      sealEncrypted: true,
      downloadPolicy: 'owner_only',
      deletedAt: null,
      purgedAt: null,
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
    expect(mockedRequireHumanWalletIdentity).toHaveBeenCalled()
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

  it('serves public plaintext slots to anonymous visitors without wallet auth or Seal config (R-001)', async () => {
    // Public plaintext sprite: READ_PUBLIC bit set + downloadPolicy=public + !sealEncrypted.
    mockedFindContentVersionByRouteId.mockResolvedValue({
      id: 'sprite-7',
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 4, // KIND_SPRITE
      kindName: 'sprite',
      name: 'idle-front',
      versionIndex: 7,
      readModeMask: 1 | 2 | 8, // READ_OWNER | READ_GRANT | READ_PUBLIC
      sealEncrypted: false,
      downloadPolicy: 'public',
      deletedAt: null,
      purgedAt: null,
    })
    mockedResolveContentAccessPayload.mockResolvedValue({
      visibility: 'public-plaintext',
      slot: { kind: 4, name: 'idle-front', versionIndex: 7 },
      artifact: {
        walrusBlobUrl: 'https://walrus.example/blob-sprite-7',
        walrusBlobId: 'blob-sprite-7',
        blobObjectId: BLOB_OBJECT_ID,
      },
    })
    mockedRequireHumanWalletIdentity.mockResolvedValue({ error: { status: 401 } })

    const { GET } = await import('../../web/app/api/souls/[id]/content/[kind]/[name]/[versionIndex]/access/route')
    const response = await GET(new Request('http://localhost/access'), accessParams('sprite', 'idle-front', '7'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      visibility: 'public-plaintext',
      artifact: { walrusBlobUrl: 'https://walrus.example/blob-sprite-7' },
    })
    // No wallet auth, no Seal-config gating for the public plaintext path.
    expect(mockedRequireHumanWalletIdentity).not.toHaveBeenCalled()
    // Resolver invoked with empty viewer addresses so the public branch fires.
    expect(mockedResolveContentAccessPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        viewerAddresses: [],
      }),
    )
    // Anonymous rate-limit bucket, not the per-member one.
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      expect.stringMatching(/^anon-content-access:/),
      expect.any(Object),
    )
  })

  it('still requires wallet auth when the slot is sealed even if READ_PUBLIC is set', async () => {
    // Sealed-public slot: READ_PUBLIC + sealEncrypted=true → resolver returns
    // a Seal session response, so the route still needs auth + Seal config.
    mockedFindContentVersionByRouteId.mockResolvedValue({
      id: 'sealed-pub',
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 2,
      kindName: 'skill',
      name: 'market-scout',
      versionIndex: 2,
      readModeMask: 1 | 2 | 8, // includes READ_PUBLIC
      sealEncrypted: true,
      downloadPolicy: 'public',
      deletedAt: null,
      purgedAt: null,
    })

    const { GET } = await import('../../web/app/api/souls/[id]/content/[kind]/[name]/[versionIndex]/access/route')
    const response = await GET(new Request('http://localhost/access'), accessParams())

    expect(response.status).toBe(200)
    expect(mockedRequireHumanWalletIdentity).toHaveBeenCalled()
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith(
      expect.stringMatching(/^human-content-access:/),
      expect.any(Object),
    )
  })

  it('rejects unauthenticated requests for non-public slots with the auth error', async () => {
    // Owner-only plaintext slot: not eligible for the public path; visitor
    // without auth gets the auth error from the auth-required branch.
    mockedFindContentVersionByRouteId.mockResolvedValue({
      id: 'owner-only',
      soulOnChainId: SOUL_ID,
      contentOnChainId: CONTENT_ID,
      kind: 2,
      kindName: 'skill',
      name: 'market-scout',
      versionIndex: 2,
      readModeMask: 1, // READ_OWNER only
      sealEncrypted: true,
      downloadPolicy: 'owner_only',
      deletedAt: null,
      purgedAt: null,
    })
    const authError = new Response('unauthorized', { status: 401 })
    mockedRequireHumanWalletIdentity.mockResolvedValue({ error: authError })

    const { GET } = await import('../../web/app/api/souls/[id]/content/[kind]/[name]/[versionIndex]/access/route')
    const response = await GET(new Request('http://localhost/access'), accessParams())

    expect(response).toBe(authError)
    expect(mockedRequireHumanWalletIdentity).toHaveBeenCalled()
    expect(mockedResolveContentAccessPayload).not.toHaveBeenCalled()
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
      autoGrantedCount: 0,
      autoGrantedGrantOnChainIds: [],
      autoGrantSupersededCount: 0,
    })
    // Mirror writes thread the global `prisma` client through to the helpers
    // so a `prisma.$transaction` rollback can never strand the Seal sidecar
    // (encryptedDek + iv only live in the browser). Allow it via
    // `expect.anything()`.
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
    }, expect.anything())
    // The idempotency record is best-effort and runs OUTSIDE any transaction,
    // so no client argument is threaded — `storeSoulidityTxSync` defaults to
    // the global `prisma` client.
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
    }, expect.anything())
    expect(mockedMarkContentVersionPurgedFromChain).toHaveBeenCalledWith({
      contentOnChainId: CONTENT_ID,
      kind: 1,
      name: 'default',
      versionIndex: 3,
    }, expect.anything())
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

  it('mirrors state-config:upsert with the chain-derived value, ignoring the request body value (R-001)', async () => {
    mockedExtractSoulStateConfigUpsertedEvent.mockReturnValue({
      stateId: STATE_ID,
      soulId: SOUL_ID,
      updaterAddress: WALLET,
      key: 'sprite_config_json',
    })
    mockedGetSoulStateConfigEntry.mockResolvedValue({ value: '{"chain":"truth"}' })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'state-config:upsert',
        txDigest: TX_DIGEST,
        key: 'sprite_config_json',
        value: '{"client":"forged"}',
      }),
      syncParams(),
    )

    expect(response.status).toBe(200)
    expect(mockedGetSoulStateConfigEntry).toHaveBeenCalledWith({
      stateObjectId: STATE_ID,
      packageId: PACKAGE_ID,
      key: 'sprite_config_json',
    })
    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: SOUL_ID, stateOnChainId: STATE_ID },
      data: { spriteConfigJson: '{"chain":"truth"}' },
    })
  })

  it('rejects state-config:upsert when the chain has no entry for the key', async () => {
    mockedExtractSoulStateConfigUpsertedEvent.mockReturnValue({
      stateId: STATE_ID,
      soulId: SOUL_ID,
      updaterAddress: WALLET,
      key: 'sprite_config_json',
    })
    mockedGetSoulStateConfigEntry.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'state-config:upsert',
        txDigest: TX_DIGEST,
        key: 'sprite_config_json',
        value: '{"client":"value"}',
      }),
      syncParams(),
    )

    expect(response.status).toBe(409)
    expect(mockedPrisma.soulAsset.updateMany).not.toHaveBeenCalled()
  })

  it('clears the projection on state-config:delete only when the chain confirms absence', async () => {
    mockedExtractSoulStateConfigDeletedEvent.mockReturnValue({
      stateId: STATE_ID,
      soulId: SOUL_ID,
      updaterAddress: WALLET,
      key: 'voice_config_json',
    })
    mockedGetSoulStateConfigEntry.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'state-config:delete',
        txDigest: TX_DIGEST,
        key: 'voice_config_json',
      }),
      syncParams(),
    )

    expect(response.status).toBe(200)
    expect(mockedPrisma.soulAsset.updateMany).toHaveBeenCalledWith({
      where: { onChainId: SOUL_ID, stateOnChainId: STATE_ID },
      data: { voiceConfigJson: null },
    })
  })

  it('rejects state-config:delete when the chain still holds the key', async () => {
    mockedExtractSoulStateConfigDeletedEvent.mockReturnValue({
      stateId: STATE_ID,
      soulId: SOUL_ID,
      updaterAddress: WALLET,
      key: 'voice_config_json',
    })
    mockedGetSoulStateConfigEntry.mockResolvedValue({ value: 'still-here' })

    const { POST } = await import('../../web/app/api/souls/[id]/content/sync/route')
    const response = await POST(
      jsonRequest(`/api/souls/${SOUL_ID}/content/sync`, {
        action: 'state-config:delete',
        txDigest: TX_DIGEST,
        key: 'voice_config_json',
      }),
      syncParams(),
    )

    expect(response.status).toBe(409)
    expect(mockedPrisma.soulAsset.updateMany).not.toHaveBeenCalled()
  })
})
