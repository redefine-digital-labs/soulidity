import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
const mockedDbCreateRelease = vi.hoisted(() => vi.fn())
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
        }),
      }) as any,
      { params: Promise.resolve({ id: 'series-1' }) },
    )

    expect(response.status).toBe(404)
  })
})
