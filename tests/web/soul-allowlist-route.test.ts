import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sameSuiValueForTests } from './test-sui-value.ts'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const OWNER_ADDRESS = `0x${'1'.repeat(64)}`
const AGENT_ADDRESS = `0x${'2'.repeat(64)}`
const SOUL_ID = `0x${'3'.repeat(64)}`
const ACCESS_CAP_ID = `0x${'4'.repeat(64)}`
const KIOSK_ID = `0x${'5'.repeat(64)}`
const KIOSK_CAP_ID = `0x${'6'.repeat(64)}`
const TX_DIGEST = '11111111111111111111111111111111'

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

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransactionBlock = vi.hoisted(() => vi.fn())
const mockedExtractSoulAllowlistSetEvent = vi.hoisted(() => vi.fn())
const mockedExtractSoulAllowlistClearedEvent = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSoulAllowlistCapState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedPersonalKioskCapState = vi.hoisted(() => vi.fn())
const mockedDbSetSoulAllowlist = vi.hoisted(() => vi.fn())
const mockedDbClearSoulAllowlist = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))

vi.mock('@web/lib/souls/transaction', () => ({
  getSuccessfulTransactionBlock: mockedGetSuccessfulTransactionBlock,
}))

const sameSuiValueImpl = sameSuiValueForTests

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
  extractSoulAllowlistSetEvent: mockedExtractSoulAllowlistSetEvent,
  extractSoulAllowlistClearedEvent: mockedExtractSoulAllowlistClearedEvent,
  getVerifiedSoulState: mockedGetVerifiedSoulState,
  getVerifiedSoulAllowlistCapState: mockedGetVerifiedSoulAllowlistCapState,
  getVerifiedPersonalKioskCapState: mockedGetVerifiedPersonalKioskCapState,
  sameSuiValue: sameSuiValueImpl,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  SoulMirrorOwnershipConflictError: MockSoulMirrorOwnershipConflictError,
  dbSetSoulAllowlist: mockedDbSetSoulAllowlist,
  dbClearSoulAllowlist: mockedDbClearSoulAllowlist,
}))

