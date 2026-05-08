import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mockedRequireHumanWalletIdentity = vi.hoisted(() => vi.fn())
const mockedAssertTransactionSender = vi.hoisted(() => vi.fn())

const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulidityTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulidityTxSync = vi.hoisted(() => vi.fn())

const mockedSyncSoulProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedSyncGrantProjectionFromChain = vi.hoisted(() => vi.fn())
const mockedEndSoulGrantProjectionFromChain = vi.hoisted(() => vi.fn())

const mockedWaitForTransactionBestEffort = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedReadTransactionSender = vi.hoisted(() => vi.fn())
const mockedExtractAllSoulGrantIssuedEvents = vi.hoisted(() => vi.fn())
const mockedExtractAllSoulGrantRevokedEvents = vi.hoisted(() => vi.fn())
const mockedExtractAllSoulGrantSupersededEvents = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  desktopPet: {
    findUnique: vi.fn(),
  },
  soulAsset: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

vi.mock('@/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: () => '127.0.0.1',
  getAnonymousRateLimitFingerprint: () => 'fingerprint',
}))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
  getRequestIp: () => '127.0.0.1',
  getAnonymousRateLimitFingerprint: () => 'fingerprint',
}))

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))
vi.mock('@web/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockedRequireHumanWalletIdentity,
  assertTransactionSender: mockedAssertTransactionSender,
}))

vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
  SOULIDITY_TX_SYNC_ROUTE_KEYS: ['pet-grant:issue', 'pet-grant:revoke'],
}))
vi.mock('@web/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockedGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockedStoreSoulidityTxSync,
  SOULIDITY_TX_SYNC_ROUTE_KEYS: ['pet-grant:issue', 'pet-grant:revoke'],
}))

vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
  syncGrantProjectionFromChain: mockedSyncGrantProjectionFromChain,
  endSoulGrantProjectionFromChain: mockedEndSoulGrantProjectionFromChain,
}))
vi.mock('@web/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockedSyncSoulProjectionFromChain,
  syncGrantProjectionFromChain: mockedSyncGrantProjectionFromChain,
  endSoulGrantProjectionFromChain: mockedEndSoulGrantProjectionFromChain,
}))

vi.mock('@soulidity/sdk', async () => {
  const actual = await vi.importActual<typeof import('@soulidity/sdk')>('@soulidity/sdk')
  return {
    ...actual,
    waitForTransactionBestEffort: mockedWaitForTransactionBestEffort,
    getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
    readTransactionSender: mockedReadTransactionSender,
    extractAllSoulGrantIssuedEvents: mockedExtractAllSoulGrantIssuedEvents,
    extractAllSoulGrantRevokedEvents: mockedExtractAllSoulGrantRevokedEvents,
    extractAllSoulGrantSupersededEvents: mockedExtractAllSoulGrantSupersededEvents,
    parseRequiredTxDigest: (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null),
    getRequiredSoulidityEnv: () => '0xpkg',
  }
})

// ── Fixtures ─────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'account-1'
const HUMAN_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const PET_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_ADDRESS = '0xagent'
const HUMAN_WALLET = '0xhuman'
const SOUL_A = '0xsoul-a'
const SOUL_B = '0xsoul-b'
const STATE_A = '0xstate-a'
const STATE_B = '0xstate-b'

const HUMAN_AUTH = {
  identity: { accountId: ACCOUNT_ID, memberId: HUMAN_MEMBER_ID, kind: 'human' as const },
  walletAddresses: [HUMAN_WALLET],
}

function resetMocks() {
  vi.resetAllMocks()
  mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
  mockedAssertTransactionSender.mockReturnValue(null)
  mockedGetStoredSoulidityTxSync.mockResolvedValue(null)
  mockedStoreSoulidityTxSync.mockResolvedValue(undefined)
  mockedWaitForTransactionBestEffort.mockResolvedValue(undefined)
  mockedGetSuccessfulTransactionBlock.mockResolvedValue({ events: [] })
  mockedReadTransactionSender.mockReturnValue(HUMAN_WALLET)
  mockedExtractAllSoulGrantSupersededEvents.mockReturnValue([])
}

beforeEach(resetMocks)

