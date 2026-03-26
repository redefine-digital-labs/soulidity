import { beforeEach, describe, expect, it, vi } from 'vitest'

const PRIMARY_ADDRESS = `0x${'1'.repeat(64)}`
const SECONDARY_ADDRESS = `0x${'2'.repeat(64)}`

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedVerifyPersonalMessageSignature = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedBuildWalletBindMessage = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  walletBinding: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  soulPassSnapshot: {
    updateMany: vi.fn(),
  },
  soulSeries: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/sui-verify', () => ({
  verifyPersonalMessageSignature: mockedVerifyPersonalMessageSignature,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('../../web/app/api/wallet/bind/challenge/route.ts', () => ({
  buildWalletBindMessage: mockedBuildWalletBindMessage,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('wallet bind confirm route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedResolveIdentity.mockResolvedValue({
      memberId: 'member-1',
      kind: 'human',
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedBuildWalletBindMessage.mockReturnValue('bind-message')
    mockedVerifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => SECONDARY_ADDRESS,
    })
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-1',
      address: PRIMARY_ADDRESS,
      isPrimary: true,
    })
    mockedPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockedPrisma) => Promise<unknown>) => callback(mockedPrisma),
    )
  })

  it('rejects binding a second distinct Sui wallet to the same member', async () => {
    const { POST } = await import('../../web/app/api/wallet/bind/confirm/route.ts')
    const request = {
      json: async () => ({ nonce: 'nonce-1', signature: 'sig-1' }),
      cookies: {
        get: (name: string) => (name === 'wallet-bind-nonce' ? { value: 'nonce-1' } : undefined),
      },
    }

    const response = await POST(request as any)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({
      error: 'Multiple Sui wallets are not supported for this account',
    })
    expect(mockedPrisma.walletBinding.create).not.toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.updateMany).not.toHaveBeenCalled()
  })
})