describe('soul allowlist route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([OWNER_ADDRESS])
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentOwnerAddress: OWNER_ADDRESS,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingStatus: 'held',
    })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedGetSuccessfulTransactionBlock.mockResolvedValue({
      digest: TX_DIGEST,
      transaction: {
        data: {
          sender: OWNER_ADDRESS,
        },
      },
      objectChanges: [
        {
          type: 'created',
          objectId: ACCESS_CAP_ID,
        },
      ],
    })
    mockedExtractSoulAllowlistSetEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      allowlistedAddress: AGENT_ADDRESS,
      allowlistVersion: 5n,
    })
    mockedExtractSoulAllowlistClearedEvent.mockReturnValue({
      soulObjectId: SOUL_ID,
      oldAllowlistedAddress: AGENT_ADDRESS,
    })
    mockedGetVerifiedSoulState.mockResolvedValue({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      allowlistAddress: AGENT_ADDRESS,
      allowlistVersion: 5n,
    })
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValue({
      objectId: KIOSK_CAP_ID,
      ownerAddress: OWNER_ADDRESS,
      kioskId: KIOSK_ID,
    })
    mockedGetVerifiedSoulAllowlistCapState.mockResolvedValue({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      allowlistedAddress: AGENT_ADDRESS,
      allowlistVersion: 5n,
    })
    mockedDbSetSoulAllowlist.mockResolvedValue(undefined)
    mockedDbClearSoulAllowlist.mockResolvedValue(undefined)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
  })

  it('only allows the current holder of a held Soul to manage allowlist state', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'other-member',
      listingStatus: 'held',
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Only the current owner can manage the allowlist',
    })
  })

  it('rejects listed Souls before attempting allowlist sync', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingStatus: 'listed',
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    // Listed Souls intentionally reuse the owner-only denial copy so callers do not branch on
    // whether the mirror is stale vs. the Soul simply not being in a holder-managed state.
    await expect(response.json()).resolves.toEqual({
      error: 'Only the current owner can manage the allowlist',
    })
    expect(mockedGetMemberSuiWalletAddresses).not.toHaveBeenCalled()
  })

  it('falls back to wallet-address ownership when the mirrored owner member is unresolved', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: null,
      currentOwnerAddress: OWNER_ADDRESS,
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingStatus: 'held',
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      allowlistAddress: AGENT_ADDRESS,
      soulAllowlistCapOnChainId: ACCESS_CAP_ID,
      allowlistVersion: '5',
    })
  })

  it('rejects non-human identities before attempting allowlist sync', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { memberId: 'member-1', kind: 'agent' },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'This allowlist route only supports human sessions',
    })
    expect(mockedGetMemberSuiWalletAddresses).not.toHaveBeenCalled()
  })

  it('returns 409 when the owner has multiple Sui wallet bindings while setting the allowlist', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(walletError)

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
  })

  it('mirrors allowlist creation from verified on-chain Soul state', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      allowlistAddress: AGENT_ADDRESS,
      soulAllowlistCapOnChainId: ACCESS_CAP_ID,
      allowlistVersion: '5',
    })
    expect(mockedDbSetSoulAllowlist).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      allowlistAddress: AGENT_ADDRESS,
      allowlistCapOnChainId: ACCESS_CAP_ID,
      allowlistVersion: 5n,
      expectedCurrentOwnerAddress: OWNER_ADDRESS,
      expectedCurrentKioskId: KIOSK_ID,
      expectedListingStatus: 'held',
    })
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith(expect.objectContaining({
      txDigest: TX_DIGEST,
      routeKey: 'allowlist:set',
      actorKey: 'member-1',
      resourceKey: SOUL_ID,
      statusCode: 200,
      body: expect.objectContaining({
        soulOnChainId: SOUL_ID,
        allowlistAddress: AGENT_ADDRESS,
        soulAllowlistCapOnChainId: ACCESS_CAP_ID,
      }),
    }))
  })

  it('rejects allowlist caps that were not created or mutated by the submitted transaction', async () => {
    mockedGetSuccessfulTransactionBlock.mockResolvedValueOnce({
      digest: TX_DIGEST,
      transaction: {
        data: {
          sender: OWNER_ADDRESS,
        },
      },
      objectChanges: [
        {
          type: 'created',
          objectId: `0x${'7'.repeat(64)}`,
        },
      ],
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Submitted soulAllowlistCapOnChainId was not created or updated by this transaction',
    })
    expect(mockedDbSetSoulAllowlist).not.toHaveBeenCalled()
  })

  it('returns 409 when the Soul owner changes before the allowlist mirror write lands', async () => {
    mockedDbSetSoulAllowlist.mockRejectedValueOnce(
      new MockSoulMirrorOwnershipConflictError('ownership changed'),
    )

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul ownership changed before the allowlist mirror could be updated',
    })
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
  })

  it('replays cached allowlist responses for duplicate tx digests', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        soulOnChainId: SOUL_ID,
        allowlistAddress: AGENT_ADDRESS,
        soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        allowlistVersion: '5',
      },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedDbSetSoulAllowlist).not.toHaveBeenCalled()
  })

  it('rejects cached allowlist set responses when the requested address no longer matches the stored body', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        soulOnChainId: SOUL_ID,
        allowlistAddress: OWNER_ADDRESS,
        soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        allowlistVersion: '5',
      },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Stored allowlist sync does not match the requested address',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('rejects cached allowlist set responses when the requested cap id no longer matches the stored body', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        soulOnChainId: SOUL_ID,
        allowlistAddress: AGENT_ADDRESS,
        soulAllowlistCapOnChainId: `0x${'8'.repeat(64)}`,
        allowlistVersion: '5',
      },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Stored allowlist sync does not match the requested cap id',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('returns 422 when the verified on-chain allowlist does not match the requested address', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      allowlistAddress: OWNER_ADDRESS,
      allowlistVersion: 5n,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'On-chain Soul allowlist does not match the requested address',
    })
    expect(mockedDbSetSoulAllowlist).not.toHaveBeenCalled()
  })

  it('returns 422 when the Soul allowlist cap allowlisted address diverges from the requested address', async () => {
    mockedGetVerifiedSoulAllowlistCapState.mockResolvedValueOnce({
      objectId: ACCESS_CAP_ID,
      ownerAddress: AGENT_ADDRESS,
      soulObjectId: SOUL_ID,
      allowlistedAddress: OWNER_ADDRESS,
      allowlistVersion: 5n,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist cap allowlisted address does not match the requested address',
    })
    expect(mockedDbSetSoulAllowlist).not.toHaveBeenCalled()
  })

  it('returns 403 when the owner has no bound Sui wallet while setting the allowlist', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([])

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Bind a Sui wallet before updating the allowlist',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('returns 422 when the tx is missing the expected allowlist-set event', async () => {
    mockedExtractSoulAllowlistSetEvent.mockImplementationOnce(() => {
      throw new MockOnChainVerificationError('Soul allowlist set event is missing from the transaction')
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist set event is missing from the transaction',
    })
    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
  })

  it('returns 503 when the mirrored kiosk-cap id is still missing before allowlist set verification', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: null,
      listingStatus: 'held',
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul ownership is still syncing on chain, retry shortly',
    })
    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
  })

  it('returns 503 when kiosk ownership verification is temporarily stale after relist', async () => {
    mockedGetVerifiedPersonalKioskCapState.mockRejectedValueOnce(
      new MockOnChainVerificationError('On-chain object was not found'),
    )

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul ownership is still syncing on chain, retry shortly',
    })
    expect(response.headers.get('Retry-After')).toBe('5')
  })

  it('returns 422 when the verified kiosk cap owner does not match the authenticated wallet', async () => {
    mockedGetVerifiedPersonalKioskCapState.mockResolvedValueOnce({
      objectId: KIOSK_CAP_ID,
      ownerAddress: `0x${'7'.repeat(64)}`,
      kioskId: KIOSK_ID,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: TX_DIGEST,
          allowlistAddress: AGENT_ADDRESS,
          soulAllowlistCapOnChainId: ACCESS_CAP_ID,
        }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'On-chain Soul owner does not match the authenticated wallet',
    })
    expect(mockedDbSetSoulAllowlist).not.toHaveBeenCalled()
  })

  it('returns 422 when the clear tx is missing the expected allowlist-cleared event', async () => {
    mockedExtractSoulAllowlistClearedEvent.mockImplementationOnce(() => {
      throw new MockOnChainVerificationError('Soul allowlist cleared event is missing from the transaction')
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist cleared event is missing from the transaction',
    })
    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
  })

  it('rate limits allowlist clear before reading Soul state', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 120 })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many allowlist sync requests, try again later',
    })
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('returns a specific error when the allowlist clear DELETE body is missing', async () => {
    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'DELETE request body must include txDigest',
    })
    expect(mockedGetSuccessfulTransactionBlock).not.toHaveBeenCalled()
  })

  it('mirrors allowlist revocation once the on-chain allowlist is cleared', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      allowlistAddress: null,
      allowlistVersion: 6n,
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      soulOnChainId: SOUL_ID,
      allowlistAddress: null,
      soulAllowlistCapOnChainId: null,
      allowlistVersion: '6',
    })
    expect(mockedDbClearSoulAllowlist).toHaveBeenCalledWith({
      soulOnChainId: SOUL_ID,
      allowlistVersion: 6n,
      expectedCurrentOwnerAddress: OWNER_ADDRESS,
      expectedCurrentKioskId: KIOSK_ID,
      expectedListingStatus: 'held',
    })
  })

  it('rejects allowlist clears when the event old address diverges from the mirrored allowlist address', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentOwnerAddress: OWNER_ADDRESS,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      listingStatus: 'held',
      allowlistAddress: OWNER_ADDRESS,
    })
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      allowlistAddress: null,
      allowlistVersion: 6n,
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction cleared a different allowlist address than the mirrored Soul state',
    })
    expect(mockedDbClearSoulAllowlist).not.toHaveBeenCalled()
  })

  it('returns 409 when the Soul owner changes before the allowlist clear mirror write lands', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      allowlistAddress: null,
      allowlistVersion: 6n,
    })
    mockedDbClearSoulAllowlist.mockRejectedValueOnce(
      new MockSoulMirrorOwnershipConflictError('ownership changed'),
    )

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul ownership changed before the allowlist mirror could be cleared',
    })
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
  })

  it('returns 503 when the mirrored kiosk-cap id is still missing before allowlist clear verification', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      currentOwnerMemberId: 'member-1',
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: null,
      listingStatus: 'held',
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul ownership is still syncing on chain, retry shortly',
    })
    expect(mockedGetVerifiedSoulState).not.toHaveBeenCalled()
  })

  it('rejects non-human identities before attempting allowlist clear', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { memberId: 'member-1', kind: 'agent' },
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'This allowlist route only supports human sessions',
    })
    expect(mockedGetMemberSuiWalletAddresses).not.toHaveBeenCalled()
  })

  it('returns 422 when the on-chain allowlist is still set after a clear tx', async () => {
    mockedGetVerifiedSoulState.mockResolvedValueOnce({
      ownerKind: 'object',
      ownerObjectId: KIOSK_ID,
      allowlistAddress: AGENT_ADDRESS,
      allowlistVersion: 6n,
    })

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'On-chain Soul allowlist is still set',
    })
    expect(mockedDbClearSoulAllowlist).not.toHaveBeenCalled()
  })

  it('returns 409 when the owner has multiple Sui wallet bindings while clearing the allowlist', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(walletError)

    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/0xsoul/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: TX_DIGEST }),
      }) as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
  })
})