function jsonRequest(body: unknown) {
  return new Request(`http://localhost/api/account/pets/${PET_ID}/grant-mirror`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function ownedSoulMirror(soulId: string, stateId: string) {
  return {
    onChainId: soulId,
    stateOnChainId: stateId,
    tags: [],
    previewImages: [],
    readme: null,
    creatorMemberId: HUMAN_MEMBER_ID,
    currentOwnerMemberId: HUMAN_MEMBER_ID,
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/account/pets/[id]/grant-mirror — auth & validation', () => {
  it('returns the auth-helper error when identity resolution fails', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue({
      error: Response.json({ error: 'Sign in' }, { status: 401 }),
    })
    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'd', expectedSoulIds: ['a'] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedTakeRateLimitToken.mockResolvedValue({ limited: true, retryAfterSeconds: 30 })
    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'd', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(429)
  })

  it('returns 404 when the pet belongs to another account', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID,
      accountId: 'someone-else',
      agentAddress: AGENT_ADDRESS,
    })
    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'd', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(404)
  })

  it('returns 400 for an unknown action', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID, accountId: ACCOUNT_ID, agentAddress: AGENT_ADDRESS,
    })
    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'wat', txDigest: 'd', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when expectedSoulIds is empty', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID, accountId: ACCOUNT_ID, agentAddress: AGENT_ADDRESS,
    })
    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'd', expectedSoulIds: [] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(400)
  })

  it('returns the cached idempotent response for repeated digests', async () => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID, accountId: ACCOUNT_ID, agentAddress: AGENT_ADDRESS,
    })
    mockedGetStoredSoulidityTxSync.mockResolvedValue({
      statusCode: 200,
      responseBody: { action: 'issue', txDigest: 'd', petId: PET_ID, granteeAddress: AGENT_ADDRESS, grants: [] },
    })

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'd', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(200)
    expect(mockedWaitForTransactionBestEffort).not.toHaveBeenCalled()
    expect(mockedSyncGrantProjectionFromChain).not.toHaveBeenCalled()
  })
})

describe('POST /api/account/pets/[id]/grant-mirror — issue path', () => {
  beforeEach(() => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID, accountId: ACCOUNT_ID, agentAddress: AGENT_ADDRESS,
    })
  })

  it('mirrors a single-soul issue, syncing both Soul and grant projections', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { grantId: '0xgrant-A', soulId: SOUL_A, granteeAddress: AGENT_ADDRESS, scopeMask: 8, scopes: ['assets'], expiresAtMs: null, issuedByAddress: HUMAN_WALLET },
    ])
    mockedSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: SOUL_A, activeGrantCount: 1 })
    mockedSyncGrantProjectionFromChain.mockResolvedValue({ onChainId: '0xgrant-A' })

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-1', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.action).toBe('issue')
    expect(body.grants).toHaveLength(1)
    expect(body.grants[0]).toMatchObject({ soulOnChainId: SOUL_A, grantOnChainId: '0xgrant-A', supersededGrantOnChainId: null })

    expect(mockedSyncSoulProjectionFromChain).toHaveBeenCalledTimes(1)
    expect(mockedSyncGrantProjectionFromChain).toHaveBeenCalledWith(expect.objectContaining({
      grantObjectId: '0xgrant-A',
      soulOnChainId: SOUL_A,
      issuedByMemberId: HUMAN_MEMBER_ID,
    }))
    expect(mockedStoreSoulidityTxSync).toHaveBeenCalledWith(expect.objectContaining({
      routeKey: 'pet-grant:issue',
      txDigest: 'tx-1',
      actorKey: HUMAN_MEMBER_ID,
      resourceKey: PET_ID,
    }))
  })

  it('mirrors superseded grants when a fresh issue replaces an existing one', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { grantId: '0xnew-grant', soulId: SOUL_A, granteeAddress: AGENT_ADDRESS, scopeMask: 8, scopes: ['assets'], expiresAtMs: null, issuedByAddress: HUMAN_WALLET },
    ])
    mockedExtractAllSoulGrantSupersededEvents.mockReturnValue([
      { oldGrantId: '0xold-grant', newGrantId: '0xnew-grant', soulId: SOUL_A, granteeAddress: AGENT_ADDRESS, supersededByAddress: HUMAN_WALLET },
    ])
    mockedSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: SOUL_A, activeGrantCount: 1 })
    mockedSyncGrantProjectionFromChain.mockResolvedValue({ onChainId: '0xnew-grant' })

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-2', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.grants[0].supersededGrantOnChainId).toBe('0xold-grant')

    expect(mockedEndSoulGrantProjectionFromChain).toHaveBeenCalledWith({
      grantOnChainId: '0xold-grant',
      status: 'superseded',
      replacedByGrantOnChainId: '0xnew-grant',
    })
  })

  it('rejects an issue event whose grantee is not this pet (client cannot supply grantee)', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { grantId: '0xrogue', soulId: SOUL_A, granteeAddress: '0xothergrantee', scopeMask: 8, scopes: ['assets'], expiresAtMs: null, issuedByAddress: HUMAN_WALLET },
    ])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-3', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(422)
    expect(mockedSyncGrantProjectionFromChain).not.toHaveBeenCalled()
  })

  it('rejects an issue event for a Soul not in expectedSoulIds', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { grantId: '0xstray', soulId: SOUL_B, granteeAddress: AGENT_ADDRESS, scopeMask: 8, scopes: ['assets'], expiresAtMs: null, issuedByAddress: HUMAN_WALLET },
    ])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-4', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(422)
  })

  it('rejects an issue event whose scope mask does not include SCOPE_ASSETS', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantIssuedEvents.mockReturnValue([
      { grantId: '0xnoassets', soulId: SOUL_A, granteeAddress: AGENT_ADDRESS, scopeMask: 2 /* memory only */, scopes: ['memory'], expiresAtMs: null, issuedByAddress: HUMAN_WALLET },
    ])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-5', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(422)
  })

  it('rejects when expectedSoulIds includes a Soul not owned by the caller', async () => {
    // The DB-side ownership filter prunes non-owned Souls; the route catches
    // the resulting size mismatch and returns 422 before doing any writes.
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-6', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(422)
    expect(mockedExtractAllSoulGrantIssuedEvents).not.toHaveBeenCalled()
  })

  it('rejects with the assertTransactionSender response when sender does not match', async () => {
    mockedAssertTransactionSender.mockReturnValue(Response.json({ error: 'wrong sender' }, { status: 403 }))
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'issue', txDigest: 'tx-7', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(403)
    expect(mockedExtractAllSoulGrantIssuedEvents).not.toHaveBeenCalled()
  })
})

