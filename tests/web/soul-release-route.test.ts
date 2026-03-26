import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
const mockedDbCreateRelease = vi.hoisted(() => vi.fn())
const mockedCreateAndStoreReleaseSealSidecar = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedGetSuccessfulTransaction = vi.hoisted(() => vi.fn())
const mockedAssertCreatedObjectChange = vi.hoisted(() => vi.fn())
const mockedGetVerifiedReleaseState = vi.hoisted(() => vi.fn())
const mockedGetVerifiedSeriesState = vi.hoisted(() => vi.fn())
const mockedSameSuiValue = vi.hoisted(() => vi.fn())
const mockedGetRequiredPublicEnv = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))
vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))
vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))
vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbCreateRelease: mockedDbCreateRelease,
}))
vi.mock('@web/lib/souls/release-seal-sidecar', () => ({
  createAndStoreReleaseSealSidecar: mockedCreateAndStoreReleaseSealSidecar,
}))
vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))
vi.mock('@web/lib/souls/on-chain-verification', () => ({
  getSuccessfulTransaction: mockedGetSuccessfulTransaction,
  assertCreatedObjectChange: mockedAssertCreatedObjectChange,
  getVerifiedReleaseState: mockedGetVerifiedReleaseState,
  getVerifiedSeriesState: mockedGetVerifiedSeriesState,
  sameSuiValue: mockedSameSuiValue,
  OnChainVerificationError: class extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@web/lib/souls/config', () => ({
  getRequiredPublicEnv: mockedGetRequiredPublicEnv,
}))
vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

describe('soul release route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false })
    mockedGetRequiredPublicEnv.mockReturnValue(`0x${'9'.repeat(64)}`)
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: `0x${'1'.repeat(64)}`,
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(`0x${'2'.repeat(64)}`)
    mockedGetSuccessfulTransaction.mockResolvedValue({ digest: 'tx-1' })
    mockedAssertCreatedObjectChange.mockReturnValue(undefined)
    mockedGetVerifiedReleaseState.mockResolvedValue({
      objectId: `0x${'a'.repeat(64)}`,
      seriesId: `0x${'1'.repeat(64)}`,
      version: '1.0.0',
      walrusBlobRef: 'blob-123',
      publicMetadataRef: 'blob-123',
      contentHash: 'deadbeef'.padEnd(64, '0'),
    })
    mockedGetVerifiedSeriesState.mockResolvedValue({
      objectId: `0x${'1'.repeat(64)}`,
      latestReleaseId: `0x${'a'.repeat(64)}`,
      authorAddress: `0x${'2'.repeat(64)}`,
    })
    mockedSameSuiValue.mockReturnValue(true)
    mockedDbCreateRelease.mockResolvedValue({
      id: 'release-db-1',
      onChainId: `0x${'a'.repeat(64)}`,
      version: '1.0.0',
    })
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
    mockedCreateAndStoreReleaseSealSidecar.mockResolvedValue({
      version: 1,
      mode: 'seal-envelope',
      documentId: `0x${'b'.repeat(66)}`,
      encryptedDek: 'ZW5j',
      iv: 'aXY=',
      cipher: 'AES-GCM-256',
      mimeType: 'application/octet-stream',
      fileName: 'bundle.zip',
      contentHash: 'deadbeef'.padEnd(64, '0'),
    })
  })

  it('rejects requests with missing txDigest', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ releaseOnChainId: `0x${'a'.repeat(64)}` }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('txDigest'),
    })
  })

  it('rejects requests from agent accounts', async () => {
    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'agent-1', kind: 'agent' },
    })

    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: 'HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH',
          releaseOnChainId: `0x${'a'.repeat(64)}`,
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(403)
  })

  it('returns 404 when series is not found', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue(null)

    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: 'HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH',
          releaseOnChainId: `0x${'a'.repeat(64)}`,
          sealDekEnvelope: 'mock-envelope',
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(404)
  })

  it('rejects manual release sync without sealDekEnvelope before any lookup or caching work', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: 'HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH',
          releaseOnChainId: `0x${'a'.repeat(64)}`,
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'sealDekEnvelope is required for release sync',
    })
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
    expect(mockedGetStoredSoulTxSync).not.toHaveBeenCalled()
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
  })

  it('propagates sealDekEnvelope into manual release sidecar persistence', async () => {
    const txDigest = 'HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH'
    const releaseOnChainId = `0x${'a'.repeat(64)}`
    const sealDekEnvelope = 'mock-envelope'

    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest,
          releaseOnChainId,
          sealDekEnvelope,
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(201)
    expect(mockedCreateAndStoreReleaseSealSidecar).toHaveBeenCalledWith({
      sealDekEnvelope,
      seriesOnChainId: `0x${'1'.repeat(64)}`,
      releaseOnChainId,
      releaseContentHash: 'deadbeef'.padEnd(64, '0'),
      soulPackageId: `0x${'9'.repeat(64)}`,
    })
  })

  it('returns 503 and does not cache release success when Seal sidecar generation fails', async () => {
    mockedCreateAndStoreReleaseSealSidecar.mockRejectedValueOnce(new Error('seal unavailable'))

    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: 'HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH',
          releaseOnChainId: `0x${'a'.repeat(64)}`,
          sealDekEnvelope: 'mock-envelope',
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Release mirrored locally, but Seal sidecar generation failed. Retry release sync.',
    })
    expect(mockedDbCreateRelease).toHaveBeenCalledTimes(1)
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
  })

  it('returns 409 when the account has multiple Sui wallet bindings', async () => {
    mockedGetMemberPrimarySuiWalletAddress.mockRejectedValueOnce(
      Object.assign(new Error('Multiple Sui wallets are not supported for this account'), {
        name: 'MultipleSuiWalletBindingsError',
      }),
    )

    const { POST } = await import('../../web/app/api/souls/[id]/release/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/series-1/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: 'HW4YDZe8X4GPcfGvN6wPW5kGsX4Dg2mfY1fL96s6mKqH',
          releaseOnChainId: `0x${'a'.repeat(64)}`,
          sealDekEnvelope: 'mock-envelope',
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Multiple Sui wallets are not supported for this account',
    })
    expect(mockedGetSuccessfulTransaction).not.toHaveBeenCalled()
  })
})