describe('POST /api/account/pets/[id]/grant-mirror — revoke path', () => {
  beforeEach(() => {
    mockedRequireHumanWalletIdentity.mockResolvedValue(HUMAN_AUTH)
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: PET_ID, accountId: ACCOUNT_ID, agentAddress: AGENT_ADDRESS,
    })
  })

  it('mirrors per-soul revoke events and ends the corresponding grant projections', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([
      ownedSoulMirror(SOUL_A, STATE_A),
      ownedSoulMirror(SOUL_B, STATE_B),
    ])
    mockedExtractAllSoulGrantRevokedEvents.mockReturnValue([
      { grantId: '0xg-A', soulId: SOUL_A, revokedByAddress: HUMAN_WALLET, granteeAddress: AGENT_ADDRESS },
      { grantId: '0xg-B', soulId: SOUL_B, revokedByAddress: HUMAN_WALLET, granteeAddress: AGENT_ADDRESS },
    ])
    mockedSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: SOUL_A, activeGrantCount: 0 })

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'revoke', txDigest: 'tx-revoke', expectedSoulIds: [SOUL_A, SOUL_B] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.action).toBe('revoke')
    expect(body.grants).toHaveLength(2)
    expect(mockedEndSoulGrantProjectionFromChain).toHaveBeenCalledWith({ grantOnChainId: '0xg-A', status: 'revoked' })
    expect(mockedEndSoulGrantProjectionFromChain).toHaveBeenCalledWith({ grantOnChainId: '0xg-B', status: 'revoked' })
  })

  it('rejects a revoke event whose grantee is not this pet', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantRevokedEvents.mockReturnValue([
      { grantId: '0xrogue', soulId: SOUL_A, revokedByAddress: HUMAN_WALLET, granteeAddress: '0xother' },
    ])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'revoke', txDigest: 'tx-revoke-bad', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(422)
    expect(mockedEndSoulGrantProjectionFromChain).not.toHaveBeenCalled()
  })

  it('rejects when no revoke events are emitted', async () => {
    mockedPrisma.soulAsset.findMany.mockResolvedValue([ownedSoulMirror(SOUL_A, STATE_A)])
    mockedExtractAllSoulGrantRevokedEvents.mockReturnValue([])

    const { POST } = await import('../../web/app/api/account/pets/[id]/grant-mirror/route')
    const response = await POST(jsonRequest({ action: 'revoke', txDigest: 'tx-revoke-empty', expectedSoulIds: [SOUL_A] }), {
      params: Promise.resolve({ id: PET_ID }),
    })
    expect(response.status).toBe(422)
  })
})
